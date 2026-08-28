let unread = 0;
let activity = false;
let username = localStorage.getItem("username") || 'pending'
let audioctx = null;
let isOwner = false;

// nuke the old userids forever
function checkForUserId() {
  if (localStorage.getItem('userId') && localStorage.getItem('uIdGone') !== true) {
    localStorage.removeItem('userId')
    localStorage.setItem('uIdGone', true)
  }
}

checkForUserId()

// colors
function nameHash(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return hash;
}

function showStatus(msg, color = "gray") {
  const e = document.querySelector("#upload-status");
  e.textContent = msg;
  e.style.display = "block";
  e.style.color = color || "gray";
}

function hideStatus() {
  const e = document.querySelector("#upload-status");
  e.style.display = "none";
  e.textContent = "";
}

function getNameColor(name) {
  if (!name) return "var(--muted)";
  if (name.toLowerCase() === "emma") return "hotpink";
  return `hsl(${nameHash(name) % 360}, 70%, var(--name-lightness))`;
}

function isSystemMessage(data) {
  return data.username === "SYSTEM" && data.system;
}

// more button
const moreBtn = document.querySelector("#more-btn");
const moreMenu = document.querySelector("#more-menu");

moreBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const isOpen = moreMenu.classList.toggle("open");
  if (window.innerWidth > 600) {
    if (isOpen) {
      const menuRect = moreMenu.getBoundingClientRect();
      userlist.style.top = `${menuRect.bottom + 12}px`;
    } else {
      userlist.style.top = "";
    }
  }
});

document.addEventListener("click", (e) => {
  const modalOverlay = document.querySelector("#modal-overlay");
  if (modalOverlay.contains(e.target)) return;
  if (!moreMenu.contains(e.target) && e.target !== moreBtn) {
    moreMenu.classList.remove("open");
    userlist.style.top = "";
  }
});

// settings panel
const settingsBtn = document.querySelector("#settings-btn");
const settingsPanel = document.querySelector("#settings-panel");
const settingsBackdrop = document.querySelector("#settings-backdrop");
const settingsClose = document.querySelector("#settings-close");

function openSettings() {
  settingsPanel.style.display = "block";
  settingsBackdrop.style.display = "block";
  moreMenu.classList.remove("open");
  userlist.style.top = "";
}

function closeSettings() {
  settingsPanel.style.display = "none";
  settingsBackdrop.style.display = "none";
}

settingsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  openSettings();
});

settingsClose.addEventListener("click", closeSettings);
settingsBackdrop.addEventListener("click", closeSettings);

document.addEventListener("click", (e) => {
  if (
    settingsPanel.style.display !== "none" &&
    !settingsPanel.contains(e.target) &&
    e.target !== settingsBtn
  ) {
    closeSettings();
  }
});

function devInstanceBanner() {
  const devHosts = ["beta.chattm.app", "localhost", "127.0.0.1"];

  if (!devHosts.includes(window.location.hostname)) return;
  if (document.querySelector("#dev-banner")) return;

  if (window.location.hostname === "beta.chattm.app") {
    const banner = document.createElement("div");
    banner.id = "dev-banner";
    banner.textContent =
      "this is a beta instance of chat™ - things may not be very stable";
    document.body.appendChild(banner);
  } else {
    const banner = document.createElement("div");
    banner.id = "dev-banner";
    banner.textContent =
      "this is a dev instance of chat™ - things may not be stable and may break often";
    document.body.appendChild(banner);
  }
}


function loadVersionStatus(forceRefresh = false) {
  fetch(`/version${forceRefresh ? "?refresh=1" : ""}`)
    .then((r) => r.json())
    .then((v) => {
      if (v.upToDate === null) return;
      const el = document.querySelector("#version-status");
      el.classList.remove("outdated");
      if (v.upToDate) {
        el.textContent = `up to date (${v.currentCommit})`;
      } else if (v.ahead) {
        el.textContent = `${v.ahead} commit${v.ahead === 1 ? "" : "s"} ahead (${v.currentCommit})`;
      } else {
        el.textContent = `${v.behind} commit${v.behind === 1 ? "" : "s"} behind (${v.currentCommit})`;
        el.classList.add("outdated");
      }
    })
    .catch(() => {});
}
loadVersionStatus();

// lightbox
function lightbox(src) {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:1000;display:flex;align-items:center;justify-content:center;cursor:zoom-out";
  const img = document.createElement("img");
  img.src = src;
  img.style.cssText =
    "max-width:90vw;max-height:90vh;border-radius:6px;object-fit:contain";
  overlay.appendChild(img);
  overlay.addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
}

devInstanceBanner();

let customEmoji = {};

const flags = {
  "flag:pride":
    "linear-gradient(90deg,#ff0018,#ffa52c,#ffff41,#008018,#0000f9,#86007d)",
  "flag:gay":
    "linear-gradient(90deg,#078D70,#26CEAA,#98E8C1,#FFFFFF,#7BADE2,#5049CC)",
  "flag:trans": "linear-gradient(90deg,#55cdfc,#f7a8b8,#fff,#f7a8b8,#55cdfc)",
  "flag:bi": "linear-gradient(90deg,#d60270,#d60270,#9b4f96,#0038a8,#0038a8)",
  "flag:lesbian": "linear-gradient(90deg,#d62900,#ff9b55,#fff,#d461a6,#a50062)",
  "flag:nb": "linear-gradient(90deg,#fcf434,#fff,#9c59d1,#2c2c2c)",
};

function applyRedVerifiedColor(el) {
  el.style.color = "transparent";
  el.style.backgroundImage = "linear-gradient(135deg, #3d0a0f, #5a151c)";
  el.style.backgroundClip = "text";
  el.style.webkitBackgroundClip = "text";
}

function applyFlagColor(el, color) {
  const gradient = flags[color];
  if (gradient) {
    el.style.color = "transparent";
    el.style.backgroundImage = gradient;
    el.style.backgroundClip = "text";
    el.style.webkitBackgroundClip = "text";
  } else {
    el.style.color = color;
    el.style.backgroundImage = "";
    el.style.backgroundClip = "";
    el.style.webkitBackgroundClip = "";
  }
}

// hca stuff part 9 (live server really hates me)
const session = (() => {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const fromHash = hash.get("session");
  if (fromHash) {
    sessionStorage.setItem("newlogin", "1");
    localStorage.setItem("session", fromHash);
    window.history.replaceState({}, "", "/");
    return fromHash;
  }
  return localStorage.getItem("session");
})();

// the login / ban / maintenance screens are now standalone pages served
// server-side at GET / (see server.js). if we reach the chat bundle without a
// local session (e.g. localStorage was cleared but the cookie lingers), clear
// the stale cookie and let the server route us back to the login page.
if (!session) {
  window.location.href = "/signout";
  throw new Error("not authenticated");
}

function showUsernameSetupPanel() {
  return new Promise((resolve) => {
    const backdrop = document.querySelector("#username-setup-backdrop");
    const panel = document.querySelector("#username-setup-panel");
    const input = document.querySelector("#username-setup-input");
    const error = document.querySelector("#username-setup-error");
    backdrop.style.display = "block";
    panel.style.display = "flex";
    input.focus();
    function trySubmit() {
      const name = input.value.trim();
      if (!name || !/^[a-zA-Z0-9-]{1,20}$/.test(name)) {
        error.textContent = name
          ? "only letters, numbers, and hyphens (max 20 chars)"
          : "please enter a username";
        error.style.display = "block";
        input.focus();
        return;
      }
      backdrop.style.display = "none";
      panel.style.display = "none";
      resolve(name);
    }
    document
      .querySelector("#username-setup-submit")
      .addEventListener("click", trySubmit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") trySubmit();
    });
  });
}

if (session) {
  sessionStorage.removeItem("newlogin");

  let chosenUsername = null;
  try {
    const me = await fetch(`/me`, {
      credentials: 'same-origin'
    }).then(
      (r) => r.json(),
    );
    if (!me.guest && !me.username)
      chosenUsername = await showUsernameSetupPanel();
  } catch {}
  if (chosenUsername) username = chosenUsername;

  const socket = io(
    window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
      ? "http://localhost:3000"
      : window.location.origin, // set this to the ip/url of the site/proxy you're using for the backend server thing
    {
      auth: { session: localStorage.getItem("session") },
      transports: ["websocket"],
    },
  );
  const maxmessages = 100;
  const MAX_SIZE = 50 * 1024 * 1024; // 50mb limit

  // profile button (replaces old username form)
  let myBio = "";
  let myStatus = "";
  let myPronouns = "";
  let myAvatar = null;
  let myVerified = false;
  let myRedVerified = false;
  let myColor = null;
  let role = "user";

  function updateProfileBtn() {
    const btn = document.querySelector("#profile-btn");
    btn.innerHTML = "";
    if (myAvatar) {
      const img = document.createElement("img");
      img.src = myAvatar;
      btn.appendChild(img);
    } else {
      const pl = document.createElement("span");
      pl.className = "btn-avatar-placeholder";
      pl.textContent = (username || "?")[0];
      pl.style.backgroundColor = `hsl(${nameHash(username) % 360}, 55%, 38%)`;
      btn.appendChild(pl);
    }
    const nameSpan = document.createElement("span");
    nameSpan.textContent = username;
    if (myRedVerified) applyRedVerifiedColor(nameSpan);
    else applyFlagColor(nameSpan, myColor || getNameColor(username));
    btn.appendChild(nameSpan);
    if (role === "owner") {
      const badge = document.createElement("img");
      badge.src = "https://cdn.chattm.app/verified_owner.png";
      badge.style.cssText =
        "width:13px;height:13px;vertical-align:middle;margin-left:3px";
      btn.appendChild(badge);
    } else if (myRedVerified) {
      btn.appendChild(makeRedCheckBadge(13));
    } else if (role === "mod") {
      const badge = document.createElement("img");
      badge.src = "https://cdn.chattm.app/verified.png";
      badge.style.cssText =
        "width:13px;height:13px;vertical-align:middle;margin-left:3px";
      btn.appendChild(badge);
    }
  }

  updateProfileBtn();
  document.querySelector("#profile-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    openProfile(username);
  });

  // mute button
  let notifymuted = localStorage.getItem("notifymuted") === "true";
  const mutebtn = document.querySelector("#mute-btn");
  function applyMute() {
    mutebtn.innerHTML = notifymuted
      ? '<i class="ti ti-bell-off"></i> mute sound'
      : '<i class="ti ti-bell"></i> mute sound';
  }
  applyMute();

  mutebtn.addEventListener("click", () => {
    notifymuted = !notifymuted;
    localStorage.setItem("notifymuted", notifymuted);
    applyMute();
  });

  const themebtn = document.querySelector("#theme-btn");
  let lightMode = localStorage.getItem("lightMode") === "true";

  function applyTheme() {
    document.documentElement.classList.toggle("light", lightMode);
    themebtn.innerHTML = lightMode
      ? '<i class="ti ti-moon"></i> dark mode'
      : '<i class="ti ti-sun"></i> light mode';
  }

  applyTheme();
  themebtn.addEventListener("click", () => {
    lightMode = !lightMode;
    localStorage.setItem("lightMode", lightMode);
    applyTheme();
  });

  let renderedHistory = []; // for re-render on mode toggle
  let currentChannel = "main";
  let channelList = ["main"];

  const tooltipsbtn = document.querySelector("#tooltips-btn");
  let tooltipsHidden = localStorage.getItem("tooltipsHidden") === "true";

  function applyTooltips() {
    document.documentElement.classList.toggle("no-tooltips", tooltipsHidden);
    tooltipsbtn.innerHTML = tooltipsHidden
      ? '<i class="ti ti-info-circle"></i> show tooltips'
      : '<i class="ti ti-info-circle"></i> hide tooltips';
  }

  applyTooltips();
  tooltipsbtn.addEventListener("click", () => {
    tooltipsHidden = !tooltipsHidden;
    localStorage.setItem("tooltipsHidden", tooltipsHidden);
    applyTooltips();
  });

  const charCounterBtn = document.querySelector("#char-counter-btn")
  const charCounterEl = document.querySelector("#char-counter")
  let showCharCounter = localStorage.getItem("showCharCounter") !== "false"
  const MAX_MESSAGE_LENGTH = 2000

  function applyCharCounter() {
    charCounterBtn.innerHTML = showCharCounter
      ? '<i class="ti ti-abc"></i> hide character counter'
      : '<i class="ti ti-abc"></i> show character counter';
    charCounterEl.style.display = showCharCounter ? "block" : "none";
    if (showCharCounter) updateCharCounter()
  }

  function updateCharCounter() {
    if (!showCharCounter) return
    const len = document.querySelector("#message-input").value.length
    charCounterEl.textContent = `${len}/${MAX_MESSAGE_LENGTH}`
    charCounterEl.classList.toggle("char-counter-warn", len > MAX_MESSAGE_LENGTH * 0.9)
    charCounterEl.classList.toggle("char-counter-over", len > MAX_MESSAGE_LENGTH)
  }

  applyCharCounter()
  charCounterBtn.addEventListener('click', () => {
    showCharCounter = !showCharCounter
    localStorage.setItem('showCharCounter', showCharCounter)
    applyCharCounter()
  })

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

  // avatar
  const avatarInput = document.querySelector("#avatar-input");

  socket.on("savedAvatar", (url) => {
    myAvatar = url;
    updateProfileBtn();
    // refresh avatar wrap in panel if open and showing own profile
    if (
      profilePanel &&
      profilePanel.style.display !== "none" &&
      profilePanel.dataset.profileUsername === username
    ) {
      renderProfileAvatarWrap(url);
    }
  });

  // Profile pictures are stored in Clerk. Grab the clerk-js instance that
  // index.html loads (it's ready well before anyone edits their profile).
  async function getClerk() {
    for (let i = 0; i < 100; i++) {
      if (window.Clerk && window.Clerk.loaded && window.Clerk.user)
        return window.Clerk;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("clerk not ready");
  }

  let pendingAvatar = undefined; // undefined=no change, null=remove, File=new pic
  let suppressProfileClose = false;

  avatarInput.addEventListener("change", () => {
    const file = avatarInput.files[0];
    if (!file) return;
    avatarInput.value = "";
    // stage the file; it's uploaded to Clerk when the user hits save
    pendingAvatar = file;
    renderProfileAvatarWrap(URL.createObjectURL(file), true);
  });

  // prevent panel close when file dialog opens
  avatarInput.addEventListener("click", () => {
    suppressProfileClose = true;
    setTimeout(() => {
      suppressProfileClose = false;
    }, 500);
  });

  const STATUS_OPTIONS = [
    { value: "online", label: "Online", color: "online" },
    { value: "idle", label: "Idle", color: "idle" },
    { value: "dnd", label: "Do Not Disturb", color: "dnd" },
  ];

  function statusDot(value) {
    const dot = document.createElement("span");
    dot.className = `status-dot ${value || "online"}`;
    return dot;
  }

  function statusLabel(value) {
    return STATUS_OPTIONS.find((o) => o.value === value)?.label ?? "Online";
  }

  // saved profile
  socket.on("savedProfile", (data) => {
    if (!data) return;
    myBio = data.bio ?? "";
    myStatus = data.status ?? "online";
    myPronouns = data.pronouns ?? "";
    // refresh panel if showing own profile
    const panel = document.querySelector("#profile-panel");
    if (
      panel.style.display !== "none" &&
      panel.dataset.profileUsername === username
    ) {
      renderStatusDisplay(myStatus, true);
      document.querySelector("#profile-bio-display").textContent = myBio;
    }
  });

  // profile panel
  const profilePanel = document.querySelector("#profile-panel");

  function openProfile(targetUsername, editMode = false) {
    profilePanel.style.display = "block";
    document.querySelector("#profile-backdrop").style.display = "block";
    profilePanel.dataset.profileUsername = targetUsername;
    // clear previous content
    document.querySelector("#profile-avatar-wrap").innerHTML = "";
    document.querySelector("#profile-name-row").innerHTML = "";
    document.querySelector("#profile-pronouns-display").textContent = "";
    document.querySelector("#profile-status-display").textContent = "...";
    document.querySelector("#profile-bio-display").textContent = "";
    document.querySelector("#profile-edit").style.display = "none";
    document.querySelector("#profile-edit-btn").style.display = "none";
    socket.emit("getProfile", targetUsername);
    if (editMode) profilePanel.dataset.editOnLoad = "1";
  }

  function renderProfileAvatarWrap(avatarUrl, editable = false) {
    const avWrap = document.querySelector("#profile-avatar-wrap");
    avWrap.innerHTML = "";
    avWrap.onclick = null;

    // inner: relative container so overlay sits on top of avatar
    const inner = document.createElement("div");
    inner.className = "avatar-inner";
    inner.style.cssText =
      "position:relative;display:inline-block;overflow:hidden;border-radius:10px";

    if (avatarUrl) {
      const img = document.createElement("img");
      img.src = avatarUrl;
      img.className = "profile-avatar";
      // free the blob: URL used for local previews once it's decoded
      if (avatarUrl.startsWith("blob:"))
        img.addEventListener("load", () => URL.revokeObjectURL(avatarUrl));
      inner.appendChild(img);
    } else {
      const pl = document.createElement("div");
      pl.className = "profile-avatar-placeholder";
      pl.textContent = (username || "?")[0];
      pl.style.backgroundColor = `hsl(${nameHash(username) % 360}, 55%, 38%)`;
      inner.appendChild(pl);
    }

    if (editable) {
      const overlay = document.createElement("div");
      overlay.className = "avatar-edit-overlay";
      overlay.innerHTML = '<i class="ti ti-camera"></i>';
      inner.appendChild(overlay);
      inner.style.cursor = "pointer";
      inner.addEventListener("click", (e) => {
        e.stopPropagation();
        avatarInput.click();
      });

      if (avatarUrl) {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "avatar-remove-btn";
        removeBtn.textContent = "remove";
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          pendingAvatar = null;
          renderProfileAvatarWrap(null, true);
        });
        avWrap.appendChild(inner);
        avWrap.appendChild(removeBtn);
        return;
      }
    }

    avWrap.appendChild(inner);
  }

  function renderStatusDisplay(currentStatus, editable = false) {
    const sd = document.querySelector("#profile-status-display");
    sd.innerHTML = "";
    sd.appendChild(statusDot(currentStatus || "online"));
    sd.appendChild(
      document.createTextNode(statusLabel(currentStatus || "online")),
    );

    if (!editable) {
      sd.style.cursor = "";
      sd.onclick = null;
      return;
    }

    const chevron = document.createElement("i");
    chevron.className = "ti ti-chevron-down";
    chevron.style.cssText = "font-size:11px;color:var(--muted);margin-left:3px";
    sd.appendChild(chevron);
    sd.style.cursor = "pointer";
    sd.title = "change status";
    sd.style.position = "relative";

    let dropdown = document.createElement("div");
    dropdown.className = "status-dropdown";
    dropdown.style.cssText =
      "position:absolute;left:50%;transform:translateX(-50%);top:calc(100% + 4px);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:4px;z-index:600;min-width:170px;display:none;flex-direction:column;gap:2px;box-shadow:0 4px 16px rgba(0,0,0,0.4)";
    STATUS_OPTIONS.forEach((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.value = opt.value;
      btn.className =
        "status-option" +
        (opt.value === (currentStatus || "online") ? " active" : "");
      btn.appendChild(statusDot(opt.value));
      btn.appendChild(document.createTextNode(opt.label));
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        socket.emit("setStatus", opt.value);
        myStatus = opt.value;
        dropdown.style.display = "none";
      });
      dropdown.appendChild(btn);
    });
    sd.appendChild(dropdown);
    sd.onclick = (e) => {
      e.stopPropagation();
      dropdown.style.display =
        dropdown.style.display === "none" ? "flex" : "none";
    };
  }

  socket.on("profileData", (data) => {
    if (!data) {
      document.querySelector("#profile-status-display").textContent =
        "profile not found";
      return;
    }
    const panel = profilePanel;
    const color = data.color || getNameColor(data.username);

    // avatar (static initially; becomes editable when edit section opens)
    renderProfileAvatarWrap(data.avatar, false);

    // name row
    const nameRow = document.querySelector("#profile-name-row");
    nameRow.innerHTML = "";
    const nameEl = document.createElement("span");
    if (data.redVerified) applyRedVerifiedColor(nameEl);
    else applyFlagColor(nameEl, color);
    nameEl.textContent = data.username;
    nameRow.appendChild(nameEl);
    if (data.isOwner)
      nameRow.appendChild(
        makeBadge(
          "https://cdn.chattm.app/verified_owner.png",
          14,
          "this user is verified to be the owner of chat™",
        ),
      );
    else if (data.redVerified) nameRow.appendChild(makeRedCheckBadge(14));
    else if (data.role === "mod")
      nameRow.appendChild(
        makeBadge(
          "https://cdn.chattm.app/verified.png",
          14,
          "this user is a moderator",
        ),
      );

    document.querySelector("#profile-pronouns-display").textContent =
      data.pronouns || "";

    // status display
    const isOwnProfile = data.username === username;
    if (isOwnProfile) {
      myVerified = data.verified;
      myRedVerified = data.redVerified ?? false;
      role = data.role ?? 'user';
      updateProfileBtn();
    }

    if (!data.online && !isOwnProfile) {
      const sd = document.querySelector("#profile-status-display");
      sd.innerHTML = "";
      sd.appendChild(statusDot("offline"));
      const offlineText = document.createElement("span");
      if (data.lastSeen) {
        const diff = Date.now() - data.lastSeen;
        let rel;
        if (diff < 60000) rel = "just now";
        else if (diff < 3600000) rel = `${Math.floor(diff / 60000)}m ago`;
        else if (diff < 86400000) rel = `${Math.floor(diff / 3600000)}h ago`;
        else if (diff < 2592000000) rel = `${Math.floor(diff / 86400000)}d ago`;
        else rel = new Date(data.lastSeen).toLocaleDateString();
        offlineText.textContent = `last seen ${rel}`;
      } else {
        offlineText.textContent = "Offline";
      }
      sd.appendChild(offlineText);
      sd.style.cursor = "";
      sd.onclick = null;
    } else {
      renderStatusDisplay(data.status || "online", isOwnProfile);
    }

    // bio
    document.querySelector("#profile-bio-display").textContent = data.bio || "";
    const editBtn = document.querySelector("#profile-edit-btn");
    const editActions = document.querySelector("#profile-edit-actions");
    editBtn.style.display = isOwnProfile ? "" : "none";
    editBtn.disabled = data.isGuest;
    editBtn.style.opacity = data.isGuest ? "0.4" : "";
    editBtn.title = data.isGuest ? "guests can't edit their profile" : "";

    function openEdit() {
      document.querySelector("#profile-username-input").value = data.username;
      const pronounsInput = document.querySelector("#profile-pronouns-input");
      pronounsInput.value = data.pronouns || "";
      pronounsInput.disabled = data.isGuest;
      const bioInput = document.querySelector("#profile-bio-input");
      bioInput.value = data.bio || "";
      bioInput.disabled = data.isGuest;
      bioInput.placeholder = data.isGuest
        ? "guests can't set a bio"
        : "bio (optional)";
      document.querySelector("#profile-edit").style.display = "flex";
      editBtn.style.display = "none";
      editActions.style.display = "flex";
      if (!data.isGuest) renderProfileAvatarWrap(myAvatar, true);
    }

    function closeEdit() {
      document.querySelector("#profile-edit").style.display = "none";
      editBtn.style.display = "";
      editActions.style.display = "none";
      renderProfileAvatarWrap(myAvatar, false);
    }

    editBtn.onclick = openEdit;

    if (panel.dataset.editOnLoad === "1") {
      delete panel.dataset.editOnLoad;
      openEdit();
    }
  });

  document
    .querySelector("#profile-save-btn")
    .addEventListener("click", async () => {
      const newName = document
        .querySelector("#profile-username-input")
        .value.trim();
      const newPronouns = document
        .querySelector("#profile-pronouns-input")
        .value.trim();
      const newBio = document.querySelector("#profile-bio-input").value.trim();
      if (newName && newName !== username) socket.emit("setUsername", newName);
      if (newPronouns !== myPronouns) socket.emit("setPronouns", newPronouns);
      if (newBio !== myBio) socket.emit("setBio", newBio);

      // profile picture changes go through Clerk; the server then re-syncs
      // from the authoritative Clerk image
      if (pendingAvatar !== undefined) {
        const avatarChange = pendingAvatar;
        pendingAvatar = undefined;
        try {
          const clerk = await getClerk();
          await clerk.user.setProfileImage({
            file: avatarChange === null ? null : avatarChange,
          });
          socket.emit("refreshAvatar");
        } catch (e) {
          showToast("couldn't update profile picture", 'error');
          renderProfileAvatarWrap(myAvatar, false);
        }
      }

      document.querySelector("#profile-edit").style.display = "none";
      document.querySelector("#profile-edit-btn").style.display = "";
      document.querySelector("#profile-edit-actions").style.display = "none";
    });

  document
    .querySelector("#profile-cancel-btn")
    .addEventListener("click", () => {
      pendingAvatar = undefined;
      renderProfileAvatarWrap(myAvatar, false);
      document.querySelector("#profile-edit").style.display = "none";
      document.querySelector("#profile-edit-btn").style.display = "";
      document.querySelector("#profile-edit-actions").style.display = "none";
    });

  function closeProfile() {
    profilePanel.style.display = "none";
    document.querySelector("#profile-backdrop").style.display = "none";
    document.querySelector("#profile-edit").style.display = "none";
    document.querySelector("#profile-edit-actions").style.display = "none";
    document.querySelector("#profile-edit-btn").style.display = "none";
    document.querySelector("#profile-avatar-wrap").innerHTML = "";
    pendingAvatar = undefined;
  }

  document
    .querySelector("#profile-close")
    .addEventListener("click", closeProfile);

  document.addEventListener("click", (e) => {
    // close any open status dropdown
    const dropdown = document.querySelector(".status-dropdown");
    if (
      dropdown &&
      !dropdown.contains(e.target) &&
      !document.querySelector("#profile-status-display")?.contains(e.target)
    ) {
      dropdown.style.display = "none";
    }
    if (suppressProfileClose) return;
    if (
      profilePanel.style.display !== "none" &&
      !profilePanel.contains(e.target) &&
      e.target !== document.querySelector("#profile-btn")
    ) {
      closeProfile();
    }
  });

  // custom emoji picker
  const emojiPicker = document.querySelector("#emoji-picker");
  const emojiBtn = document.querySelector("#emoji-btn");

  function renderEmojiPicker() {
    emojiPicker.innerHTML = "";
    const entries = Object.entries(customEmoji);
    for (const [shortcode, url] of entries) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.title = shortcode;
      const img = document.createElement("img");
      img.dataset.src = url; // lazy - only load when picker opens
      btn.appendChild(img);
      btn.addEventListener("click", () => {
        const input = document.querySelector("#message-input");
        const pos = input.selectionStart;
        const val = input.value;
        const insert = shortcode + " ";
        input.value = val.slice(0, pos) + insert + val.slice(pos);
        input.selectionStart = input.selectionEnd = pos + insert.length;
        input.focus();
        emojiPicker.style.display = "none";
      });
      emojiPicker.appendChild(btn);
    }
  }

  socket.on("emoji", (map) => {
    customEmoji = map;
    renderEmojiPicker();
  });
  socket.on("emojiUpdate", (map) => {
    customEmoji = map;
    renderEmojiPicker();
  });

  emojiBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = emojiPicker.style.display === "none";
    emojiPicker.style.display = opening ? "grid" : "none";
    if (opening) {
      // lazy-load images now that the picker is visible
      emojiPicker.querySelectorAll("img[data-src]").forEach((img) => {
        img.src = img.dataset.src;
        delete img.dataset.src;
      });
    }
  });

  document.addEventListener("click", (e) => {
    if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
      emojiPicker.style.display = "none";
    }
  });

  // typing indicator stuff
  let typeTimeout;
  document.querySelector("#message-input").addEventListener("input", () => {
    socket.emit("typing");
    clearTimeout(typeTimeout);
    typeTimeout = setTimeout(() => socket.emit("stopTyping"), 2000);
    updateCharCounter()
  });

  const typingUsers = new Set();

  function updateTypingIndicator() {
    const ind = document.querySelector("#typing-indicator");
    if (typingUsers.size === 0) {
      ind.textContent = "";
    } else if (typingUsers.size >= 3) {
      ind.textContent = "several people are typing...";
    } else {
      const names = [...typingUsers].join(", ");
      ind.textContent = `${names} ${typingUsers.size === 1 ? "is" : "are"} typing...`;
    }
  }

  socket.on("typing", (name) => {
    typingUsers.add(name);
    updateTypingIndicator();
  });

  socket.on("stopTyping", (name) => {
    typingUsers.delete(name);
    updateTypingIndicator();
  });

  // join only appears when active function
  function activitya() {
    if (!activity) {
      activity = true;
      socket.emit("userActive");
    }
  }

  // message history
  socket.on("history", (messages) => {
    document.querySelector("ul").innerHTML = ""; // clear (needed when switching channels)
    renderedHistory = messages;
    lastMsgMeta = null;
    atBottom = false; // suppress per-message scrolls during batch render
    messages.forEach((data) => renderMessage(data));
    atBottom = true;
    msgList.scrollTop = msgList.scrollHeight;
  });

  // ─── Channels ───────────────────────────────────────────────────────────────
  const channelsListEl = document.querySelector("#channels-list");
  const addChannelBtn = document.querySelector("#add-channel-btn");

  function renderChannels() {
    channelsListEl.innerHTML = "";
    channelList.forEach((name) => {
      const item = document.createElement("div");
      item.className =
        "channel-item" + (name === currentChannel ? " active" : "");
      const label = document.createElement("span");
      label.className = "channel-name";
      label.textContent = name;
      item.appendChild(label);
      item.addEventListener("click", () => switchChannel(name));
      if (isOwner && name !== "main") {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "channel-delete";
        del.textContent = "×";
        del.title = "delete channel";
        del.addEventListener("click", async (e) => {
          e.stopPropagation();
          const ok = await showModal({
            message: `delete #${name}? all its messages will be removed.`,
          });
          if (ok) socket.emit("deleteChannel", name);
        });
        item.appendChild(del);
      }
      channelsListEl.appendChild(item);
    });
  }

  function switchChannel(name) {
    if (name === currentChannel) return;
    document.querySelector("ul").innerHTML = "";
    renderedHistory = [];
    lastMsgMeta = null;
    socket.emit("switchChannel", name);
  }

  addChannelBtn.addEventListener("click", async () => {
    const raw = await showModal({
      message: "channel name (a-z, 0-9, - ; max 24)",
      withInput: true,
    });
    const name = (raw ?? "").trim().toLowerCase().replace(/\s+/g, "-");
    if (name) socket.emit("createChannel", name);
  });

  socket.on("channels", (names) => {
    channelList = names;
    renderChannels();
  });

  socket.on("switchedChannel", (name) => {
    currentChannel = name;
    renderChannels();
    typingUsers.clear();
    updateTypingIndicator();
  });

  async function sendMessageNew(e) {
    e.preventDefault();
    hideSuggestion();
    // stops typing when a message is sent
    socket.emit("stopTyping");
    const textInput = document.querySelector("#message-input");
    const fileInput = document.querySelector("#file-input");

    const file = fileInput.files[0];

    if (!textInput.value && !file) return;

    const replyTo = replyingTo ? replyingTo.id : null;

    if (file) {
      if (file.size > MAX_SIZE) {
        showToast("file too big (max is 50mb)", 'error');
        fileInput.value = "";
        document.querySelector("#attach-btn").style.borderColor = "";
        document.querySelector("#attach-btn").style.color = "";
        return;
      }
      const isImage = file.type.startsWith("image/");
      showStatus("uploading...");
      const url = await uploadFile(file);
      showStatus("uploaded!", "pink");
      setTimeout(hideStatus, 3000);
      socket.emit("message", {
        username,
        text: isImage
          ? textInput.value || null
          : `${textInput.value ? textInput.value + " " : ""}${file.name}: ${url}`,
        image: isImage ? url : null,
        replyTo,
      });
      textInput.value = "";
      fileInput.value = "";
      updateCharCounter()
      document.querySelector("#attach-btn").style.borderColor = "";
      document.querySelector("#attach-btn").style.color = "";
    } else {
      socket.emit("message", {
        username,
        text: textInput.value,
        image: null,
        replyTo,
      });
      textInput.value = "";
      updateCharCounter()
    }
    if (replyingTo) cancelReply();
    textInput.focus();
  }

  // force enter to send message
  document.querySelector("#file-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      document.querySelector("#message-form").requestSubmit();
    }
  });
  let atBottom = true;
  let scrolling = false;
  const msgList = document.querySelector("ul");
  msgList.addEventListener(
    "scroll",
    () => {
      if (scrolling) return;
      atBottom =
        msgList.scrollTop + msgList.clientHeight >= msgList.scrollHeight - 150;
    },
    { passive: true },
  );

  function scrollToBottom() {
    atBottom = true;
    scrolling = true;
    msgList.scrollTop = msgList.scrollHeight;
    requestAnimationFrame(() => {
      scrolling = false;
    });
  }

  function appendMessage(li) {
    const ul = document.querySelector("ul");
    const shouldScroll = atBottom;
    ul.appendChild(li);
    if (shouldScroll) scrollToBottom();

    // re-scroll after images load since they change page height
    const img = li.querySelector("img");
    if (img && !img.complete) {
      img.addEventListener(
        "load",
        () => {
          if (atBottom) scrollToBottom();
        },
        { once: true },
      );
    }

    // nuke the oldest message because why not
    while (ul.children.length > maxmessages) {
      ul.removeChild(ul.firstChild);
    }
  }

  socket.on("connect", () => {
    localStorage.removeItem("banned");
    hideStatus();
  });

  socket.on("savedUsername", (name) => {
    const nameToUse = name || username;
    username = nameToUse;
    socket.emit("setUsername", nameToUse);
    // guests: avatar upload is hidden inside the edit profile view
    updateProfileBtn();
  });

  socket.on("disconnect", () => {
    showStatus("disconnected, reconnecting...", "var(--muted)");
  });

  document
    .querySelector("#message-form")
    .addEventListener("submit", sendMessageNew);

  // more activity stuff
  document.addEventListener("click", activitya);
  document.addEventListener("keydown", activitya);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) activitya();
  });
  socket.on("message", (data) => {
    // ignore stray messages from another channel (race during a switch)
    if (data.channel && data.channel !== currentChannel) return;
    if (isSystemMessage(data)) return;
    renderedHistory.push(data);
    renderMessage(data);
    if (
      !notifymuted &&
      myStatus !== "dnd" &&
      data.mentions &&
      data.mentions.some((m) => m.toLowerCase() === username.toLowerCase())
    )
      beep();
    if (document.hidden) {
      unread++;
      document.title = `(${unread}) chat™`;
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      unread = 0;
      document.title = "chat™";
    }
  });

  let lastMsgMeta = null; // { username, time } - for message grouping

  // ─── replies ─────────────────────────────────────────────────────────────

  let replyingTo = null;

  function findMessageById(id) {
    return renderedHistory.find((m) => m.id === id);
  }

  function startReply(id) {
    const msg = findMessageById(id);
    if (!msg || msg.system) return;
    replyingTo = msg;
    document.querySelector("#reply-bar-username").textContent = msg.username;
    document.querySelector("#reply-bar").style.display = "flex";
    document.documentElement.classList.add("replying");
    document.querySelector("#message-input").focus();
  }

  function cancelReply() {
    replyingTo = null;
    document.querySelector("#reply-bar").style.display = "none";
    document.documentElement.classList.remove("replying");
  }

  document
    .querySelector("#reply-bar-cancel")
    .addEventListener("click", cancelReply);

  function jumpToMessage(id) {
    const li = document.querySelector(`li[data-id="${id}"]`);
    if (!li) return;
    li.scrollIntoView({ behavior: "smooth", block: "center" });
    li.classList.add("msg-flash");
    setTimeout(() => li.classList.remove("msg-flash"), 1200);
  }

  function buildReplyRef(data) {
    const rt = data.replyTo;
    if (!rt) return null;
    const ref = document.createElement("div");
    ref.className = "reply-ref";
    const icon = document.createElement("i");
    icon.className = "ti ti-arrow-back-up";
    ref.appendChild(icon);

    if (rt.deleted) {
      ref.classList.add("reply-ref-deleted");
      const text = document.createElement("span");
      text.textContent = "original message was deleted";
      ref.appendChild(text);
    } else {
      if (rt.avatar) {
        const av = document.createElement("img");
        av.src = rt.avatar;
        av.className = "reply-ref-avatar";
        ref.appendChild(av);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "reply-ref-avatar reply-ref-avatar-placeholder";
        placeholder.textContent = (rt.username || "?")[0];
        placeholder.style.backgroundColor = `hsl(${nameHash(rt.username) % 360}, 55%, 38%)`;
        ref.appendChild(placeholder);
      }
      const name = document.createElement("span");
      name.className = "reply-ref-username";
      if (rt.redVerified) applyRedVerifiedColor(name);
      else applyFlagColor(name, rt.color || getNameColor(rt.username));
      name.textContent = rt.username;
      ref.appendChild(name);

      if (rt.isToken)
        ref.appendChild(
          makeBadge(
            "https://cdn.chattm.app/verified_owner.png",
            12,
            "this user is verified to be the owner of chat™",
          ),
        );
      else if (rt.redVerified) ref.appendChild(makeRedCheckBadge(12));
      else if (rt.verified)
        ref.appendChild(
          makeBadge(
            "https://cdn.chattm.app/verified.png",
            12,
            "this user has been verified",
          ),
        );

      const snippet = document.createElement("span");
      snippet.className = "reply-ref-snippet";
      const text = rt.text ? rt.text.replace(/\s+/g, " ").trim() : "";
      snippet.textContent = text
        ? text.length > 60
          ? text.slice(0, 60) + "…"
          : text
        : rt.image
          ? "[image]"
          : "";
      ref.appendChild(snippet);
    }

    ref.addEventListener("click", (e) => {
      e.stopPropagation();
      jumpToMessage(rt.id);
    });
    return ref;
  }

  function makeReplyButton(data) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "msg-hover-reply";
    btn.title = "reply";
    btn.innerHTML = '<i class="ti ti-arrow-back-up"></i>';
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      startReply(data.id);
    });
    return btn;
  }

  function makeRedCheckBadge(
    size,
    tooltip = "this checkmark is only held by my wife and z. you cannot get it.",
  ) {
    return makeBadge("https://cdn.chattm.app/verified_red.png", size, tooltip);
  }

  function makeBadge(src, size, tooltip) {
    const wrap = document.createElement("span");
    wrap.className = "badge-wrap";
    wrap.dataset.tooltip = tooltip;
    const img = document.createElement("img");
    img.src = src;
    img.style.cssText = `width:${size}px;height:${size}px;vertical-align:middle;margin-left:4px;position:relative;top:-2px`;
    wrap.appendChild(img);
    return wrap;
  }

  function buildMsgContent(data, color) {
    const content = document.createElement("div");
    content.className = "msg-content";
    if (data.text)
      content.appendChild(
        functioninglinks(data.text, flags[color] ? null : color),
      );
    if (data.image) {
      const img = document.createElement("img");
      img.src = data.image;
      img.addEventListener("click", () => lightbox(data.image));
      content.appendChild(img);
    }
    return content;
  }

  function renderMessage(data) {
    const ausername = data.username;
    const color = data.color || getNameColor(ausername);

    const isContinuation =
      lastMsgMeta &&
      lastMsgMeta.username === ausername &&
      data.time - lastMsgMeta.time < 5 * 60 * 1000 &&
      !data.replyTo;

    lastMsgMeta = { username: ausername, time: data.time };

    if (isContinuation) {
      const li = document.createElement("li");
      li.className = "msg-cont";
      li.dataset.id = data.id;
      li.appendChild(buildMsgContent(data, color));
      if (!data.system) {
        const actions = document.createElement("div");
        actions.className = "msg-hover-actions";
        actions.appendChild(makeReplyButton(data));
        li.appendChild(actions);
      }
      li.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openMessageContextMenu(li, data.id, ausername === username || isOwner);
      });
      appendMessage(li);
      return;
    }

    const li = document.createElement("li");
    li.className = "msg";
    li.dataset.id = data.id;

    // left: avatar or initial placeholder
    const avatarCol = document.createElement("div");
    avatarCol.className = "msg-avatar";
    if (data.avatar) {
      const av = document.createElement("img");
      av.src = data.avatar;
      av.className = "avatar";
      avatarCol.appendChild(av);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "avatar-placeholder";
      placeholder.textContent = (ausername || "?")[0];
      placeholder.style.backgroundColor = `hsl(${nameHash(ausername) % 360}, 55%, 38%)`;
      avatarCol.appendChild(placeholder);
    }
    avatarCol.style.cursor = "pointer";
    avatarCol.addEventListener("click", (e) => {
      e.stopPropagation();
      openProfile(ausername);
    });
    li.appendChild(avatarCol);

    // right: body
    const body = document.createElement("div");
    body.className = "msg-body";

    const replyRef = buildReplyRef(data);
    if (replyRef) body.appendChild(replyRef);

    // header row: username + badges + time
    const header = document.createElement("div");
    header.className = "msg-header";

    const namespan = document.createElement("span");
    namespan.className = "msg-username";
    const nametext = document.createElement("span");
    if (data.redVerified) applyRedVerifiedColor(nametext);
    else applyFlagColor(nametext, color);
    nametext.textContent = ausername;
    namespan.appendChild(nametext);
    if (data.isToken)
      namespan.appendChild(
        makeBadge(
          "https://cdn.chattm.app/verified_owner.png",
          14,
          "this user is verified to be the owner of chat™",
        ),
      );
    else if (data.redVerified) namespan.appendChild(makeRedCheckBadge(14));
    else if (data.verified)
      namespan.appendChild(
        makeBadge(
          "https://cdn.chattm.app/verified.png",
          14,
          "this user has been verified",
        ),
      );
    namespan.style.cursor = "pointer";
    namespan.addEventListener("click", (e) => {
      e.stopPropagation();
      openProfile(ausername);
    });
    header.appendChild(namespan);

    const timespan = document.createElement("span");
    timespan.className = "msg-time";
    timespan.textContent = new Date(Number(data.time)).toLocaleString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    header.appendChild(timespan);
    if (!data.system) header.appendChild(makeReplyButton(data));
    body.appendChild(header);

    body.appendChild(buildMsgContent(data, color));
    li.appendChild(body);

    li.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openMessageContextMenu(li, data.id, ausername === username || isOwner);
    });

    appendMessage(li);
  }

  function openMessageContextMenu(li, messageId, canDelete) {
    const menu = document.querySelector("#message-context-menu");
    const rect = li.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.classList.add("open");

    const replyBtn = document.querySelector("#ctx-reply-btn");
    replyBtn.onclick = () => {
      startReply(messageId);
      menu.classList.remove("open");
    };

    const deleteBtn = document.querySelector("#ctx-delete-btn");
    deleteBtn.style.display = canDelete ? "" : "none";
    deleteBtn.onclick = () => {
      socket.emit("deleteMessage", messageId);
      menu.classList.remove("open");
    };
  }

  document.addEventListener("click", (e) => {
    const ctxMenu = document.querySelector("#message-context-menu");
    if (!ctxMenu.contains(e.target)) ctxMenu.classList.remove("open");
  });

  document.addEventListener("contextmenu", (e) => {
    if (!e.target.closest("li"))
      document.querySelector("#message-context-menu").classList.remove("open");
  });

  socket.on("messageDeleted", (messageId) => {
    const li = document.querySelector(`li[data-id="${messageId}"]`);
    if (li) li.remove();
  });
  // user renamed status
  socket.on("userRenamed", ({ from, to }, guest) => {
    if (guest) {
      return;
    } else {
      showStatus(`changed username to ${to}`, "hotpink");
      setTimeout(hideStatus, 3000);
    }
  });

  // cdn/image stuff
  async function uploadFile(file) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("username", username);
    const res = await fetch(
      `${window.location.origin}/upload`,
      {
        method: "POST",
        body: formData,
        credentials: 'same-origin'
      },
    );
    const { url } = await res.json();
    return url;
  }

  // links show up as links in chat
  function functioninglinks(text, color) {
    const tokenRegex = /(https?:\/\/[^\s]+)|(@[a-zA-Z0-9_]+)|(:[a-z0-9_-]+:)/g;
    const parts = text.split(tokenRegex).filter((p) => p !== undefined);
    const fragment = document.createDocumentFragment();

    for (const part of parts) {
      if (!part) continue;
      if (/^https?:\/\//.test(part)) {
        const a = document.createElement("a");
        a.href = part;
        a.textContent = part;
        a.target = "_blank";
        a.rel = "noopener noreferer";
        a.style.color = color;
        fragment.appendChild(a);
      } else if (/^@[a-zA-Z0-9_]+$/.test(part)) {
        const span = document.createElement("span");
        span.className = "mention";
        span.textContent = part;
        fragment.appendChild(span);
      } else if (/^:[a-z0-9_-]+:$/.test(part) && customEmoji[part]) {
        const img = document.createElement("img");
        img.src = customEmoji[part];
        img.className = "custom-emoji";
        img.title = part;
        img.alt = part;
        fragment.appendChild(img);
      } else {
        fragment.appendChild(document.createTextNode(part));
      }
    }
    return fragment;
  }

  // upload error stuff
  function showError(msg) {
    const e = document.querySelector("#upload-error");
    e.textContent = msg;
    e.style.display = "block";
    setTimeout(() => {
      e.style.display = "none";
      e.textContent = "";
    }, 3000);
  }

  // status stuff

  // beep
  function getaudioctx() {
    if (!audioctx) {
      audioctx = new AudioContext();
    }
    if (audioctx.state === "suspended") {
      audioctx.resume();
    }
    return audioctx;
  }
  function beep() {
    const ctx = getaudioctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 440;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);
  }

  // sign out button thingys
  document.querySelector("#signout").addEventListener("click", () => {
    localStorage.removeItem("session");
    window.location.href = `/signout`;
  });

  // stats panel
  const statsPanel = document.querySelector("#stats-panel");
  const statsBackdrop = document.querySelector("#stats-backdrop");

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 ** 2) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1024 ** 3) return (bytes / 1024 ** 2).toFixed(1) + " MB";
    return (bytes / 1024 ** 3).toFixed(2) + " GB";
  }

  function openStats() {
    statsPanel.style.display = "block";
    statsBackdrop.style.display = "block";
    document.querySelector("#stats-content").innerHTML =
      '<span class="stats-loading">loading...</span>';
    fetch("/stats")
      .then((r) => r.json())
      .then((data) => {
        const rows = [
          ["accounts", data.users.toLocaleString()],
          ["total messages", data.messages.toLocaleString()],
          ["images uploaded", data.uploads.toLocaleString()],
          ["custom emojis", data.emoji.toLocaleString()],
          ["storage used", formatBytes(data.totalSize)],
        ];
        document.querySelector("#stats-content").innerHTML = rows
          .map(
            ([label, value]) =>
              `<div class="stat-row"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`,
          )
          .join("");
      })
      .catch(() => {
        document.querySelector("#stats-content").innerHTML =
          '<span class="stats-loading">failed to load</span>';
      });
  }

  document.querySelector("#stats-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    moreMenu.classList.remove("open");
    userlist.style.top = "";
    openStats();
  });

  document.querySelector("#stats-close").addEventListener("click", () => {
    statsPanel.style.display = "none";
    statsBackdrop.style.display = "none";
  });

  statsBackdrop.addEventListener("click", () => {
    statsPanel.style.display = "none";
    statsBackdrop.style.display = "none";
  });

  // banned
  socket.on("banned", (reason) => {
    // useless localStorage.setItem('banned', reason || 'no reason given')
    location.reload();
  });

  socket.on("kicked", (reason) => {
    localStorage.removeItem("session");
    // /kicked clears the session cookie server-side and shows the reason page
    window.location.href =
      "/kicked?reason=" + encodeURIComponent(reason || "no reason given");
  });

  // an iq too high?
  // join/leave messages/system messages

  // the ban / maintenance / login screens are served server-side at GET /, so
  // for these connect errors we just reload and let the server route us
  socket.on("connect_error", (err) => {
    if (
      err.message === "maintenance" ||
      err.message === "banned" ||
      err.message === "not authenticated" ||
      err.message === "session expired"
    ) {
      if (
        err.message === "not authenticated" ||
        err.message === "session expired"
      )
        localStorage.removeItem("session");
      location.reload();
      return;
    }
    if (err.message === "rate limited") return; // socket.io will retry automatically
    // for transient errors, let socket.io reconnect automatically
  });

  socket.on("maintenance", (enabled) => {
    // server flips maintenance on and disconnects us; reload → maintenance page
    if (enabled) location.reload();
  });

  // user list client side stuff
  let onlineUsernames = [];

  function makeUserlistEntry(u) {
    const div = document.createElement("div");
    div.className = "ul-entry" + (u.online ? "" : " ul-offline");

    // avatar with status dot overlay
    const avWrap = document.createElement("div");
    avWrap.className = "ul-avatar-wrap";
    if (u.avatar) {
      const img = document.createElement("img");
      img.src = u.avatar;
      img.className = "ul-avatar";
      avWrap.appendChild(img);
    } else {
      const pl = document.createElement("div");
      pl.className = "ul-avatar ul-avatar-placeholder";
      pl.textContent = (u.username || "?")[0];
      pl.style.backgroundColor = `hsl(${nameHash(u.username) % 360}, 55%, 38%)`;
      avWrap.appendChild(pl);
    }
    const dot = document.createElement("span");
    dot.className = `ul-status-dot ${u.online ? u.status || "online" : "offline"}`;
    avWrap.appendChild(dot);
    div.appendChild(avWrap);

    // name + badges
    const info = document.createElement("div");
    info.className = "ul-info";
    const nameEl = document.createElement("span");
    nameEl.className = "ul-name";
    if (u.redVerified) applyRedVerifiedColor(nameEl);
    else applyFlagColor(nameEl, u.color || getNameColor(u.username));
    nameEl.textContent = u.username;
    info.appendChild(nameEl);
    if (u.isOwner)
      info.appendChild(
        makeBadge(
          "https://cdn.chattm.app/verified_owner.png",
          11,
          "this user is verified to be the owner of chat™",
        ),
      );
    else if (u.redVerified) info.appendChild(makeRedCheckBadge(11));
    else if (u.verified)
      info.appendChild(
        makeBadge(
          "https://cdn.chattm.app/verified.png",
          11,
          "this user has been verified",
        ),
      );
    div.appendChild(info);

    div.addEventListener("click", (e) => {
      e.stopPropagation();
      openProfile(u.username);
    });
    return div;
  }

  let cachedAdminUsersWithEmails = [];

  socket.on("adminUserlist", (users) => {
    cachedAdminUsersWithEmails = users;
  });

  socket.on("userlist", (users) => {
    onlineUsernames = users
      .filter((u) => u.online)
      .map((u) => u.username)
      .filter(Boolean);
    const ul = document.querySelector("#userlist");
    ul.innerHTML = "";

    const online = users.filter((u) => u.online);
    const offline = users.filter((u) => !u.online);

    if (online.length) {
      const header = document.createElement("div");
      header.className = "ul-section";
      header.textContent = `online - ${online.length}`;
      ul.appendChild(header);
      online.forEach((u) => ul.appendChild(makeUserlistEntry(u)));
    }

    if (offline.length) {
      const header = document.createElement("div");
      header.className = "ul-section";
      header.textContent = `offline - ${offline.length}`;
      ul.appendChild(header);
      offline.forEach((u) => ul.appendChild(makeUserlistEntry(u)));
    }
  });

  // file input stuff
  document.querySelector("#attach-btn").addEventListener("click", () => {
    document.querySelector("#file-input").click();
  });

  document.querySelector("#file-input").addEventListener("change", () => {
    const file = document.querySelector("#file-input").files[0];
    const btn = document.querySelector("#attach-btn");
    btn.style.borderColor = file ? "var(--pink)" : "";
    btn.style.color = file ? "var(--pink)" : "";
  });

  document.querySelector("#message-input").addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) continue;
        const dt = new DataTransfer();
        dt.items.add(file);
        const fileInput = document.querySelector("#file-input");
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event("change"));
        e.preventDefault();
        break;
      }
    }
  });

  // clear chat command
  socket.on("clear", () => {
    document.querySelector("ul").innerHTML = "";
  });

  // command autocomplete
  const commands = [
    "/whois [username]",
    "/noguests",
    "/setnick [oldname] [newname]",
    "/allowguests",
    "/kick [username] [reason]",
    "/setcolor [username] [color]",
    "/mute [username] [time] [reason]",
    "/unmute [username]",
    "/color [color|pride|trans|bi|lesbian|nb|gay]",
    "/colour [colour|pride|trans|bi|lesbian|nb|gay]",
    "/nick [name]",
    "/ban [username] [reason]",
    "/unban [email]",
    "/unbanip [ip]",
    "/addemoji [:shortcode:] [url]",
    "/removeemoji [:shortcode:]",
    "/reloademojis",
    "/hide [username]",
    "/unhide [username]",
  ];

  // stores what to actually insert on Tab (may differ from displayed suggestion text)
  let suggestionInsert = null;

  function showSuggestion(displayText, insertValue, prefixImg = null) {
    const suggestion = document.querySelector("#command-suggestion");
    suggestion.innerHTML = "";
    if (prefixImg) {
      const img = document.createElement("img");
      img.src = prefixImg;
      img.className = "custom-emoji";
      img.style.marginRight = "5px";
      suggestion.appendChild(img);
    }
    suggestion.appendChild(document.createTextNode(displayText));
    suggestion.style.display = "block";
    suggestionInsert = insertValue;
  }

  function hideSuggestion() {
    const suggestion = document.querySelector("#command-suggestion");
    suggestion.style.display = "none";
    suggestion.innerHTML = "";
    suggestionInsert = null;
  }

  document.querySelector("#message-input").addEventListener("input", (e) => {
    const value = e.target.value;
    const cursor = e.target.selectionStart;

    const usernameCmdMatch = value.match(
      /^\/(kick|mute|unmute|whois|resetstrikes|setcolor|ban)\s+([a-zA-Z0-9-]*)$/,
    );
    if (usernameCmdMatch) {
      const [, cmd, partial] = usernameCmdMatch;
      const lower = partial.toLowerCase();
      const userMatch = onlineUsernames.find(
        (name) =>
          name.toLowerCase().startsWith(lower) && name.toLowerCase() !== lower,
      );
      if (userMatch) {
        const full = `/${cmd} ${userMatch} `;
        showSuggestion(full, full);
        return;
      }
    }

    const before = value.slice(0, cursor);
    const mentionMatch = before.match(/@([a-zA-Z0-9_]*)$/);
    if (mentionMatch) {
      const fragment = mentionMatch[1].toLowerCase();
      const userMatch = onlineUsernames.find(
        (name) =>
          name.toLowerCase().startsWith(fragment) &&
          name.toLowerCase() !== fragment,
      );
      if (userMatch) {
        const full =
          value.slice(0, cursor - mentionMatch[1].length) +
          userMatch +
          value.slice(cursor);
        showSuggestion(full, full);
        return;
      }
    }

    // emoji shortcode autocomplete: match :partial before cursor
    const emojiMatch = before.match(/:([a-z0-9_-]*)$/);
    if (emojiMatch && !value.startsWith("/")) {
      const partial = emojiMatch[1].toLowerCase();
      const match = Object.keys(customEmoji).find(
        (sc) => sc.slice(1).startsWith(partial) && sc.slice(1) !== partial,
      );
      if (match) {
        const afterCursor = value.slice(cursor);
        const completed =
          value.slice(0, cursor - emojiMatch[1].length) +
          match.slice(1) +
          " " +
          afterCursor;
        showSuggestion(match + " ", completed, customEmoji[match]);
        return;
      }
    }

    if (value.startsWith("/")) {
      const match = commands.find((c) => c.startsWith(value));
      if (match && match !== value) {
        showSuggestion(match, match);
      } else {
        hideSuggestion();
      }
    } else {
      hideSuggestion();
    }
  });

  document.querySelector("#message-input").addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      const suggestion = document.querySelector("#command-suggestion");
      if (suggestion.style.display !== "none" && suggestionInsert !== null) {
        e.preventDefault();
        document.querySelector("#message-input").value = suggestionInsert;
        hideSuggestion();
      }
    }
    if (e.key === "Escape" && replyingTo) {
      cancelReply();
    }
  });

  socket.on("commandError", (msg, type) => {
    showToast(msg, type);
  });

  socket.on('showE', (msg) => {
    const e = document.querySelector("#upload-error");
    e.textContent = msg;
    e.style.display = "block";
  })

  let chatMutedb = false;

  // check owner status and mute chat status on connect
  socket.on(
    "init",
    ({
      isOwner: owner,
      role: r,
      chatMuted: muted,
      color,
      uMuted,
      currentChannel: ch,
    }) => {
      isOwner = owner;
      role = r ?? 'user';
      if (ch) currentChannel = ch;
      addChannelBtn.style.display = isOwner ? "" : "none";
      renderChannels();
      updateProfileBtn();
      if (muted && !isOwner) {
        showStatus("chat has been muted", "pink");
        document.querySelector("#message-input").disabled = true;
        document.querySelector('#message-form button[type="submit"]').disabled =
          true;
        document.querySelector("#attach-btn").disabled = true;
      }
      if (uMuted) {
        document.querySelector("#message-input").disabled = true;
        document.querySelector('#message-form button[type="submit"]').disabled =
          true;
        showStatus(
          `you are muted${uMuted.until ? " until " + new Date(uMuted.until).toLocaleString() : ""} - ${uMuted.reason}`,
          "pink",
        );
      }
      document.querySelector("#owner-divider").style.display = "block";
      if (isOwner) {
        document.querySelector("#admin-btn").style.display = "";
      }

      if (color) {
        myColor = color;
        updateProfileBtn();
      }
    },
  );


  // modal
  function showModal({ message, withInput = false, defaultValue = "" }) {
    return new Promise((resolve) => {
      const overlay = document.querySelector("#modal-overlay");
      const msgEl = document.querySelector("#modal-message");
      const inputEl = document.querySelector("#modal-input");
      const confirmBtn = document.querySelector("#modal-confirm");
      const cancelBtn = document.querySelector("#modal-cancel");

      msgEl.textContent = message;
      inputEl.style.display = withInput ? "block" : "none";
      inputEl.value = defaultValue;
      overlay.style.display = "flex";
      if (withInput) inputEl.focus();

      function cleanUp(result) {
        overlay.style.display = "none";
        confirmBtn.removeEventListener("click", onConfirm);
        cancelBtn.removeEventListener("click", onCancel);
        if (withInput) inputEl.removeEventListener("keydown", onKey);
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
      confirmBtn.addEventListener("click", onConfirm);
      cancelBtn.addEventListener("click", onCancel);
      if (withInput) inputEl.addEventListener("keydown", onKey);
    });
  }
  document.querySelector("#admin-btn").addEventListener("click", () => {
    window.location.href = "/admin";
  });
}
