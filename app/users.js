const session = localStorage.getItem('session');
if (!session) window.location.href = '/';

const socket = io(window.location.origin, {
  auth: { session },
  transports: ["websocket"]
});

let uRole = 'user'


function nameHash(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hash;
}

function getNameColor(name) {
  if (!name) return "var(--muted)";
  if (name.toLowerCase() === "emma") return "hotpink";
  return `hsl(${nameHash(name) % 360}, 70%, 55%)`;
}

function makeBadge(src, size, tooltip) {
  const wrap = document.createElement('span');
  wrap.className = 'badge-wrap';
  wrap.dataset.tooltip = tooltip;
  const img = document.createElement('img');
  img.src = src;
  img.style.cssText = `width:${size}px;height:${size}px;vertical-align:middle;margin-left:4px;position:relative;top:-1px`;
  wrap.appendChild(img);
  return wrap;
}

function showModal({ message, withInput = false, defaultValue = '' }) {
  return new Promise((resolve) => {
    const overlay = document.querySelector('#modal-overlay');
    const msgEl = document.querySelector('#modal-message');
    const inputEl = document.querySelector('#modal-input');
    const confirmBtn = document.querySelector('#modal-confirm');
    const cancelBtn = document.querySelector('#modal-cancel');

    msgEl.textContent = message;
    inputEl.style.display = withInput ? "block" : "none";
    inputEl.value = defaultValue;
    overlay.style.display = "flex";
    if (withInput) inputEl.focus();

    function cleanUp(result) {
      overlay.style.display = "none";
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      if (withInput) inputEl.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onConfirm() {
      cleanUp(withInput ? inputEl.value : true);
    }
    function onCancel() {
      cleanUp(withInput ? null : false);
    }
    function onKey(e) {
      if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    if (withInput) inputEl.addEventListener("keydown", onKey);
  });
}

function showToast(message, type = 'info') {
  const container = document.querySelector('#toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'opacity 0.2s, transform 0.2s';
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard', 'success');
  }).catch(() => {
    showToast('Failed to copy', 'error');
  });
}

async function fetchUserInfo(email) {
  try {
    const res = await fetch(`/admin/user/info?session=${encodeURIComponent(session)}&email=${encodeURIComponent(email)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error('failed to fetch user info: ', e);
    return null
  }
}

async function refreshDetailView() {
  if (!selectedUser) return
  const info = await fetchUserInfo(selectedUser.email)
  if (info) {
    selectedUser = { ...selectedUser, ...info };
    lesbians(selectedUser);
  }
}

async function banUser(email, username) {
  const reason = await showModal({
    message: `ban ${username}?\n\nreason:`,
    withInput: true,
    defaultValue: 'bad'
  });
  if (!reason) return

  try {
    const res = await fetch('/admin/user/ban', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session, email, reason })
    });
    const data = await res.json();
    if (data.success) {
      showToast('user banned!', 'success');
      await refreshDetailView()
      socket.emit('getAdminUsers');
    } else {
      showToast(data.error || 'failed to ban user', 'error')
    }
  } catch (e) {
    showToast('error: ' + e.message, 'error')
  }
}

async function kickUser(email, username) {
  const reason = await showModal({
    message: `kick ${username}?\n\nreason:`,
    withInput: true,
    defaultValue: 'oops my finger slipped'
  });
  if (!reason) return

  try {
    const res = await fetch('/admin/user/kick', {
      method: "POST",
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session, email, reason })
    });
    const data = await res.json()
    if (data.success) {
      showToast(data.kicked ? 'user kicked' : 'user was offline', 'success')
    } else {
      showToast(data.errror || 'failed to kick', 'error')
    }
  } catch (e) {
    showToast('error: ' + e.message, 'error')
  }
}

async function muteUser(email, username) {
  const durationChoice = await showModal({
    message: `mute ${username}?\n\n duration: 15m, 1h, 24h, forever, or custom`,
    withInput: true,
    defaultValue: '1h'
  });
  if (!durationChoice) return

  let duration;
  const choice = durationChoice.toLowerCase().trim();
  if (choice === "15m") duration = 15;
  else if (choice === '1h') duration = 60;
  else if (choice === '24h') duration = 1440;
  else if (choice === 'forever') duration = null;
  else {
    duration = parseInt(choice);
    if (isNaN(duration) || duration <= 0) {
      showToast('invalid duration', 'error');
      return
    }
  }

  const reason = await showModal({
    message: 'reason:',
    withInput: true,
    defaultValue: 'not meowing enough'
  })
  if (!reason) return
  try {
    const res = await fetch('/admin/user/mute', {
      method: "POST",
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session, email, duration, reason })
    });
    const data = await res.json()
    if (data.success) {
      showToast('user muted', 'success');
      await refreshDetailView()
      socket.emit('getAdminUsers')
    } else {
      showToast(data.error || 'failed to mute user', 'error')
    }
  } catch (e) {
    showToast('error: ' + e.message, 'error')
  }
}

async function unmuteUser(email, username) {
  const confirmed = await showModal({
    message: `unmute ${username}?`
  });
  if (!confirmed) return;

  try {
    const res = await fetch('/admin/user/unmute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session, email })
    });
    const data = await res.json();
    if (data.success) {
      showToast('user unmuted', 'success');
      await refreshDetailView();
      socket.emit('getAdminUsers');
    } else {
      showToast(data.error || 'failed to unmute user', 'error');
    }
  } catch (e) {
    showToast('error: ' + e.message, 'error');
  }
}

async function changeUserRole(email, username) {
  const roleSelect = document.querySelector('#role-select')
  const newRole = roleSelect.value
  const currentRole = selectedUser.role

  if (newRole === currentRole) {
    showToast('role unchanged', 'info')
    return
  }

  const btn = event.target.closest('button')
  btn.classList.add('loading')
  btn.disabled = true

  try {
    const res = await fetch('/admin/user/role', {
      method: "POST",
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({session, email, role: newRole})
    });
    const data = await res.json()

    if (data.success) {
      showToast(`role updated to ${newRole}`, 'success')
      await refreshDetailView()
    } else {
      showToast(data.error || 'failed to update role', 'error')
    }
  } catch (e) {
    showToast('error: ' + e.message, 'error')
  } finally {
    btn.classList.remove('loading')
    btn.disabled = false;
  }
}

async function viewUserSessions(email, clerkId) {
  const modal = document.createElement('div')
  modal.className = 'admin-sessions-modal'

  const content = document.createElement('div')
  content.className = 'admin-sessions-modal-content'

  const header = document.createElement('div')
  header.className = 'admin-sessions-modal-header'

  const title = document.createElement('div')
  title.className = 'admin-sessions-modal-title'
  title.textContent = 'active sessions'
  header.appendChild(title)

  const closeBtn = document.createElement('button')
  closeBtn.className = 'admin-sessions-modal-close'
  closeBtn.innerHTML = '<i class="ti ti-x"</i>'
  closeBtn.onclick = () => modal.remove()
  header.appendChild(closeBtn)

  content.appendChild(header)

  const body = document.createElement('div')
  body.className = 'admin-sessions-modal-body'
  body.innerHTML = '<div class="admin-sessions-loading">loading sessions...</div>'
  content.appendChild(body)

  const footer = document.createElement('div')
  footer.className = 'admin-sessions-modal-footer'

  const revokeAllBtn = document.createElement('button')
  revokeAllBtn.className = 'admin-sessions-revoke-all-btn'
  revokeAllBtn.innerHTML = '<i class="ti ti-logout"></i> revoke all sessions'
  revokeAllBtn.onclick = () => revokeAllSessions(email, clerkId, modal)
  revokeAllBtn.disabled = true
  footer.appendChild(revokeAllBtn)

  content.appendChild(footer)

  modal.appendChild(content)
  document.body.appendChild(modal)

  modal.addEventListener('click', (e) => {
    if (e.target === modal && !document.querySelector('#modal-overlay[style*="flex"]')) modal.remove()
  })

  try {
    const res = await fetch(`/admin/user/sessions?session=${encodeURIComponent(session)}&email=${encodeURIComponent(email)}`)
    const data = await res.json()

    if (!res.ok || !data.sessions) {
      body.innerHTML = '<div class="admin-sessions-empty">Failed to load sessions</div>';
      return;
    }

    if (data.sessions.length === 0) {
      body.innerHTML = '<div class="admin-sessions-empty">No active sessions</div>';
      return;
    }

    const list = document.createElement('div')
    list.className = 'admin-sessions-list'

    data.sessions.forEach(sess => {
      const item = document.createElement('div')
      item.className = 'admin-session-item'

      const itemHeader = document.createElement('div')
      itemHeader.className = 'admin-session-header'

      const info = document.createElement('div')
      info.className = 'admin-session-info'

      const id = document.createElement('div')
      id.className = 'admin-session-id'
      id.textContent = sess.id
      info.appendChild(id)

      const meta = document.createElement('div')
      meta.className = 'admin-session-meta'

      if (sess.lastActiveAt) {
        const lastActive = document.createElement('span')
        lastActive.className = 'admin-session-meta-item'
        lastActive.innerHTML = '<i class="ti ti-clock></i> ${timeAgo(sess.lastActiveAt)}'
        meta.appendChild(lastActive)
      }

      if (sess.clientType) {
        const client = document.createElement('span')
        client.className = 'admin-session-meta-item'
        client.innerHTML = `<i class="ti ti-device-${sess.clientType === 'mobile' ? 'mobile' : 'laptop'}"></i> ${sess.clientType}`;
        meta.appendChild(client)
      }

      info.appendChild(meta)
      itemHeader.appendChild(info)

      const actions = document.createElement('div')
      actions.className = 'admin-session-actions'

      const revokeBtn = document.createElement('button')
      revokeBtn.className = 'admin-session-revoke-btn'
      revokeBtn.innerHTML = '<i class="ti ti-logout"></i> revoke'
      revokeBtn.onclick = () => revokeSession(email, sess.id, item, revokeAllBtn, data.sessions.length, modal)
      actions.appendChild(revokeBtn)

      itemHeader.appendChild(actions)
      item.appendChild(itemHeader)
      list.appendChild(item)
    })

    body.innerHTML = ''
    body.appendChild(list)
    revokeAllBtn.disabled = false

  } catch (e) {
    body.innerHTML = '<div class="admin-sessions-empty">Error loading sessions</div>';
    console.error('failed to fetch sessions:', e);
  }
}

async function revokeSession(email, sessionId, itemElement, revokeAllBtn, totalSessions, modal) {
  modal.style.display = 'none';

  const confirmed = await showModal({
    message: 'revoke session?',
    withInput: false
  })

  if (!confirmed) {
    modal.style.display = 'flex';
    return;
  }

  modal.style.display = 'flex';

  const btn = itemElement.querySelector('.admin-session-revoke-btn')
  btn.disabled = true
  btn.innerHTML = '<i class="ti ti-loader"></i> revoking...';

  try {
    const res = await fetch('/admin/user/revoke-session', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({session, email, sessionId})
    });
    const data = await res.json()

    if (data.success) {
      showToast('session revoked', 'success')
      itemElement.remove()

      const remaining = document.querySelectorAll('.admin-session-item').length
      if (remaining === 0) {
        document.querySelector('.admin-sessions-modal-body').innerHTML =
          '<div class="admin-sessions-empty">No active sessions</div>';
        revokeAllBtn.disabled = true
      }

      await refreshDetailView()
    } else {
      showToast(data.error || 'failed to revoke session', 'error')
      btn.disabled = false
      btn.innerHTML = '<i class="ti ti-logout"></i> revoke'
    }
  } catch (e) {
    showToast('error: ' + e.message, 'error')
    btn.disabled = false
    btn.innerHTML = '<i class="ti ti-logout"></i> revoke'
  }
}

async function revokeAllSessions(email, clerkId, modal) {
  modal.style.display = 'none';

  const confirmed = await showModal({
    message: 'revoke all sessions for this user?',
    withInput: false
  })

  if (!confirmed) {
    modal.style.display = 'flex';
    return;
  }

  modal.style.display = 'flex';

  const btn = modal.querySelector('.admin-sessions-revoke-all-btn')
  btn.disabled = true
  btn.innerHTML = '<i class="ti ti-loader"></i> revoking...'

  try {
    const res = await fetch('/admin/user/revoke-all-sessions', {
      method: "POST",
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({session,email})
    })
    const data = await res.json()

    if (data.success) {
      showToast(`revoked ${data.count} session(s)`, 'success')
      modal.remove()
      await refreshDetailView()
    } else {
      showToast(data.error || 'failed to revoke sessions', 'error')
      btn.disabled = false
      btn.innerHTML = '<i class="ti ti-logout></i> revoke all sessions'
    }
  } catch (e) {
    showToast('error: ' + e.message, 'error')
    btn.disabled = false
    btn.innerHTML = '<i class="ti ti-logout></i> revoke all sessions'
  }
}


let selectedUser = null;
let usersData = [];

function renderUsers(users) {
  usersData = users;
  const sidebar = document.querySelector('#admin-users-sidebar');
  sidebar.innerHTML = '';
  const hca = users.filter((u) => !u.guest);
  const guests = users.filter((u) => u.guest);

  function section(label, arr) {
    if (!arr.length) return;
    const header = document.createElement('div');
    header.className = "admin-user-section";
    header.textContent = `${label} (${arr.length})`;
    sidebar.appendChild(header);

    for (const u of arr) {
      const row = document.createElement("div");
      row.className = "admin-user-row";
      if (selectedUser && selectedUser.email === u.email) {
        row.classList.add('selected');
      }

      const avatar = document.createElement("div");
      avatar.className = "admin-user-avatar";
      if (u.avatar) {
        const img = document.createElement("img");
        img.src = u.avatar;
        avatar.appendChild(img);
      } else {
        avatar.textContent = (u.username || "?")[0].toUpperCase();
        avatar.style.backgroundColor = `hsl(${nameHash(u.username) % 360}, 55%, 38%)`;
        avatar.style.color = "#fff";
      }
      row.appendChild(avatar);

      const info = document.createElement('div');
      info.className = 'admin-user-info';

      const nameWrapper = document.createElement('div');
      nameWrapper.className = "admin-user-name";
      nameWrapper.style.color = getNameColor(u.username);
      nameWrapper.textContent = u.username;

      if (u.role === "owner") {
        const badge = makeBadge(
          "https://cdn.chattm.app/verified_owner.png",
          14,
          "this user is the owner of chat™"
        );
        nameWrapper.appendChild(badge);
      } else if (u.role === "mod" || u.role === "admin") {
        const badge = makeBadge(
          "https://cdn.chattm.app/verified.png",
          14,
          "this user is a moderator or admin"
        );
        nameWrapper.appendChild(badge);
      }

      if (u.redVerified) {
        const badge = makeBadge(
          "https://cdn.chattm.app/verified_red.png",
          14,
          'meow'
        );
        nameWrapper.appendChild(badge);
      }
      info.appendChild(nameWrapper);

      const email = document.createElement('div');
      email.className = 'admin-user-email';
      email.textContent = u.email;
      info.appendChild(email);

      row.appendChild(info);

      row.addEventListener('click', () => {
        selectedUser = u;
        renderUsers(usersData);
        lesbians(u);
      });
      sidebar.appendChild(row);
    }
  }

  section('accounts', hca);
  section('guests', guests);
}

async function lesbians(user) {
  const detail = document.querySelector('#admin-users-detail')
  detail.innerHTML = '<div class="admin-loading">Loading...</div>';

  const userInfo = await fetchUserInfo(user.email);
  if (!userInfo) {
    detail.innerHTML = '<div class="admin-users-detail-empty">Failed to load user details</div>';
    return;
  }

  const fullUser = { ...user, ...userInfo };
  selectedUser = fullUser

  detail.innerHTML = ''
  const content = document.createElement('div')
  content.className = 'admin-users-detailed-content'

  const header = document.createElement('div')
  header.className = 'admin-detail-header'

  const avatar = document.createElement('div')
  avatar.className = 'admin-detail-avatar';
  if (fullUser.avatar) {
    const img = document.createElement('img')
    img.src = fullUser.avatar
    avatar.appendChild(img)
  } else {
    avatar.textContent = (fullUser.username || "?")[0].toUpperCase();
    avatar.style.backgroundColor = `hsl(${nameHash(fullUser.username) % 360}, 55%, 38%)`;
    avatar.style.color = "#fff";
  }
  header.appendChild(avatar)

  const info = document.createElement('div')
  info.className = 'admin-detail-info'

  const name = document.createElement('div')
  name.className = 'admin-detail-name'
  name.style.color = getNameColor(fullUser.username)
  name.textContent = fullUser.username

  if (fullUser.role === "owner") {
    name.appendChild(makeBadge(
      "https://cdn.chattm.app/verified_owner.png",
      20,
      "this user is the owner of chat™"
    ));
  } else if (fullUser.role === "admin" || fullUser.role === "mod") {
    name.appendChild(makeBadge(
      "https://cdn.chattm.app/verified.png",
      20,
      "this user has been verified"
    ));
  }

  if (fullUser.redVerified) {
    name.appendChild(makeBadge(
      "https://cdn.chattm.app/verified_red.png",
      20,
      "meow"
    ));
  }

  if (fullUser.guest) {
    const guestText = document.createElement('span');
    guestText.style.cssText = 'font-size: 11px; color: var(--muted); padding: 2px 6px; background: var(--bg); border-radius: 3px; text-transform: uppercase; font-weight: 600; margin-left: 8px;';
    guestText.textContent = 'guest';
    name.appendChild(guestText);
  }

  info.appendChild(name);

  const email = document.createElement('div')
  email.className = 'admin-detail-email'
  email.textContent = fullUser.email
  info.appendChild(email)

  header.appendChild(info)
  content.appendChild(header)

  if (fullUser.banned || fullUser.muted) {
    const modStatusSection = document.createElement('div')
    modStatusSection.className = 'admin-detail-section'

    const modStatusTitle = document.createElement('div')
    modStatusTitle.className = 'admin-detail-section-title'
    modStatusTitle.textContent = 'moderation status'
    modStatusSection.appendChild(modStatusTitle)

    if (fullUser.banned) {
      const bannedBox = document.createElement('div')
      bannedBox.className = 'admin-mod-status-box danger'
      bannedBox.innerHTML = `<strong>banned</strong><br>${fullUser.banReason || 'no reason provided'}`
      modStatusSection.appendChild(bannedBox)
    }

    if (fullUser.muted) {
      const mutedBox = document.createElement('div');
      mutedBox.className = 'admin-mod-status-box warning';
      const until = fullUser.muteUntil ? ` until ${formatDate(fullUser.muteUntil)}` : ' (permanent)';
      mutedBox.innerHTML = `<strong>muted${until}</strong><br>${fullUser.muteReason || 'no reason provided'}`;
      modStatusSection.appendChild(mutedBox);
    }
    content.appendChild(modStatusSection)
  }

  const sectionsGrid = document.createElement('div')
  sectionsGrid.className = 'admin-users-sections-grid'

  const accountSection = document.createElement('div')
    accountSection.className = 'admin-detail-section'

    const accountTitle = document.createElement('div')
    accountTitle.className = 'admin-detail-section-title'
    accountTitle.textContent = 'account info'
    accountSection.appendChild(accountTitle)

    const accountFields = [
      { label: 'role', value: fullUser.role || 'user' },
      { label: 'status', value: fullUser.online ? 'online' : 'offline' },
      { label: 'account type', value: fullUser.guest ? 'guest' : 'registered' },
      { label: 'verified', value: (fullUser.role === 'mod' || fullUser.role === 'admin' || fullUser.role === 'owner') ? 'yes' : 'no' },
      { label: 'joined', value: formatDate(fullUser.createdAt) },
      { label: 'total messages', value: fullUser.messageCount.toLocaleString() },
    ];

    accountFields.forEach(({label,value}) => {
      const field = document.createElement('div')
      field.className = 'admin-detail-field'

      const fieldLabel = document.createElement('span')
      fieldLabel.className = 'admin-detail-field-label'
      fieldLabel.textContent = label
      field.appendChild(fieldLabel)

      const fieldValue = document.createElement('span')
      fieldValue.className = 'admin-detail-field-value'
      fieldValue.textContent = value
      field.appendChild(fieldValue)

      accountSection.appendChild(field)
    })

    sectionsGrid.appendChild(accountSection)

  if (!fullUser.guest && fullUser.clerkId) {
      const clerkSection = document.createElement('div');
      clerkSection.className = 'admin-detail-section';

      const clerkTitle = document.createElement('div');
      clerkTitle.className = 'admin-detail-section-title';
      clerkTitle.textContent = 'clerk info';
      clerkSection.appendChild(clerkTitle);

      const clerkIdField = document.createElement('div');
      clerkIdField.className = 'admin-detail-field';

      const clerkIdLabel = document.createElement('span');
      clerkIdLabel.className = 'admin-detail-field-label';
      clerkIdLabel.textContent = 'clerk id';
      clerkIdField.appendChild(clerkIdLabel);

      const clerkIdValue = document.createElement('span');
      clerkIdValue.className = 'admin-clerk-id';
      clerkIdValue.textContent = fullUser.clerkId.slice(0, 20) + '...';

      const copyBtn = document.createElement('button');
      copyBtn.innerHTML = '<i class="ti ti-copy"></i>';
      copyBtn.onclick = () => copyToClipboard(fullUser.clerkId);
      clerkIdValue.appendChild(copyBtn);

      clerkIdField.appendChild(clerkIdValue);
      clerkSection.appendChild(clerkIdField);

      const clerkFields = [
        { label: 'active sessions', value: fullUser.activeSessions.toString() },
        { label: 'last sign in', value: fullUser.lastSignInAt ? timeAgo(fullUser.lastSignInAt) : 'never' },
      ];

      clerkFields.forEach(({ label, value }) => {
        const field = document.createElement('div');
        field.className = 'admin-detail-field';

        const fieldLabel = document.createElement('span');
        fieldLabel.className = 'admin-detail-field-label';
        fieldLabel.textContent = label;
          field.appendChild(fieldLabel);

          const fieldValue = document.createElement('span');
          fieldValue.className = 'admin-detail-field-value';
          fieldValue.textContent = value;
          field.appendChild(fieldValue);

        clerkSection.appendChild(field);
      });

      const viewSessionsBtn = document.createElement('button')
      viewSessionsBtn.className = 'admin-sessions-btn'
      viewSessionsBtn.innerHTML = '<i class="ti ti-device-laptop"></i> view active sessions'
      viewSessionsBtn.onclick = () => viewUserSessions(fullUser.email, fullUser.clerkId)
      clerkSection.appendChild(viewSessionsBtn)

      sectionsGrid.appendChild(clerkSection);
  }

  const actionsSection = document.createElement('div');
    actionsSection.className = 'admin-detail-section';

    const actionsTitle = document.createElement('div');
    actionsTitle.className = 'admin-detail-section-title';
    actionsTitle.textContent = 'mod actions';
    actionsSection.appendChild(actionsTitle);

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'admin-detail-actions';

    if (!fullUser.banned) {
      const banBtn = document.createElement('button');
      banBtn.className = 'danger';
      banBtn.innerHTML = '<i class="ti ti-ban"></i> ban user';
      banBtn.onclick = () => banUser(fullUser.email, fullUser.username);
      actionsDiv.appendChild(banBtn);
    }

    const kickBtn = document.createElement('button');
    kickBtn.className = 'warning';
    kickBtn.innerHTML = '<i class="ti ti-user-x"></i> kick user';
    kickBtn.onclick = () => kickUser(fullUser.email, fullUser.username);
    actionsDiv.appendChild(kickBtn);

    if (fullUser.muted) {
      const unmuteBtn = document.createElement('button');
      unmuteBtn.className = 'success';
      unmuteBtn.innerHTML = '<i class="ti ti-volume"></i> unmute user';
      unmuteBtn.onclick = () => unmuteUser(fullUser.email, fullUser.username);
      actionsDiv.appendChild(unmuteBtn);
    } else {
      const muteBtn = document.createElement('button');
      muteBtn.className = 'warning';
      muteBtn.innerHTML = '<i class="ti ti-volume-3"></i> mute user';
      muteBtn.onclick = () => muteUser(fullUser.email, fullUser.username);
      actionsDiv.appendChild(muteBtn);
    }

    actionsSection.appendChild(actionsDiv);
    sectionsGrid.appendChild(actionsSection);

  // Role management section
  if (uRole === "owner" && !fullUser.guest) {
    const roleSection = document.createElement('div')
    roleSection.className = 'admin-detail-section'

    const roleTitle = document.createElement('div')
    roleTitle.className = 'admin-detail-section-title'
    roleTitle.textContent = 'role management'
    roleSection.appendChild(roleTitle)

    const roleSelector = document.createElement('div')
    roleSelector.className = 'admin-role-selector'

    const roleLabel = document.createElement('label')
    roleLabel.textContent = 'role:'
    roleSelector.appendChild(roleLabel)

    const roleSelect = document.createElement('select')
    roleSelect.id = 'role-select'
    const roles = ["user", 'mod', 'admin', 'owner']
    roles.forEach(role => {
      const option = document.createElement('option')
      option.value = role
      option.textContent = role
      if (role === fullUser.role) option.selected = true
      roleSelect.appendChild(option)
    })
    roleSelector.appendChild(roleSelect)

    const changeRoleBtn = document.createElement('button')
    changeRoleBtn.innerHTML = '<i class="ti ti-check"></i> update';
    changeRoleBtn.onclick = () => changeUserRole(fullUser.email, fullUser.username)
    roleSelector.appendChild(changeRoleBtn)

    roleSection.appendChild(roleSelector)
    sectionsGrid.appendChild(roleSection)
  }

    content.appendChild(sectionsGrid);
    detail.appendChild(content);
}
socket.on('adminUserlist', (users) => {
  renderUsers(users);
  if (selectedUser) {
    const updated = users.find(u => u.email === selectedUser.email);
    if (updated) {
      refreshDetailView();
    }
  }
});

socket.on('connect', () => {
  socket.emit('getAdminUsers');
});

socket.on('uRole', (role) => {
  uRole = role
})

socket.on('commandError', (msg) => showToast(msg, 'error'));
