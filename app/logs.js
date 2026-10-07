const session = localStorage.getItem('session');
if (!session) window.location.href = '/';

const list = document.querySelector('#admin-logs-list');
const state = document.querySelector('#admin-logs-state');
const tableWrap = document.querySelector('#admin-logs-table-wrap');
const results = document.querySelector('#admin-logs-results');
const pagination = document.querySelector('#admin-logs-pagination');
const pageLabel = document.querySelector('#admin-logs-page');
const previousButton = document.querySelector('#admin-logs-prev');
const nextButton = document.querySelector('#admin-logs-next');
const searchInput = document.querySelector('#admin-logs-search');
const categoryInput = document.querySelector('#admin-logs-category');
const fromInput = document.querySelector('#admin-logs-from');
const toInput = document.querySelector('#admin-logs-to');
const resetButton = document.querySelector('#admin-logs-reset');
const drawer = document.querySelector('#admin-log-drawer');
const backdrop = document.querySelector('#admin-log-drawer-backdrop');
const detail = document.querySelector('#admin-logs-detail');

let currentPage = 1;
let totalPages = 1;
let total = 0;
let entries = [];
let requestId = 0;
let searchTimer = null;

const actionLabels = {
  'chat.mute': 'mute chat',
  'chat.mute_change': 'change chat mute state',
  'chat.unmute': 'unmute chat',
  'channel.clear': 'clear channel history',
  'channel.create': 'create channel',
  'channel.delete': 'delete channel',
  'emoji.add': 'add emoji',
  'emoji.delete': 'delete emoji',
  'emoji.reload': 'reload emojis',
  'emoji.replace': 'replace emoji image',
  'guests.disable': 'disable guest access',
  'guests.enable': 'enable guest access',
  'maintenance.disable': 'disable maintenance',
  'maintenance.enable': 'enable maintenance',
  'maintenance.change': 'change maintenance state',
  'message.delete': 'delete another user’s message',
  'user.ban': 'ban user',
  'user.clerk_ban': 'ban Clerk account',
  'user.hide': 'hide user',
  'user.kick': 'kick user',
  'user.mute': 'mute user',
  'user.red_unverify': 'remove red verification',
  'user.red_verify': 'grant red verification',
  'user.reset_strikes': 'reset user strikes',
  'user.role_change': 'change user role',
  'user.session_revoke': 'revoke session',
  'user.sessions_revoke_all': 'revoke all sessions',
  'user.set_color': 'set user color',
  'user.unban': 'unban user',
  'user.unban_ip': 'remove IP ban',
  'user.unhide': 'show user in lists',
  'user.unmute': 'unmute user',
  'user.unverify': 'remove regular verification',
  'user.verify': 'grant regular verification',
};

const detailLabels = {
  channel: 'channel',
  color: 'color',
  duration: 'duration',
  failure: 'failure reason',
  httpStatus: 'HTTP status',
  messageId: 'message ID',
  messagesRemoved: 'messages removed',
  newRole: 'new role',
  previousMuted: 'chat mute before action',
  previousReason: 'previous maintenance reason',
  previousRole: 'previous role',
  previouslyEnabled: 'maintenance before action',
  previouslyRedVerified: 'red verification before action',
  previouslyVerified: 'regular verification before action',
  reason: 'reason',
  role: 'requested role',
  shortcode: 'emoji shortcode',
  source: 'source',
  muted: 'requested state',
};

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function actionLabel(action) {
  return actionLabels[action] || String(action || 'unknown action').replace(/[._]/g, ' ');
}

function formatDate(timestamp, exact = false) {
  if (!Number.isFinite(Number(timestamp))) return 'unknown time';
  return new Intl.DateTimeFormat(undefined, exact
    ? { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }
    : { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
  ).format(new Date(Number(timestamp)));
}

function outcomeLabel(outcome) {
  return ({ success: 'completed', failed: 'failed', denied: 'denied' })[outcome] || 'unknown';
}

function showState(title, message, retry = false) {
  const heading = element('strong', '', title);
  const text = element('span', '', message);
  state.replaceChildren(heading, text);
  if (retry) {
    const button = element('button', '', 'try again');
    button.type = 'button';
    button.addEventListener('click', requestLogs);
    state.append(button);
  }
  state.hidden = false;
  tableWrap.hidden = true;
  pagination.hidden = true;
}

function updateFilters() {
  resetButton.hidden = !(searchInput.value.trim() || categoryInput.value || fromInput.value || toInput.value);
}

function dateBound(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (endOfDay) date.setDate(date.getDate() + 1);
  return date.getTime();
}

function currentFilters() {
  return {
    search: searchInput.value.trim(),
    category: categoryInput.value,
    from: dateBound(fromInput.value),
    to: dateBound(toInput.value, true),
  };
}

function renderRows() {
  list.replaceChildren();
  for (const entry of entries) {
    const row = element('tr', 'admin-directory-row admin-log-row');
    row.dataset.logId = entry.id;
    row.setAttribute('aria-label', `${actionLabel(entry.action)} by ${entry.actorUsername || entry.actorEmail}, ${outcomeLabel(entry.outcome)}`);
    const time = element('td', 'admin-log-time', formatDate(entry.occurredAt));
    const actionCell = element('td', 'admin-log-action');
    actionCell.append(element('strong', '', actionLabel(entry.action)), element('small', '', entry.category));
    const actorCell = element('td', 'admin-log-actor');
    actorCell.append(element('strong', '', entry.actorUsername || entry.actorEmail));
    if (entry.actorUsername) actorCell.append(element('small', '', entry.actorEmail));
    actorCell.append(element('span', 'admin-log-role', entry.actorRole));
    const target = element('td', 'admin-log-target', entry.target || '—');
    const outcome = element('td');
    outcome.append(element('span', `admin-log-outcome ${entry.outcome}`, outcomeLabel(entry.outcome)));
    row.append(time, actionCell, actorCell, target, outcome);
    const selected = drawer.open && String(entry.id) === drawer.dataset.logId;
    if (selected) row.classList.add('selected');
    row.setAttribute('aria-pressed', String(selected));
    list.append(row);
  }
}

function renderList() {
  renderRows();
  state.hidden = true;
  tableWrap.hidden = entries.length === 0;
  const first = total ? (currentPage - 1) * 50 + 1 : 0;
  const last = total ? first + entries.length - 1 : 0;
  results.textContent = total ? `showing ${first}–${last} of ${total.toLocaleString()} actions` : '0 matching actions';
  pageLabel.textContent = `page ${currentPage} of ${totalPages}`;
  previousButton.disabled = currentPage <= 1;
  nextButton.disabled = currentPage >= totalPages;
  pagination.hidden = totalPages <= 1 || total === 0;
  if (!entries.length) {
    showState(total ? 'no matching actions' : 'no action history yet', total
      ? 'try another search, category, or date range.'
      : 'new staff actions will appear here.');
    results.textContent = total ? '0 matching actions' : 'no actions recorded';
  }
}

async function requestLogs() {
  const request = ++requestId;
  updateFilters();
  const filters = currentFilters();
  if (filters.from !== null && filters.to !== null && filters.to <= filters.from) {
    entries = [];
    total = 0;
    totalPages = 1;
    showState('invalid date range', 'the end date must be the same as or later than the start date.');
    results.textContent = 'check the selected dates';
    return;
  }

  const params = new URLSearchParams({ page: String(currentPage) });
  if (filters.search) params.set('search', filters.search);
  if (filters.category) params.set('category', filters.category);
  if (filters.from !== null) params.set('from', String(filters.from));
  if (filters.to !== null) params.set('to', String(filters.to));
  state.hidden = false;
  tableWrap.hidden = true;
  showState('loading action logs…', '');
  try {
    const response = await fetch(`/admin/logs/data?${params}`, { cache: 'no-store' });
    const data = await response.json();
    if (request !== requestId) return;
    if (!response.ok || data.error) throw new Error(data.error || 'failed to load action logs');
    entries = Array.isArray(data.records) ? data.records : [];
    currentPage = data.page || currentPage;
    total = data.total || 0;
    totalPages = data.totalPages || 1;
    renderList();
  } catch (error) {
    if (request !== requestId) return;
    showState('could not load action logs', error.message || 'refresh to try again.', true);
    results.textContent = 'action log request failed';
  }
}

function detailField(container, label, value) {
  if (value === undefined || value === null || value === '') return;
  const row = element('div', 'admin-detail-field');
  row.append(element('span', 'admin-detail-field-label', label));
  row.append(element('span', 'admin-detail-field-value', typeof value === 'object' ? JSON.stringify(value, null, 2) : value));
  container.append(row);
}

function openEntry(entry) {
  if (!entry) return;
  document.querySelectorAll('.admin-log-row').forEach(row => {
    const selected = String(row.dataset.logId) === String(entry.id);
    row.classList.toggle('selected', selected);
    row.setAttribute('aria-pressed', String(selected));
  });
  drawer.dataset.logId = entry.id;
  const heading = element('div', 'admin-log-detail-heading');
  const outcome = element('span', `admin-log-outcome ${entry.outcome}`, outcomeLabel(entry.outcome));
  heading.append(element('h4', '', actionLabel(entry.action)), outcome);

  const actorSection = element('section', 'admin-detail-section');
  actorSection.append(element('h5', 'admin-detail-section-title', 'actor'));
  detailField(actorSection, 'username', entry.actorUsername || 'unavailable');
  detailField(actorSection, 'email', entry.actorEmail);
  detailField(actorSection, 'role at the time', entry.actorRole);

  const actionSection = element('section', 'admin-detail-section');
  actionSection.append(element('h5', 'admin-detail-section-title', 'action'));
  detailField(actionSection, 'event', entry.action);
  detailField(actionSection, 'category', entry.category);
  detailField(actionSection, 'target', entry.target || 'not specified');
  detailField(actionSection, 'result', outcomeLabel(entry.outcome));
  detailField(actionSection, 'time', formatDate(entry.occurredAt, true));

  const contextSection = element('section', 'admin-detail-section');
  contextSection.append(element('h5', 'admin-detail-section-title', 'details'));
  const detailEntries = Object.entries(entry.details || {});
  if (!detailEntries.length) contextSection.append(element('p', '', 'no additional details were recorded.'));
  for (const [key, value] of detailEntries) {
    detailField(contextSection, detailLabels[key] || key.replace(/[._]/g, ' '), value);
  }
  detail.replaceChildren(heading, actorSection, actionSection, contextSection);
  if (!drawer.open) drawer.show();
  backdrop.hidden = false;
  document.body.classList.add('admin-drawer-open');
}

function closeEntry(animate = false) {
  if (!drawer.open) return;
  window.closeAdminDrawer(drawer, () => {
    drawer.close();
    backdrop.hidden = true;
    document.body.classList.remove('admin-drawer-open');
    delete drawer.dataset.logId;
    document.querySelectorAll('.admin-log-row.selected').forEach(row => {
      row.classList.remove('selected');
      row.setAttribute('aria-pressed', 'false');
    });
  }, animate);
}

list.addEventListener('click', event => {
  const row = event.target.closest('.admin-log-row');
  if (row) openEntry(entries.find(entry => String(entry.id) === row.dataset.logId));
});
document.querySelector('#admin-log-drawer-close').addEventListener('click', () => closeEntry(false));
backdrop.addEventListener('click', () => closeEntry(true));
drawer.addEventListener('cancel', event => { event.preventDefault(); closeEntry(false); });
document.querySelector('#admin-logs-refresh').addEventListener('click', requestLogs);
previousButton.addEventListener('click', () => { if (currentPage > 1) { currentPage--; requestLogs(); } });
nextButton.addEventListener('click', () => { if (currentPage < totalPages) { currentPage++; requestLogs(); } });
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { currentPage = 1; requestLogs(); }, 250);
});
for (const filter of [categoryInput, fromInput, toInput]) {
  filter.addEventListener('change', () => { currentPage = 1; requestLogs(); });
}
resetButton.addEventListener('click', () => {
  searchInput.value = '';
  categoryInput.value = '';
  fromInput.value = '';
  toInput.value = '';
  currentPage = 1;
  requestLogs();
});

requestLogs();
