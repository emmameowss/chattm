if (!localStorage.getItem('session')) window.location.href = '/';

const reportList = document.querySelector('#admin-reports-list');
const reportState = document.querySelector('#admin-reports-state');
const reportTable = document.querySelector('#admin-reports-table-wrap');
const reportResults = document.querySelector('#admin-reports-results');
const reportPagination = document.querySelector('#admin-reports-pagination');
const reportPageLabel = document.querySelector('#admin-reports-page');
const reportSearch = document.querySelector('#admin-reports-search');
const reportStatus = document.querySelector('#admin-reports-status');
const reportReset = document.querySelector('#admin-reports-reset');
const reportDrawer = document.querySelector('#admin-report-drawer');
const reportBackdrop = document.querySelector('#admin-report-drawer-backdrop');
const reportDetail = document.querySelector('#admin-reports-detail');
const staffRole = document.body.dataset.staffRole;
const adminOrOwner = ['admin', 'owner'].includes(staffRole);

const reasons = {
  spam: 'spam',
  harassment: 'harassment',
  hateful_abusive: 'hateful or abusive content',
  inappropriate: 'inappropriate content',
  threats: 'threats',
  other: 'other',
};
const statuses = {
  open: 'open',
  resolved: 'resolved',
  dismissed: 'dismissed',
};

let entries = [];
let currentPage = 1;
let totalPages = 1;
let total = 0;
let requestId = 0;
let searchTimer = null;
let activeReport = null;

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function formatDate(timestamp, exact = false) {
  if (!Number.isFinite(Number(timestamp))) return 'unknown time';
  return new Intl.DateTimeFormat(undefined, exact
    ? { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }
    : { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
  ).format(new Date(Number(timestamp)));
}

function toast(message, type = 'info') {
  window.showAdminToast?.(message, type);
}

function showState(title, message, retry = false) {
  reportState.replaceChildren(element('strong', '', title), element('span', '', message));
  if (retry) {
    const button = element('button', '', 'try again');
    button.type = 'button';
    button.addEventListener('click', requestReports);
    reportState.append(button);
  }
  reportState.hidden = false;
  reportTable.hidden = true;
  reportPagination.hidden = true;
}

function renderRows() {
  reportList.replaceChildren();
  for (const report of entries) {
    const row = element('tr', 'admin-directory-row admin-report-row');
    row.dataset.reportId = report.id;
    const target = report.targetUsername || report.targetEmail || 'unknown account';
    row.setAttribute('aria-label', `${reasons[report.reason] || report.reason} report about ${target}, ${statuses[report.status] || report.status}`);
    const time = element('td', 'admin-report-time', formatDate(report.createdAt));
    const issue = element('td', 'admin-report-issue');
    issue.append(element('strong', '', reasons[report.reason] || report.reason));
    issue.append(element('small', '', report.targetType === 'message' ? 'message report' : 'account report'));
    const reporter = element('td', 'admin-report-person');
    reporter.append(element('strong', '', report.reporterUsername || report.reporterEmail));
    if (report.reporterUsername) reporter.append(element('small', '', report.reporterEmail));
    const targetCell = element('td', 'admin-report-person');
    targetCell.append(element('strong', '', target));
    if (report.targetEmail && report.targetUsername) targetCell.append(element('small', '', report.targetEmail));
    const status = element('td');
    status.append(element('span', `admin-report-status ${report.status}`, statuses[report.status] || report.status));
    row.append(time, issue, reporter, targetCell, status);
    const selected = reportDrawer.open && String(report.id) === reportDrawer.dataset.reportId;
    row.classList.toggle('selected', selected);
    row.setAttribute('aria-pressed', String(selected));
    reportList.append(row);
  }
}

function renderList() {
  renderRows();
  reportState.hidden = true;
  reportTable.hidden = entries.length === 0;
  const first = total ? (currentPage - 1) * 50 + 1 : 0;
  const last = total ? first + entries.length - 1 : 0;
  reportResults.textContent = total ? `showing ${first}–${last} of ${total.toLocaleString()} reports` : '0 matching reports';
  reportPageLabel.textContent = `page ${currentPage} of ${totalPages}`;
  document.querySelector('#admin-reports-prev').disabled = currentPage <= 1;
  document.querySelector('#admin-reports-next').disabled = currentPage >= totalPages;
  reportPagination.hidden = totalPages <= 1 || total === 0;
  if (!entries.length) {
    showState(total ? 'no matching reports' : reportStatus.value === 'open' ? 'no open reports' : 'no reports found', total
      ? 'try another search or status filter.'
      : reportStatus.value === 'open' ? 'new reports will appear here.' : 'reports matching this filter will appear here.');
    reportResults.textContent = total ? '0 matching reports' : 'no reports';
  }
  reportReset.hidden = !(reportSearch.value.trim() || reportStatus.value !== 'open');
}

async function requestReports() {
  const request = ++requestId;
  const params = new URLSearchParams({ page: String(currentPage), status: reportStatus.value });
  if (reportSearch.value.trim()) params.set('search', reportSearch.value.trim());
  showState('loading reports…', '');
  try {
    const response = await fetch(`/admin/reports/data?${params}`, { cache: 'no-store' });
    const data = await response.json();
    if (request !== requestId) return;
    if (!response.ok || data.error) throw new Error(data.error || 'failed to load reports');
    entries = Array.isArray(data.records) ? data.records : [];
    currentPage = data.page || currentPage;
    total = data.total || 0;
    totalPages = data.totalPages || 1;
    renderList();
  } catch (error) {
    if (request !== requestId) return;
    showState('could not load reports', error.message || 'refresh to try again.', true);
    reportResults.textContent = 'report request failed';
  }
}

function detailField(container, label, value) {
  if (value === undefined || value === null || value === '') return;
  const row = element('div', 'admin-detail-field');
  row.append(element('span', 'admin-detail-field-label', label));
  row.append(element('span', 'admin-detail-field-value', value));
  container.append(row);
}

function detailSection(title, description = '') {
  const section = element('section', 'admin-detail-section admin-report-section');
  section.append(element('h5', 'admin-detail-section-title', title));
  if (description) section.append(element('p', 'admin-report-help', description));
  return section;
}

function renderReportDetails(report) {
  activeReport = report;
  reportDrawer.dataset.reportId = report.id;
  document.querySelectorAll('.admin-report-row').forEach(row => {
    const selected = String(row.dataset.reportId) === String(report.id);
    row.classList.toggle('selected', selected);
    row.setAttribute('aria-pressed', String(selected));
  });

  const top = element('div', 'admin-report-detail-heading');
  top.append(element('h4', '', reasons[report.reason] || report.reason));
  top.append(element('span', `admin-report-status ${report.status}`, statuses[report.status] || report.status));

  const summary = detailSection('report');
  detailField(summary, 'report ID', `#${report.id}`);
  detailField(summary, 'submitted', formatDate(report.createdAt, true));
  detailField(summary, 'type', report.targetType === 'message' ? 'message' : 'account');
  detailField(summary, 'reason', reasons[report.reason] || report.reason);
  if (report.note) {
    const note = element('p', 'admin-report-submitted-note', report.note);
    summary.append(note);
  }

  const reporter = detailSection('reporter');
  detailField(reporter, 'username', report.reporterUsername || 'unknown');
  detailField(reporter, 'email', report.reporterEmail);
  detailField(reporter, 'account type', report.reporterEmail?.endsWith('@guest') ? 'guest' : 'registered');

  const target = detailSection('reported account');
  detailField(target, 'username', report.targetUsername || 'unknown');
  detailField(target, 'email', report.targetEmail);

  const sections = [top, summary, reporter, target];
  if (report.targetType === 'message') {
    const snapshot = report.snapshot || {};
    const evidence = detailSection('reported message');
    detailField(evidence, 'author', snapshot.authorUsername || report.targetUsername || 'unknown');
    detailField(evidence, 'channel', snapshot.channel || 'main');
    detailField(evidence, 'sent', formatDate(snapshot.time, true));
    if (snapshot.text) evidence.append(element('blockquote', 'admin-report-message-text', snapshot.text));
    if (snapshot.image) {
      try {
        const imageUrl = new URL(snapshot.image);
        if (['https:', 'http:'].includes(imageUrl.protocol)) {
          const image = element('img', 'admin-report-image');
          image.src = imageUrl.href;
          image.alt = 'reported message image';
          image.loading = 'lazy';
          evidence.append(image);
        }
      } catch {}
    }
    sections.push(evidence);
  }

  const notesSection = detailSection('internal notes', 'visible only to moderators and admins.');
  const notes = element('div', 'admin-report-notes');
  for (const note of report.internalNotes || []) {
    const item = element('article', 'admin-report-note');
    const heading = element('div', 'admin-report-note-heading');
    heading.append(element('strong', '', note.actorUsername || note.actorEmail));
    heading.append(element('span', '', `${note.actorRole} · ${formatDate(note.occurredAt)}`));
    item.append(heading, element('p', '', note.note));
    notes.append(item);
  }
  if (!(report.internalNotes || []).length) notes.append(element('p', 'admin-report-empty-notes', 'no internal notes yet.'));
  notesSection.append(notes);

  const noteForm = element('form', 'admin-report-note-form');
  const noteLabel = element('label', 'admin-report-note-label', 'add internal note');
  const noteInput = element('textarea');
  noteInput.id = 'admin-report-internal-note';
  noteLabel.htmlFor = noteInput.id;
  noteInput.name = 'note';
  noteInput.maxLength = 1000;
  noteInput.rows = 3;
  noteInput.placeholder = 'add an internal note';
  noteInput.required = true;
  const addNote = element('button', '', 'add note');
  addNote.type = 'submit';
  noteForm.append(noteLabel, noteInput, addNote);
  noteForm.addEventListener('submit', event => {
    event.preventDefault();
    saveInternalNote(report.id, noteInput, addNote);
  });
  notesSection.append(noteForm);
  sections.push(notesSection);

  const actions = element('div', 'admin-report-actions');
  if (report.status === 'open') {
    actions.append(actionButton('resolve report', 'positive', () => changeStatus(report, 'resolved')));
    actions.append(actionButton('dismiss report', 'danger', () => changeStatus(report, 'dismissed')));
  } else {
    actions.append(actionButton('reopen report', 'moderate', () => changeStatus(report, 'open')));
  }
  if (adminOrOwner) actions.append(actionButton('permanently delete', 'danger', () => deleteReportPermanently(report)));
  sections.push(actions);
  reportDetail.replaceChildren(...sections);
  if (!reportDrawer.open) reportDrawer.show();
  reportBackdrop.hidden = false;
  document.body.classList.add('admin-drawer-open');
}

function actionButton(label, variant, action) {
  const button = element('button', `admin-report-action ${variant}`, label);
  button.type = 'button';
  button.addEventListener('click', action);
  return button;
}

async function openReport(reportSummary) {
  try {
    const response = await fetch(`/admin/reports/${encodeURIComponent(reportSummary.id)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.report) throw new Error(data.error || 'could not load report details');
    renderReportDetails(data.report);
  } catch (error) {
    toast(error.message || 'could not load report details', 'error');
  }
}

async function saveInternalNote(reportId, input, button) {
  const note = input.value.trim();
  if (!note) return;
  button.disabled = true;
  try {
    const response = await fetch(`/admin/reports/${encodeURIComponent(reportId)}/note`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note }),
    });
    const data = await response.json();
    if (!response.ok || !data.report) throw new Error(data.error || 'could not save note');
    renderReportDetails(data.report);
    toast('internal note added', 'success');
  } catch (error) {
    toast(error.message || 'could not save note', 'error');
  } finally {
    button.disabled = false;
  }
}

async function changeStatus(report, status) {
  try {
    const response = await fetch(`/admin/reports/${encodeURIComponent(report.id)}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await response.json();
    if (!response.ok || !data.report) throw new Error(data.error || 'could not update report');
    toast(`report ${status}`, 'success');
    window.refreshAdminReportCount?.();
    if (reportStatus.value !== 'all' && reportStatus.value !== status) closeReport(false);
    else renderReportDetails(data.report);
    requestReports();
  } catch (error) {
    toast(error.message || 'could not update report', 'error');
  }
}

function confirmDelete() {
  return new Promise(resolve => {
    const overlay = document.querySelector('#modal-overlay');
    const message = document.querySelector('#modal-message');
    const confirm = document.querySelector('#modal-confirm');
    const cancel = document.querySelector('#modal-cancel');
    message.textContent = 'permanently delete this report and its internal notes? this cannot be undone.';
    confirm.textContent = 'delete report';
    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true;
      confirm.removeEventListener('click', onConfirm);
      cancel.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      confirm.textContent = 'confirm';
      window.closeAdminModal(overlay, () => resolve(value));
    };
    const onConfirm = () => finish(true);
    const onCancel = () => finish(false);
    const onBackdrop = event => { if (event.target === overlay) finish(false); };
    confirm.addEventListener('click', onConfirm);
    cancel.addEventListener('click', onCancel);
    overlay.addEventListener('click', onBackdrop);
    window.openAdminModal(overlay);
  });
}

async function deleteReportPermanently(report) {
  if (!await confirmDelete()) return;
  try {
    const response = await fetch(`/admin/reports/${encodeURIComponent(report.id)}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'could not delete report');
    closeReport(false);
    toast('report permanently deleted', 'success');
    window.refreshAdminReportCount?.();
    requestReports();
  } catch (error) {
    toast(error.message || 'could not delete report', 'error');
  }
}

function closeReport(animate = false) {
  if (!reportDrawer.open) return;
  window.closeAdminDrawer(reportDrawer, () => {
    reportDrawer.close();
    reportBackdrop.hidden = true;
    document.body.classList.remove('admin-drawer-open');
    delete reportDrawer.dataset.reportId;
    activeReport = null;
    document.querySelectorAll('.admin-report-row.selected').forEach(row => {
      row.classList.remove('selected');
      row.setAttribute('aria-pressed', 'false');
    });
  }, animate);
}

reportList.addEventListener('click', event => {
  const row = event.target.closest('.admin-report-row');
  if (row) openReport(entries.find(report => String(report.id) === row.dataset.reportId));
});
document.querySelector('#admin-report-drawer-close').addEventListener('click', () => closeReport(false));
reportBackdrop.addEventListener('click', () => closeReport(true));
reportDrawer.addEventListener('cancel', event => { event.preventDefault(); closeReport(false); });
document.querySelector('#admin-reports-refresh').addEventListener('click', requestReports);
document.querySelector('#admin-reports-prev').addEventListener('click', () => { if (currentPage > 1) { currentPage--; requestReports(); } });
document.querySelector('#admin-reports-next').addEventListener('click', () => { if (currentPage < totalPages) { currentPage++; requestReports(); } });
reportSearch.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { currentPage = 1; requestReports(); }, 250);
});
reportStatus.addEventListener('change', () => { currentPage = 1; requestReports(); });
reportReset.addEventListener('click', () => {
  reportSearch.value = '';
  reportStatus.value = 'open';
  currentPage = 1;
  requestReports();
});

requestReports();
