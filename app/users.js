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
