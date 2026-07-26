import { parse } from "path/win32";

const session = localStorage.getItem('session');
if (!session) window.location.href = '/';

const socket = io(window.location.origin, {
  auth: { session },
  transports: ["websocket"]
});

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
    renderDetailView(selectedUser);
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
  const reason = showModal({
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
        renderDetailView(u);
      });
      sidebar.appendChild(row);
    }
  }

  section('accounts', hca);
  section('guests', guests);
}

function renderDetailView(user) {
  const detail = document.querySelector('#admin-users-detail');
  detail.innerHTML = '';

  const content = document.createElement('div');
  content.className = 'admin-users-detail-content';

  const header = document.createElement('div');
  header.className = 'admin-detail-header';

  const avatar = document.createElement('div');
  avatar.className = 'admin-detail-avatar';
  if (user.avatar) {
    const img = document.createElement('img');
    img.src = user.avatar;
    avatar.appendChild(img);
  } else {
    avatar.textContent = (user.username || "?")[0].toUpperCase();
    avatar.style.backgroundColor = `hsl(${nameHash(user.username) % 360}, 55%, 38%)`;
    avatar.style.color = "#fff";
  }
  header.appendChild(avatar);

  const info = document.createElement('div');
  info.className = 'admin-detail-info';

  const name = document.createElement('div');
  name.className = 'admin-detail-name';
  name.style.color = getNameColor(user.username);
  name.textContent = user.username;

  // Add badges directly to name element
  if (user.role === "owner") {
    name.appendChild(makeBadge(
      "https://cdn.chattm.app/verified_owner.png",
      20,
      "this user is verified to be the owner of chat™"
    ));
  } else if (user.role === "admin" || user.role === "mod") {
    name.appendChild(makeBadge(
      "https://cdn.chattm.app/verified.png",
      20,
      "this user has been verified"
    ));
  }

  if (user.redVerified) {
    name.appendChild(makeBadge(
      "https://cdn.chattm.app/verified_red.png",
      20,
      "this checkmark is only held by my girlfriend and z. you cannot get it."
    ));
  }

  if (user.guest) {
    const guestText = document.createElement('span');
    guestText.style.cssText = 'font-size: 11px; color: var(--muted); padding: 2px 6px; background: var(--bg); border-radius: 3px; text-transform: uppercase; font-weight: 600; margin-left: 8px;';
    guestText.textContent = 'guest';
    name.appendChild(guestText);
  }

  info.appendChild(name);

  const email = document.createElement('div');
  email.className = 'admin-detail-email';
  email.textContent = user.email;
  info.appendChild(email);

  header.appendChild(info);
  content.appendChild(header);

  const accountSection = document.createElement('div');
  accountSection.className = 'admin-detail-section';

  const accountTitle = document.createElement('div');
  accountTitle.className = 'admin-detail-section-title';
  accountTitle.textContent = 'account info';
  accountSection.appendChild(accountTitle);

  const fields = [
    { label: "role", value: user.role || 'user' },
    { label: "status", value: user.online ? "online" : 'offline' },
    { label: "account type", value: user.guest ? 'guest' : 'registered' },
    { label: 'verified', value: user.verified ? 'yes' : 'no' },
  ];

  fields.forEach(({ label, value }) => {
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

    accountSection.appendChild(field);
  });

  content.appendChild(accountSection);

  const actionsSection = document.createElement('div');
  actionsSection.className = 'admin-detail-section';

  const actionsTitle = document.createElement('div');
  actionsTitle.className = 'admin-detail-section-title';
  actionsTitle.textContent = 'quick actions';
  actionsSection.appendChild(actionsTitle);

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'admin-detail-actions';
  actionsDiv.innerHTML = `
    <button>Ban User</button>
    <button>Kick User</button>
    <button>Mute User</button>
    <button>${user.verified ? 'Unverify' : 'Verify'} User</button>
  `;
  actionsSection.appendChild(actionsDiv);

  content.appendChild(actionsSection);
  detail.appendChild(content);
}

socket.on('adminUserlist', renderUsers);

socket.on('connect', () => {
  socket.emit('getAdminUsers');
});

socket.on('commandError', (msg) => alert(msg));
