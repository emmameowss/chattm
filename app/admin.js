const session = localStorage.getItem('session');
if (!session) window.location.href = "/";

const socket = io(window.location.origin, {
  auth: { session },
  transports: ["websocket"]
});

const emojiTab = document.querySelector('#emoji')

emojiTab.addEventListener('click', () => {
  showToast('the emoji tab has not been implemented, check back later', 'info')
})

const logsTab = document.querySelector('#logs')

logsTab.addEventListener('click', () => {
  showToast('action logs have not yet been implemented, check back later', 'info')
})

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

function updateChatMuteStatus(muted) {
  const statusItem = document.querySelector('#chat-mute-status');
  const statusValue = statusItem.querySelector(".admin-status-value");

  if (muted) {
    statusItem.classList.add('active');
    statusItem.classList.remove('inactive');
    statusValue.textContent = 'chat is muted';
  } else {
    statusItem.classList.add('inactive');
    statusItem.classList.remove('active');
    statusValue.textContent = "chat isn't muted";
  }
}

function updateMaintenanceStatus(maintenance, reason) {
  const statusItem = document.querySelector('#maintenance-status');
  const statusValue = statusItem.querySelector(".admin-status-value");

  if (maintenance) {
    statusItem.classList.add('active');
    statusItem.classList.remove('inactive');
    statusValue.textContent = reason || 'maintenance mode enabled';
  } else {
    statusItem.classList.add('inactive');
    statusItem.classList.remove('active');
    statusValue.textContent = 'maintenance mode is disabled';
  }
}

let chatMutedb = false;

socket.on("init", ({ chatMuted }) => {
  chatMutedb = chatMuted;
  updateChatMuteStatus(chatMuted);

  fetch('/maintenance')
    .then(r => r.json())
    .then(data => {
      updateMaintenanceStatus(data.maintenance, data.reason);
    })
    .catch(e => showToast(`failed to fetch maintenance status: ${e}`, "error"));
});

socket.on('mutechat', () => {
  chatMutedb = true;
  updateChatMuteStatus(true);
});

socket.on('unmutechat', () => {
  chatMutedb = false;
  updateChatMuteStatus(false);
});

socket.on("status", (statusText) => {
  if (statusText && statusText.toLowerCase().includes('maintenance')) {
    const reasonMatch = statusText.match(/maintenance mode:?\s*(.+)/i);
    const reason = reasonMatch ? reasonMatch[1] : statusText;
    updateMaintenanceStatus(true, reason);
  } else if (!statusText) {
    updateMaintenanceStatus(false, '');
  }
});

async function loadStats() {
  try {
    const res = await fetch('/stats');
    const data = await res.json();

    function formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ["B", "KB", "MB", "GB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    const rows = [
      ['accounts', data.users.toLocaleString()],
      ['total messages', data.messages.toLocaleString()],
      ['images uploaded', data.uploads.toLocaleString()],
      ['custom emojis', data.emoji.toLocaleString()],
      ['storage used', formatBytes(data.totalSize)],
    ];

    document.querySelector('#admin-stats-grid').innerHTML = rows
      .map(([label, value]) =>
        `<div class="admin-stat-row">
          <span class="admin-stat-label">${label}</span>
          <span class="admin-stat-value">${value}</span>
        </div>`
      )
      .join('');
  } catch (e) {
    document.querySelector('#admin-stats-grid').innerHTML =
      '<div class="admin-loading">failed to load stats</div>';
  }
}

socket.on('usercount', (count) => {
  document.querySelector('#admin-online-count').textContent = count;
  const label = document.querySelector('.admin-online-count span:last-child');
  label.textContent = count === 1 ? 'user online' : 'users online';
});

loadStats();

document.querySelector('#owner-mutechat-btn').addEventListener('click', async () => {
  try {
    const res = await fetch('/admin/mutechat', {
      method: "POST",
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session }),
    });
    const data = await res.json();
    if (data.success) {
      chatMutedb = data.muted;
      updateChatMuteStatus(data.muted);
      showToast(data.muted ? 'chat muted' : 'chat unmuted', 'success');
    } else {
      showToast('failed to toggle mute', 'error');
    }
  } catch (e) {
    showToast('error: ' + e.message, 'error');
  }
});

document.querySelector('#owner-maintenance-btn').addEventListener('click', async () => {
  const reason = await showModal({
    message: "maintenance reason (leave blank to turn off)",
    withInput: true,
    defaultValue: ''
  });
  if (reason === null) return;
  try {
    const res = await fetch('/admin/maintenance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session, reason })
    });
    const data = await res.json();
    if (data.success) {
      updateMaintenanceStatus(data.maintenance, data.reason);
      showToast(data.maintenance ? `maintenance on: ${data.reason}` : `maintenance disabled`, 'success');
    } else {
      showToast('failed to toggle maintenance', 'error');
    }
  } catch (e) {
    showToast('error: ' + e.message, 'error');
  }
});

document.querySelector('#owner-clear-btn').addEventListener('click', async () => {
  const confirmed = await showModal({
    message: 'clear main channel chat history?'
  });
  if (!confirmed) return;
  try {
    const res = await fetch('/admin/clear', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session, channel: 'main' })
    });
    const data = await res.json();
    if (data.success) {
      showToast('chat cleared', 'success');
    } else {
      showToast('failed to clear chat', 'error');
    }
  } catch (e) {
    showToast('error: ' + e.message, 'error');
  }
});

document.querySelector('#owner-refresh-version-btn').addEventListener('click', async () => {
  try {
    showToast('refreshing version status...', 'info');
    await fetch('/version?refresh=1');
    showToast('version status refreshed', 'success');
  } catch (e) {
    showToast('failed to refresh version', 'error');
  }
});

socket.on('commandError', (msg) => showToast(msg, 'error'));
