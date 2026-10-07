const session = localStorage.getItem('session');
if (!session) window.location.href = '/';

const socket = io(window.location.origin, { auth: { session }, transports: ['websocket'] });
const drawer = document.querySelector('#admin-user-drawer');
const detail = document.querySelector('#admin-users-detail');
const backdrop = document.querySelector('#admin-user-drawer-backdrop');
const directory = document.querySelector('#admin-users-list');
const state = document.querySelector('#admin-users-state');
const results = document.querySelector('#admin-users-results');
const refreshButton = document.querySelector('#admin-users-refresh');
const searchInput = document.querySelector('#admin-users-search');
const roleFilter = document.querySelector('#admin-users-role');
const typeFilter = document.querySelector('#admin-users-type');
const sortInput = document.querySelector('#admin-users-sort');
const resetButton = document.querySelector('#admin-users-reset');
const pagination = document.querySelector('#admin-users-pagination');
const previousPageButton = document.querySelector('#admin-users-prev');
const nextPageButton = document.querySelector('#admin-users-next');
const pageLabel = document.querySelector('#admin-users-page');
const roleValues = { user: 0, mod: 1, admin: 2, owner: 3 };
const pageSize = 50;
const pendingActions = new Set();
let uRole = 'user';
let ownEmail = null;
let usersData = [];
let selectedUser = null;
let activeView = 'all';
let activeDetailTab = 'profile';
let loaded = false;
let currentPage = 1;
let totalPages = 1;
let totalMatches = 0;
let totalUsers = 0;
let userCounts = {};
let listPartial = false;
let listRequestId = 0;
let detailRequest = 0;
let refreshTimer;
let searchTimer;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, icon, handler, className = '') {
  const node = element('button', className);
  node.type = 'button';
  if (label) node.dataset.focusKey = label;
  if (icon) {
    const glyph = element('i', `ti ti-${icon}`);
    glyph.setAttribute('aria-hidden', 'true');
    node.append(glyph, document.createTextNode(' '));
  }
  node.append(document.createTextNode(label));
  if (handler) node.addEventListener('click', event => handler(event.currentTarget));
  return node;
}

function showToast(message, type = 'info') {
  if (window.showAdminToast) return window.showAdminToast(message, type);
  const toast = element('div', `toast ${type}`, message);
  document.querySelector('#toast-container').append(toast);
  setTimeout(() => toast.remove(), 4000);
}

function showModal({ message, withInput = false, defaultValue = '', options = null, confirmLabel = 'confirm' }) {
  return new Promise(resolve => {
    const overlay = document.querySelector('#modal-overlay');
    const input = document.querySelector('#modal-input');
    const select = document.querySelector('#modal-select');
    const confirm = document.querySelector('#modal-confirm');
    const cancel = document.querySelector('#modal-cancel');
    document.querySelector('#modal-message').textContent = message;
    input.style.display = withInput ? 'block' : 'none';
    input.value = defaultValue;
    select.style.display = options ? 'block' : 'none';
    select.replaceChildren();
    options?.forEach(([value, label]) => {
      const option = element('option', '', label);
      option.value = value;
      select.append(option);
    });
    if (options) select.value = defaultValue;
    confirm.textContent = confirmLabel;
    if (window.openAdminModal) window.openAdminModal(overlay);
    else overlay.style.display = 'flex';
    // admin-ui.js moves focus after making the underlying drawer inert.
    let closing = false;
    function finish(value) {
      if (closing) return;
      closing = true;
      const complete = () => {
        overlay.style.display = 'none';
        confirm.removeEventListener('click', onConfirm);
        cancel.removeEventListener('click', onCancel);
        input.removeEventListener('keydown', onKey);
        resolve(value);
      };
      if (window.closeAdminModal) window.closeAdminModal(overlay, complete);
      else complete();
    }
    function onConfirm() { finish(options ? select.value : withInput ? input.value.trim() : true); }
    function onCancel() { finish(null); }
    function onKey(event) {
      if (event.key === 'Enter') { event.preventDefault(); onConfirm(); }
    }
    confirm.addEventListener('click', onConfirm);
    cancel.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}

function timeAgo(timestamp) {
  if (!timestamp) return 'never';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const units = [[31536000, 'y'], [2592000, 'mo'], [86400, 'd'], [3600, 'h'], [60, 'm']];
  const [size, label] = units.find(([size]) => seconds >= size);
  return `${Math.floor(seconds / size)}${label} ago`;
}

function formatDate(timestamp, withTime = false) {
  if (!timestamp) return 'unavailable';
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {})
  });
}

function avatar(user, className) {
  const node = element('div', className);
  node.setAttribute('aria-hidden', 'true');
  const initial = (user.username || user.email || '?')[0].toUpperCase();
  if (user.avatar) {
    const img = element('img');
    img.alt = '';
    img.src = user.avatar;
    img.addEventListener('error', () => node.replaceChildren(document.createTextNode(initial)), { once: true });
    node.append(img);
  } else {
    node.textContent = initial;
  }
  return node;
}

function badge(label, variant = '') { return element('span', `admin-directory-badge ${variant}`, label); }
function isMuted(user) { return !!user.muted && (!user.muteUntil || user.muteUntil > Date.now()); }

function showDirectoryState(title, message, retry = false) {
  state.replaceChildren(element('strong', '', title), element('span', '', message));
  if (retry) state.append(button('try again', 'refresh', requestUsers));
  state.hidden = false;
  document.querySelector('#admin-users-table-wrap').hidden = true;
  pagination.hidden = true;
}

function renderUsers() {
  const focusedEmail = document.activeElement?.dataset.userOpen;
  directory.replaceChildren();
  document.querySelectorAll('[data-user-count]').forEach(node => {
    node.textContent = loaded ? (userCounts[node.dataset.userCount] ?? 0).toLocaleString() : '—';
  });
  resetButton.hidden = !(searchInput.value.trim() || activeView !== 'all' || roleFilter.value !== 'all' || typeFilter.value !== 'all' || sortInput.value !== 'online');
  if (!loaded) return;
  const start = totalMatches ? (currentPage - 1) * pageSize + 1 : 0;
  const end = totalMatches ? start + usersData.length - 1 : 0;
  results.textContent = totalMatches
    ? `showing ${start}–${end} of ${totalMatches.toLocaleString()} matches · ${totalUsers.toLocaleString()} total users${listPartial ? ' · Clerk directory unavailable' : ''}`
    : `0 matches · ${totalUsers.toLocaleString()} total users${listPartial ? ' · Clerk directory unavailable' : ''}`;
  pageLabel.textContent = `page ${currentPage} of ${totalPages}`;
  previousPageButton.disabled = currentPage <= 1;
  nextPageButton.disabled = currentPage >= totalPages;
  pagination.hidden = totalPages <= 1 || totalMatches === 0;
  if (!usersData.length) {
    showDirectoryState(totalUsers ? 'no matching users' : listPartial ? 'directory is incomplete' : 'no users yet',
      totalUsers ? 'try another search or clear your filters.' : listPartial ? 'the server could not load Clerk accounts. refresh to try again.' : 'accounts and connected guests will appear here.');
    return;
  }
  state.hidden = true;
  document.querySelector('#admin-users-table-wrap').hidden = false;
  const fragment = document.createDocumentFragment();
  usersData.forEach(user => {
    const row = element('tr', 'admin-directory-row');
    row.dataset.email = user.email;
    row.classList.toggle('selected', selectedUser?.email === user.email);
    const identity = element('div', 'admin-directory-identity');
    const info = element('div', 'admin-user-info');
    info.append(element('span', 'admin-user-name', user.username || user.email.split('@')[0]),
      element('span', 'admin-user-email', user.guest ? 'guest account' : user.email));
    identity.append(avatar(user, 'admin-user-avatar'), info);
    const cells = Array.from({ length: 5 }, () => element('td'));
    cells[0].append(identity);
    cells[1].append(badge(user.role || 'user', user.role !== 'user' ? 'staff' : ''));
    cells[2].append(badge(user.online ? 'online' : 'offline', user.online ? 'online' : ''));
    const moderation = element('div', 'admin-user-badges');
    if (user.banned) moderation.append(badge('banned', 'banned'));
    if (isMuted(user)) moderation.append(badge('muted', 'muted'));
    if (user.hidden) moderation.append(badge('hidden'));
    if (!moderation.children.length) moderation.append(element('span', '', '—'));
    cells[3].append(moderation);
    const openButton = button('', 'chevron-right', trigger => openUser(user, trigger), 'admin-user-open');
    openButton.dataset.userOpen = user.email;
    openButton.setAttribute('aria-label', `view details for ${user.username || user.email}`);
    openButton.setAttribute('aria-haspopup', 'dialog');
    cells[4].append(openButton);
    row.append(...cells);
    row.addEventListener('click', event => {
      if (!event.target.closest('button')) openUser(user, openButton);
    });
    fragment.append(row);
  });
  directory.append(fragment);
  if (focusedEmail && !drawer.open) [...directory.querySelectorAll('[data-user-open]')]
    .find(btn => btn.dataset.userOpen === focusedEmail)?.focus();
}

function finishRefresh() {
  clearTimeout(refreshTimer);
  refreshButton.disabled = false;
  refreshButton.innerHTML = '<i class="ti ti-refresh" aria-hidden="true"></i> refresh';
}

function requestUsers() {
  clearTimeout(searchTimer);
  if (!socket.connected) {
    showDirectoryState('connection lost', 'reconnecting to the server…', true);
    return;
  }
  const requestId = ++listRequestId;
  refreshButton.disabled = true;
  refreshButton.innerHTML = '<i class="ti ti-loader admin-loading-spinner" aria-hidden="true"></i> refreshing…';
  previousPageButton.disabled = true;
  nextPageButton.disabled = true;
  socket.emit('getAdminUsers', {
    requestId,
    query: searchInput.value.trim(),
    view: activeView,
    role: roleFilter.value,
    type: typeFilter.value,
    sort: sortInput.value,
    page: currentPage,
    pageSize,
    selectedEmail: selectedUser?.email || null,
  });
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (requestId !== listRequestId) return;
    finishRefresh();
    if (!loaded) showDirectoryState('could not load users', 'the server did not respond. try again.', true);
    else showToast('could not refresh users. try again.', 'error');
  }, 10000);
}

async function readJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || 'request failed');
  return data;
}

function openUser(user, trigger) {
  activeDetailTab = 'profile';
  selectedUser = user;
  document.querySelectorAll('.admin-directory-row').forEach(row => row.classList.toggle('selected', row.dataset.email === user.email));
  trigger?.focus();
  if (!drawer.open) drawer.show();
  backdrop.hidden = false;
  document.body.classList.add('admin-drawer-open');
  loadUser(user, true);
}

function closeUser(animate = false) {
  if (!drawer.open || !document.querySelector('#modal-overlay').style.display.includes('none') || document.querySelector('.admin-sessions-modal')) return;
  window.closeAdminDrawer(drawer, () => {
    drawer.close();
    backdrop.hidden = true;
    document.body.classList.remove('admin-drawer-open');
    selectedUser = null;
    detailRequest++;
    document.querySelectorAll('.admin-directory-row.selected').forEach(row => row.classList.remove('selected'));
  }, animate === true);
}

async function loadUser(user, showLoading = false) {
  const request = ++detailRequest;
  detail.setAttribute('aria-busy', 'true');
  if (showLoading) {
    detail.replaceChildren(element('div', 'admin-loading', 'loading user details…'));
  }
  try {
    const info = await readJson(`/admin/user/info?email=${encodeURIComponent(user.email)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (request !== detailRequest || !drawer.open || selectedUser?.email !== user.email) return;
    selectedUser = { ...user, ...info };
    renderDetail(selectedUser);
  } catch (error) {
    if (request !== detailRequest || !drawer.open) return;
    if (showLoading) {
      const empty = element('div', 'admin-users-detail-empty');
      empty.append(element('strong', '', 'could not load user details'),
        element('span', '', error.message), button('try again', 'refresh', () => loadUser(user, true)));
      detail.replaceChildren(empty);
    } else showToast('could not refresh user details', 'error');
  } finally {
    if (request === detailRequest) detail.removeAttribute('aria-busy');
  }
}

function section(title, hint) {
  const node = element('section', 'admin-detail-section');
  node.append(element('h4', 'admin-detail-section-title', title));
  if (hint) node.append(element('p', '', hint));
  return node;
}

function field(parent, label, value) {
  const node = element('div', 'admin-detail-field');
  node.append(element('span', 'admin-detail-field-label', label));
  const content = element('span', 'admin-detail-field-value');
  if (value instanceof Node) content.append(value);
  else content.textContent = value;
  node.append(content);
  parent.append(node);
}

function moderationNotice(parent, label, reason, variant) {
  const box = element('div', `admin-mod-status-box ${variant}`);
  box.append(element('strong', '', label), element('p', '', reason || 'no reason provided'));
  parent.append(box);
}

function canModerate(user) {
  return ['admin', 'owner'].includes(uRole) && user.email !== ownEmail &&
    roleValues[user.role || 'user'] < roleValues[uRole];
}

function detailTabs(content) {
  const names = ['profile', 'moderation', 'account', 'sessions'];
  const nav = element('div', 'admin-detail-tabs');
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', 'user details');
  const body = element('div', 'admin-detail-panels');
  const panels = {};
  const tabs = [];
  function selectTab(name, focus = false) {
    activeDetailTab = name;
    tabs.forEach(tab => {
      const selected = tab.dataset.detailTab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels[tab.dataset.detailTab].hidden = !selected;
    });
    body.scrollTop = 0;
    if (focus) tabs.find(tab => tab.dataset.detailTab === name)?.focus();
  }
  names.forEach((name, index) => {
    const tab = button(name, null, () => selectTab(name));
    tab.id = `admin-detail-tab-${name}`;
    tab.dataset.detailTab = name;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `admin-detail-panel-${name}`);
    const panel = element('div', 'admin-detail-panel');
    panel.id = `admin-detail-panel-${name}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panel.tabIndex = 0;
    panels[name] = panel;
    tabs.push(tab);
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % names.length;
      if (event.key === 'ArrowLeft') next = (index + names.length - 1) % names.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = names.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      selectTab(names[next], true);
    });
    nav.append(tab);
    body.append(panel);
  });
  content.append(nav, body);
  selectTab(activeDetailTab);
  return panels;
}

async function changeVerification(user, red, btn) {
  const enabled = red ? user.redVerified : user.verified;
  const label = red ? 'red verification' : 'regular verification';
  let impact = 'the role stays unchanged.';
  if (!red && !enabled && user.role === 'user') impact = 'this also promotes the user to mod.';
  if (!red && enabled && user.role === 'mod') impact = 'this also changes the role from mod to user.';
  const confirmed = await showModal({
    message: `${enabled ? 'remove' : 'add'} ${label} for ${user.username}?\n\n${impact}`,
    confirmLabel: enabled ? 'remove verification' : 'verify user'
  });
  if (!confirmed) return;
  const action = red ? (enabled ? 'unredverify' : 'redverify') : (enabled ? 'unverify' : 'verify');
  await performAction(`/admin/${action}`, { email: user.email }, btn,
    `${label} ${enabled ? 'removed' : 'added'}`, user);
}

function renderDetail(user) {
  const content = element('div', 'admin-users-detailed-content');
  const header = element('div', 'admin-detail-header');
  const identity = element('div', 'admin-detail-info');
  identity.append(element('div', 'admin-detail-name', user.username),
    element('div', 'admin-detail-email', user.guest ? 'guest account' : user.email));
  const badges = element('div', 'admin-user-badges admin-detail-badges');
  badges.append(badge(user.role, user.role !== 'user' ? 'staff' : ''),
    badge(user.online ? 'online' : 'offline', user.online ? 'online' : ''));
  if (user.guest) badges.append(badge('guest'));
  if (user.verified) badges.append(badge('verified', 'staff'));
  if (user.redVerified) badges.append(badge('red verified', 'red-verified'));
  if (user.hidden) badges.append(badge('hidden'));
  identity.append(badges);
  header.append(avatar(user, 'admin-detail-avatar'), identity);
  content.append(header);
  const panels = detailTabs(content);
  const profile = section('profile details');
  field(profile, 'username', user.username);
  field(profile, 'pronouns', user.profile?.pronouns || 'not set');
  field(profile, 'status', user.profile?.status || 'not set');
  field(profile, 'last seen', user.online ? 'online now' : user.profile?.lastSeen ? formatDate(user.profile.lastSeen, true) : 'unavailable');
  const bio = element('div', 'admin-detail-bio');
  bio.append(element('span', 'admin-detail-field-label', 'bio'),
    element('p', 'admin-profile-bio', user.profile?.bio || 'no bio yet.'));
  profile.append(bio);
  if (user.guest) profile.append(element('p', '', 'guest accounts do not have a saved bio or pronouns.'));
  panels.profile.append(profile);

  const verification = section('verification', uRole === 'owner'
    ? 'regular verification promotes users to mod. removing it changes mods back to users. red verification leaves roles unchanged.'
    : 'only the owner can change verification.');
  [false, true].forEach(red => {
    const enabled = red ? user.redVerified : user.verified;
    const row = element('div', 'admin-verification-row');
    const info = element('div', 'admin-verification-info');
    info.append(element('strong', '', red ? 'red verification' : 'regular verification'),
      badge(enabled ? 'verified' : 'not verified', enabled ? (red ? 'red-verified' : 'staff') : ''));
    row.append(info);
    if (uRole === 'owner') {
      const control = button(enabled ? 'remove' : 'verify', enabled ? 'shield-x' : 'shield-check',
        btn => changeVerification(user, red, btn));
      control.id = red ? 'admin-red-verification' : 'admin-regular-verification';
      control.setAttribute('aria-label', `${enabled ? 'remove' : 'add'} ${red ? 'red' : 'regular'} verification`);
      control.disabled = !red && user.guest;
      row.append(control);
    }
    verification.append(row);
  });
  if (user.guest && uRole === 'owner') verification.append(element('p', '', 'regular verification is unavailable for guests because guests cannot have moderator roles.'));
  panels.profile.append(verification);

  const moderation = section('moderation');
  if (user.banned) moderationNotice(moderation, 'chat ban active', user.banReason, 'danger');
  if (isMuted(user)) moderationNotice(moderation,
    user.muteUntil ? `muted until ${formatDate(user.muteUntil, true)}` : 'muted permanently', user.muteReason, 'warning');
  const actions = element('div', 'admin-detail-actions');
  const permitted = canModerate(user);
  const ban = button(user.banned ? 'unban user' : 'ban user', 'ban',
    btn => moderateUser(user, user.banned ? 'unban' : 'ban', btn), user.banned ? 'positive' : 'destructive');
  // A Clerk ban cannot be lifted through the chat ban endpoint.
  ban.disabled = user.banned ? (!['admin', 'owner'].includes(uRole) || user.clerkBanned !== false) : !permitted;
  const mute = button(isMuted(user) ? 'unmute user' : 'mute user', isMuted(user) ? 'volume' : 'volume-3',
    btn => moderateUser(user, isMuted(user) ? 'unmute' : 'mute', btn), isMuted(user) ? 'positive' : 'moderate');
  mute.disabled = isMuted(user) ? !['admin', 'owner'].includes(uRole) : !permitted;
  const kick = button('kick user', 'user-x', btn => moderateUser(user, 'kick', btn), 'moderate');
  kick.disabled = !permitted || !user.online;
  actions.append(mute, kick, ban);
  moderation.append(actions);
  if (!permitted) moderation.append(element('p', '', 'moderation is available for users with a lower role than yours.'));
  if (user.banned && user.clerkBanned === true) moderation.append(element('p', '', 'this account is also banned in Clerk. manage its account ban in the Clerk dashboard.'));
  if (user.banned && user.clerkBanned == null) moderation.append(element('p', '', 'account ban status is unavailable. refresh details before unbanning.'));
  panels.moderation.append(moderation);

  const visibility = section('directory visibility', 'hidden users do not appear in public user lists.');
  const visibilityButton = button(user.hidden ? 'show in user lists' : 'hide from user lists',
    user.hidden ? 'eye' : 'eye-off', btn => performAction(
      user.hidden ? '/admin/unhide' : '/admin/hide',
      { email: user.email }, btn,
      user.hidden ? 'user is visible in public lists' : 'user hidden from public lists', user
    ), user.hidden ? 'positive' : 'moderate');
  visibility.append(visibilityButton);
  panels.moderation.append(visibility);

  const account = section('account details');
  field(account, 'account type', user.guest ? 'guest' : 'registered');
  field(account, 'joined', formatDate(user.createdAt));
  field(account, 'total messages', Number(user.messageCount || 0).toLocaleString());
  panels.account.append(account);

  if (uRole === 'owner' && !user.guest) {
    const roles = section('role management');
    const controls = element('div', 'admin-role-selector');
    const label = element('label', '', 'role');
    label.htmlFor = 'role-select';
    const select = element('select');
    select.id = 'role-select';
    Object.keys(roleValues).forEach(role => {
      const option = element('option', '', role);
      option.value = role;
      select.append(option);
    });
    select.value = user.role;
    select.disabled = ownEmail === user.email;
    const update = button('update', 'check', async btn => {
      const role = select.value;
      const confirmed = await showModal({ message: `change ${user.username}'s role from ${user.role} to ${role}?`, confirmLabel: 'update role' });
      if (confirmed) performAction('/admin/user/role', { email: user.email, role }, btn, 'role updated', user);
    });
    update.disabled = select.disabled || select.value === user.role;
    select.addEventListener('change', () => { update.disabled = select.disabled || select.value === user.role; });
    controls.append(label, select, update);
    roles.append(controls);
    if (ownEmail === user.email) roles.append(element('p', '', 'you cannot change your own role.'));
    panels.account.append(roles);
  }

  if (!user.guest) {
    const sessions = section('sessions');
    field(sessions, 'last sign in', timeAgo(user.lastSignInAt));
    field(sessions, 'active sessions', user.activeSessions == null ? 'unavailable' : String(user.activeSessions));
    field(sessions, 'account status', user.clerkBanned == null ? 'unavailable' : user.clerkBanned ? 'banned in Clerk' : 'active');
    if (user.clerkId) {
      const identifier = element('span', 'admin-clerk-id', user.clerkId);
      const copy = button('', 'copy', async () => {
        try { await navigator.clipboard.writeText(user.clerkId); showToast('Clerk ID copied', 'success'); }
        catch { showToast('could not copy Clerk ID', 'error'); }
      });
      copy.setAttribute('aria-label', 'copy Clerk ID');
      identifier.append(copy);
      field(account, 'Clerk ID', identifier);
      sessions.append(button('view active sessions', 'device-laptop', () => viewUserSessions(user), 'admin-sessions-btn'));
    } else sessions.append(element('p', '', 'account details are unavailable. try refreshing this user.'));
    panels.sessions.append(sessions);
    if (uRole === 'owner' && user.clerkId) {
      const danger = section('account ban', 'blocks this account from signing in. account bans must be reversed in the Clerk dashboard.');
      danger.classList.add('admin-account-danger');
      const banAccount = button(user.clerkBanned ? 'account banned' : 'ban Clerk account', 'ban', async btn => {
        const confirmed = await showModal({ message: `ban ${user.username}'s Clerk account?\n\nthis blocks sign-in. you can only reverse it in the Clerk dashboard.`, confirmLabel: 'ban account' });
        if (confirmed) performAction('/admin/user/ban-clerk', { email: user.email, clerkId: user.clerkId }, btn, 'account banned', user);
      }, 'admin-ban-clerk-btn');
      banAccount.disabled = !permitted || user.clerkBanned !== false;
      danger.append(banAccount);
      panels.moderation.append(danger);
    }
  } else {
    panels.sessions.append(section('sessions', 'guest accounts do not have Clerk sessions.'));
  }
  const footer = element('div', 'admin-detail-footer');
  footer.append(button('refresh details', 'refresh', async btn => {
    if (btn.getAttribute('aria-busy') === 'true') return;
    btn.setAttribute('aria-busy', 'true');
    await loadUser(user);
    if (btn.isConnected) {
      btn.removeAttribute('aria-busy');
    }
  }));
  content.append(footer);
  const previousControl = detail.contains(document.activeElement) ? document.activeElement : null;
  const scrollTop = detail.querySelector('.admin-detail-panels')?.scrollTop || 0;
  detail.replaceChildren(content);
  content.querySelector('.admin-detail-panels').scrollTop = scrollTop;
  // Live socket updates replace these controls; never leave focus on a detached node.
  if (previousControl) {
    const replacement = previousControl.id ? document.getElementById(previousControl.id)
      : [...detail.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === previousControl.dataset.focusKey);
    (replacement && !replacement.closest('[hidden]') ? replacement
      : detail.querySelector('[role="tab"][aria-selected="true"]')).focus();
  }
}

async function moderateUser(user, action, btn) {
  const payload = { email: user.email };
  if (action === 'mute') {
    const choice = await showModal({ message: `mute ${user.username}\n\nchoose a duration:`,
      options: [['15', '15 minutes'], ['60', '1 hour'], ['1440', '24 hours'], ['forever', 'permanently'], ['custom', 'custom minutes']], defaultValue: '60', confirmLabel: 'next' });
    if (choice === null) return;
    if (choice === 'custom') {
      const minutes = await showModal({ message: 'mute duration in minutes:', withInput: true, defaultValue: '60', confirmLabel: 'next' });
      if (minutes === null) return;
      if (!/^\d+$/.test(minutes) || !Number.isSafeInteger(Number(minutes)) || Number(minutes) <= 0) {
        showToast('enter a positive whole number of minutes', 'error'); return;
      }
      payload.duration = Number(minutes);
    } else payload.duration = choice === 'forever' ? null : Number(choice);
  }
  if (['ban', 'kick', 'mute'].includes(action)) {
    const reason = await showModal({ message: `${action} ${user.username}?\n\nreason:`, withInput: true, confirmLabel: `${action} user` });
    if (reason === null) return;
    payload.reason = reason || 'no reason given';
  } else {
    const confirmed = await showModal({ message: `${action} ${user.username}?`, confirmLabel: `${action} user` });
    if (!confirmed) return;
  }
  await performAction(`/admin/user/${action}`, payload, btn, `user ${ { ban: 'banned', unban: 'unbanned', kick: 'kicked', mute: 'muted', unmute: 'unmuted' }[action] }`, user);
}

async function performAction(url, payload, btn, successMessage, user) {
  if (pendingActions.has(user.email)) {
    showToast('an action for this user is already in progress');
    return null;
  }
  pendingActions.add(user.email);
  const originalContent = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('loading');
  btn.setAttribute('aria-busy', 'true');
  btn.innerHTML = '<i class="ti ti-loader admin-loading-spinner" aria-hidden="true"></i> working…';
  try {
    const data = await readJson(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session, ...payload }) });
    if (!data.success) throw new Error('action failed');
    applyActionStateToOpenUser(url, payload, data, user);
    showToast(url.endsWith('/kick') && !data.kicked ? 'user was offline' : successMessage, 'success');
    requestUsers();
    if (drawer.open && selectedUser?.email === user.email) await loadUser(selectedUser);
    return data;
  } catch (error) {
    showToast(error.message, 'error');
    return null;
  } finally {
    pendingActions.delete(user.email);
    btn.classList.remove('loading');
    btn.removeAttribute('aria-busy');
    if (btn.isConnected) {
      btn.disabled = false;
      btn.innerHTML = originalContent;
    }
  }
}

function applyActionStateToOpenUser(url, payload, data, user) {
  if (!drawer.open || selectedUser?.email !== user.email) return;
  const updates = {};
  for (const field of ['role', 'verified', 'redVerified', 'hidden', 'banned', 'muted', 'muteUntil', 'muteReason', 'clerkBanned']) {
    if (Object.hasOwn(data, field)) updates[field] = data[field];
  }
  if (url === '/admin/hide') updates.hidden = true;
  if (url === '/admin/unhide') updates.hidden = false;
  if (url === '/admin/user/ban') {
    updates.banned = true;
    updates.banReason = payload.reason;
  }
  if (url === '/admin/user/unban') {
    updates.banned = false;
    updates.banReason = null;
  }
  if (url === '/admin/user/mute') {
    updates.muted = true;
    updates.muteUntil = data.until;
    updates.muteReason = data.muteReason;
  }
  if (url === '/admin/user/unmute') {
    updates.muted = false;
    updates.muteUntil = null;
    updates.muteReason = null;
  }
  if (url === '/admin/user/ban-clerk') updates.clerkBanned = true;
  if (!Object.keys(updates).length) return;
  selectedUser = { ...selectedUser, ...updates };
  // Ignore detail requests started before this action while the fresh record loads.
  detailRequest++;
  renderDetail(selectedUser);
}

async function viewUserSessions(user) {
  if (document.querySelector('.admin-sessions-modal')) return;
  const modal = element('div', 'admin-sessions-modal');
  const content = element('div', 'admin-sessions-modal-content');
  const header = element('div', 'admin-sessions-modal-header');
  header.append(element('div', 'admin-sessions-modal-title', 'active sessions'));
  const close = button('', 'x', () => modal.remove(), 'admin-sessions-modal-close');
  close.setAttribute('aria-label', 'close active sessions');
  header.append(close);
  const body = element('div', 'admin-sessions-modal-body');
  const footer = element('div', 'admin-sessions-modal-footer');
  const revokeAll = button('revoke all sessions', 'logout', async btn => {
    const confirmed = await showModal({ message: `revoke all sessions for ${user.username}?`, confirmLabel: 'revoke all' });
    if (!confirmed) return;
    const data = await performAction('/admin/user/revoke-all-sessions', { email: user.email, clerkId: user.clerkId }, btn, 'all sessions revoked', user);
    if (data) await loadSessions();
  }, 'admin-sessions-revoke-all-btn');
  revokeAll.disabled = true;
  footer.append(revokeAll);
  content.append(header, body, footer);
  modal.append(content);
  document.body.append(modal);
  modal.addEventListener('click', event => {
    if (event.target === modal && document.querySelector('#modal-overlay').style.display === 'none') modal.remove();
  });
  async function loadSessions() {
    if (body.contains(document.activeElement)) close.focus();
    body.replaceChildren(element('div', 'admin-sessions-loading', 'loading sessions…'));
    revokeAll.disabled = true;
    try {
      const data = await readJson(`/admin/user/sessions?email=${encodeURIComponent(user.email)}`, { credentials: 'same-origin' });
      if (!modal.isConnected) return;
      if (!Array.isArray(data.sessions)) throw new Error('could not load sessions');
      body.replaceChildren();
      if (!data.sessions.length) {
        body.append(element('div', 'admin-sessions-empty', 'no active sessions')); return;
      }
      const list = element('div', 'admin-sessions-list');
      data.sessions.forEach(sess => {
        const item = element('div', 'admin-session-item');
        const itemHeader = element('div', 'admin-session-header');
        const info = element('div', 'admin-session-info');
        info.append(element('div', 'admin-session-id', sess.id));
        const meta = element('div', 'admin-session-meta');
        if (sess.lastActiveAt) meta.append(element('span', 'admin-session-meta-item', `active ${timeAgo(sess.lastActiveAt)}`));
        if (sess.clientType) meta.append(element('span', 'admin-session-meta-item', sess.clientType));
        info.append(meta);
        const revoke = button('revoke', 'logout', async btn => {
          const confirmed = await showModal({ message: 'revoke this session?', confirmLabel: 'revoke session' });
          if (!confirmed) return;
          const data = await performAction('/admin/user/revoke-session', { email: user.email, sessionId: sess.id }, btn, 'session revoked', user);
          if (data) await loadSessions();
        }, 'admin-session-revoke-btn');
        itemHeader.append(info, revoke);
        item.append(itemHeader);
        list.append(item);
      });
      body.append(list);
      revokeAll.disabled = user.email === ownEmail;
    } catch (error) {
      if (modal.isConnected) body.replaceChildren(element('div', 'admin-sessions-empty', error.message), button('try again', 'refresh', loadSessions));
    }
  }
  await loadSessions();
}

searchInput.addEventListener('input', () => {
  currentPage = 1;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(requestUsers, 220);
});
[roleFilter, typeFilter, sortInput].forEach(input => input.addEventListener('change', () => {
  currentPage = 1;
  requestUsers();
}));
document.querySelectorAll('[data-user-view]').forEach(btn => btn.addEventListener('click', () => {
  activeView = btn.dataset.userView;
  document.querySelectorAll('[data-user-view]').forEach(view => view.setAttribute('aria-pressed', String(view === btn)));
  currentPage = 1;
  requestUsers();
}));
resetButton.addEventListener('click', () => {
  searchInput.value = '';
  roleFilter.value = typeFilter.value = 'all';
  sortInput.value = 'online';
  activeView = 'all';
  document.querySelectorAll('[data-user-view]').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.userView === 'all')));
  currentPage = 1;
  requestUsers();
  searchInput.focus();
});
previousPageButton.addEventListener('click', () => {
  if (currentPage <= 1) return;
  currentPage--;
  requestUsers();
});
nextPageButton.addEventListener('click', () => {
  if (currentPage >= totalPages) return;
  currentPage++;
  requestUsers();
});
refreshButton.addEventListener('click', requestUsers);
document.querySelector('#admin-user-drawer-close').addEventListener('click', closeUser);
backdrop.addEventListener('click', () => closeUser(true));
drawer.addEventListener('cancel', event => { event.preventDefault(); closeUser(); });
socket.on('adminUserlist', response => {
  if (!response || !Array.isArray(response.users) || response.requestId !== listRequestId) return;
  usersData = response.users;
  currentPage = response.page || 1;
  totalPages = response.totalPages || 1;
  totalMatches = response.total || 0;
  totalUsers = response.totalUsers || 0;
  userCounts = response.counts || {};
  listPartial = !!response.partial;
  loaded = true;
  finishRefresh();
  renderUsers();
  if (selectedUser && drawer.open) {
    const updated = response.selectedUser;
    if (updated) loadUser({ ...selectedUser, ...updated });
  }
});
socket.on('adminUsersChanged', requestUsers);
socket.on('connect', requestUsers);
socket.on('disconnect', () => { finishRefresh(); showDirectoryState('connection lost', 'reconnecting to the server…', true); });
socket.on('connect_error', () => { finishRefresh(); showDirectoryState('could not connect', 'check your connection or sign in again.', true); });
socket.on('init', data => { uRole = data.role || 'user'; });
socket.on('adminIdentity', data => {
  ownEmail = data.email;
  uRole = data.role;
  if (selectedUser?.messageCount !== undefined) renderDetail(selectedUser);
});
socket.on('uRole', role => { uRole = role; if (selectedUser?.messageCount !== undefined) renderDetail(selectedUser); });
['userBanned', 'userUnbanned', 'userMuted', 'userUnmuted', 'userRoleChanged', 'userVerificationChanged'].forEach(name => {
  socket.on(name, email => {
    if (selectedUser?.email === email && drawer.open) loadUser(selectedUser);
    requestUsers();
  });
});
socket.on('commandError', message => showToast(message, 'error'));
if (['beta.chattm.app', 'localhost', '127.0.0.1'].includes(location.hostname)) {
  const brand = document.querySelector('.admin-brand h1');
  const badge = element('span', 'dev-badge', location.hostname === 'beta.chattm.app' ? 'beta' : 'dev');
  brand.append(badge);
}
