// persistent userid generation stuff
let userId = localStorage.getItem("userId")
if (!userId || userId == null) {
    userId = crypto.randomUUID()
    localStorage.setItem("userId", userId)
}

let unread = 0
let activity = false
let username = localStorage.getItem('username') || userId.slice(0,5)
let audioctx = null
let isOwner = false
// fetch port
const config = await fetch('/config').then(r => r.json()).catch(() => ({ port: 3000 }))

if (localStorage.getItem('banned')) {
    document.body.className = 'login-page'
    document.body.innerHTML = `
        <h1>chat™</h1>
        <p style="color: var(--pink)">you have been banned</p>
        <p>reason: ${localStorage.getItem('banned')}</p>
        <p style="color: var(--muted)">to appeal, email <a href="mailto:emma@chattm.app">emma@chattm.app</a></p>
    `
    devInstanceBanner()
    throw new Error('banned')
}

// colors
function nameHash(name) {
    let hash = 0
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
    return hash
}

function getNameColor(name) {
    if (!name) return 'var(--muted)'
    if (name.toLowerCase() === 'emma') return 'hotpink'
    return `hsl(${nameHash(name) % 360}, 70%, var(--name-lightness))`
}

function isSystemMessage(data) {
    return data.username === 'SYSTEM' && data.system
}

// more button
const moreBtn = document.querySelector('#more-btn')
const moreMenu = document.querySelector('#more-menu')

moreBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    const isOpen = moreMenu.classList.toggle('open')
    if (window.innerWidth > 600) {
        if (isOpen) {
            const menuRect = moreMenu.getBoundingClientRect()
            userlist.style.top = `${menuRect.bottom + 12}px`
        } else {
            userlist.style.top = ''
        }
    }
})

document.addEventListener('click', (e) => {
    const modalOverlay = document.querySelector('#modal-overlay')
    if (modalOverlay.contains(e.target)) return
    if (!moreMenu.contains(e.target) && e.target !== moreBtn) {
        moreMenu.classList.remove('open')
        userlist.style.top = ''
    }
})
function devInstanceBanner() {
    const devHosts = [
        'beta.chattm.app',
        'localhost',
        '127.0.0.1'
    ]

    if (!devHosts.includes(window.location.hostname)) return
    if (document.querySelector('#dev-banner')) return

    if (window.location.hostname === 'beta.chattm.app') {
        const banner = document.createElement('div')
        banner.id = 'dev-banner'
        banner.textContent = 'this is a beta instance of chat™ - things may not be very stable'
        document.body.appendChild(banner)
    } else {
        const banner = document.createElement('div')
        banner.id = 'dev-banner'
        banner.textContent = 'this is a dev instance of chat™ - things may not be stable and may break often'
        document.body.appendChild(banner)
    }
}

function loadVersionStatus(forceRefresh = false) {
    fetch(`/version${forceRefresh ? '?refresh=1' : ''}`).then(r => r.json()).then(v => {
        if (v.upToDate === null) return
        const el = document.querySelector('#version-status')
        el.classList.remove('outdated')
        if (v.upToDate) {
            el.textContent = `up to date (${v.currentCommit})`
        } else if (v.ahead) {
            el.textContent = `${v.ahead} commit${v.ahead === 1 ? '' : 's'} ahead (${v.currentCommit})`
        } else {
            el.textContent = `${v.behind} commit${v.behind === 1 ? '' : 's'} behind (${v.currentCommit})`
            el.classList.add('outdated')
        }
    }).catch(() => {})
}
loadVersionStatus()

// lightbox
function lightbox(src) {
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:1000;display:flex;align-items:center;justify-content:center;cursor:zoom-out'
    const img = document.createElement('img')
    img.src = src
    img.style.cssText = 'max-width:90vw;max-height:90vh;border-radius:6px;object-fit:contain'
    overlay.appendChild(img)
    overlay.addEventListener('click', () => overlay.remove())
    document.body.appendChild(overlay)
}

// clientside maintenance stuff
function showMaintenance(reason) {
    document.body.className = 'login-page'
    document.body.innerHTML = `
        <h1>chat™</h1>
        <p style="color: #F5A9B8;">chat™ is under maintenance</p>
        ${reason ? `<p>${reason}</p>` : ''}
    `
    devInstanceBanner()
    // setTimeout(() => location.reload(), 15000)
    throw new Error('maintenance')
}

devInstanceBanner()


let customEmoji = {}

const flags = {
    'flag:pride':       'linear-gradient(90deg,#ff0018,#ffa52c,#ffff41,#008018,#0000f9,#86007d)',
    'flag:gay':         'linear-gradient(90deg,#078D70,#26CEAA,#98E8C1,#FFFFFF,#7BADE2,#5049CC)',
    'flag:trans':       'linear-gradient(90deg,#55cdfc,#f7a8b8,#fff,#f7a8b8,#55cdfc)',
    'flag:bi':          'linear-gradient(90deg,#d60270,#d60270,#9b4f96,#0038a8,#0038a8)',
    'flag:lesbian':     'linear-gradient(90deg,#d62900,#ff9b55,#fff,#d461a6,#a50062)',
    'flag:nb':          'linear-gradient(90deg,#fcf434,#fff,#9c59d1,#2c2c2c)'
}

function applyFlagColor(el, color) {
    const gradient = flags[color]
    if (gradient) {
        el.style.color = 'transparent'
        el.style.backgroundImage = gradient
        el.style.backgroundClip = 'text'
        el.style.webkitBackgroundClip = 'text'
    } else {
        el.style.color = color
        el.style.backgroundImage = ''
        el.style.backgroundClip = ''
        el.style.webkitBackgroundClip = ''
    }
}

// clientside maintrnance stuf paet 2
const maintenanceCheck = await fetch(
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? `http://localhost:${config.port}`
        : window.location.origin) + '/maintenance'
).then(r => r.json()).catch(() => ({ maintenance: false }))


// hca stuff part 9 (live server really hates me)
const session = (() => {
    const hash = new URLSearchParams(window.location.hash.slice(1))
    const fromHash = hash.get('session')
    if (fromHash) {
        sessionStorage.setItem('newlogin', '1')
        localStorage.setItem('session', fromHash)
        window.history.replaceState({}, '', '/')
        return fromHash
    }
    return localStorage.getItem('session')
})()

// fix auth denied crashing
const urlError = new URLSearchParams(window.location.search).get('error')
if (urlError === 'auth_denied') {
    window.history.replaceState({}, '', '/')
    sessionStorage.setItem('authDenied', '1')
}
if (urlError === 'rate_limited') {
    window.history.replaceState({}, '', '/')
    sessionStorage.setItem('rateLimited', '1')
}
if (!session) {
    const kickedReason = sessionStorage.getItem('kickedReason')
    if (maintenanceCheck.maintenance) showMaintenance(maintenanceCheck.reason)
    const guestsOff = maintenanceCheck.guestsDisabled
    document.body.className = 'login-page'
    document.body.innerHTML = `
        <h1>chat™</h1>
        <p>you need to sign in to chat</p>
        <a href="/login"><button><i class="ti ti-login-2"></i> login with Hack Club</button></a>
        ${guestsOff
            ? '<button disabled style="opacity:0.6;cursor:not-allowed"><i class="ti ti-user"></i> continue as guest</button>'
            : '<a href="/guest"><button><i class="ti ti-user"></i> continue as guest</button></a>'}
        ${kickedReason ? `<p style="color: var(--pink)">you've been kicked: ${kickedReason}</p>` : ''}
        ${sessionStorage.getItem('authDenied') ? '<p style="color: var(--pink)">login was cancelled or denied</p>' : ''}
        ${guestsOff ? '<p style="color: var(--muted)">guest logins are currently disabled</p>' : ''}
        ${sessionStorage.getItem('rateLimited') ? '<p style="color: var(--muted)">you\'re doing that too much, try again later</p>' : ''}
    `
    devInstanceBanner()
    sessionStorage.removeItem('kickedReason')
    sessionStorage.removeItem('authDenied')
    sessionStorage.removeItem('rateLimited')
    throw new Error('not authenticated')
}

if (session) {
    /* not needed anymore
    if (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
        showStatus('ui not optimised for mobile', 'pink')
    }
        */
    if (sessionStorage.getItem('newlogin')) {
        sessionStorage.removeItem('newlogin')
        showStatus("welcome to chat™, set your username above if you haven't", 'pink')
        setTimeout(hideStatus, 3000)
    }


const socket = io(
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000'
        : window.location.origin, // set this to the ip/url of the site/proxy you're using for the backend server thing
    {
        auth: { session: localStorage.getItem('session') },
        transports: ['websocket']
    }
)
const resetId = document.querySelector("#resetid")
const maxmessages = 100
let announce = false
const MAX_SIZE = 50 * 1024 * 1024 // 10mb limit to images

// profile button (replaces old username form)
let myBio = ''
let myStatus = ''
let myPronouns = ''
let myAvatar = null
let myVerified = false

function updateProfileBtn() {
    const btn = document.querySelector('#profile-btn')
    btn.innerHTML = ''
    if (myAvatar) {
        const img = document.createElement('img')
        img.src = myAvatar
        btn.appendChild(img)
    } else {
        const pl = document.createElement('span')
        pl.className = 'btn-avatar-placeholder'
        pl.textContent = (username || '?')[0]
        pl.style.backgroundColor = `hsl(${nameHash(username) % 360}, 55%, 38%)`
        btn.appendChild(pl)
    }
    btn.appendChild(document.createTextNode(username))
    if (isOwner) {
        const badge = document.createElement('img')
        badge.src = 'https://cdn.chattm.app/verified_owner.png'
        badge.style.cssText = 'width:13px;height:13px;vertical-align:middle;margin-left:3px'
        btn.appendChild(badge)
    } else if (myVerified) {
        const badge = document.createElement('img')
        badge.src = 'https://cdn.chattm.app/verified.png'
        badge.style.cssText = 'width:13px;height:13px;vertical-align:middle;margin-left:3px'
        btn.appendChild(badge)
    }
}

updateProfileBtn()
document.querySelector('#profile-btn').addEventListener('click', (e) => { e.stopPropagation(); openProfile(username) })

// move socket joined/left stuff after intialiing socket
/* unneeded
socket.on('userJoined', (name) => { 
    systemMessage(`${name} joined`)
})
socket.on('userLeft', (name) =>  {
    systemMessage(`${name} left`)
})
*/
// mute button
let notifymuted = localStorage.getItem('notifymuted') === 'true'
const mutebtn = document.querySelector('#mute-btn') 
mutebtn.classList.toggle('muted', notifymuted)


mutebtn.addEventListener('click', () => {
    notifymuted = !notifymuted
    localStorage.setItem('notifymuted', notifymuted)
    mutebtn.classList.toggle('muted', notifymuted)
})

const themebtn = document.querySelector('#theme-btn')
let lightMode = localStorage.getItem('lightMode') === 'true'

function applyTheme() {
    document.documentElement.classList.toggle('light', lightMode)
    themebtn.innerHTML = lightMode
        ? '<i class="ti ti-moon"></i> dark mode'
        : '<i class="ti ti-sun"></i> light mode'
}

applyTheme()
themebtn.addEventListener('click', () => {
    lightMode = !lightMode
    localStorage.setItem('lightMode', lightMode)
    applyTheme()
})

const compactbtn = document.querySelector('#compact-btn')
let compactMode = localStorage.getItem('compactMode') === 'true'
let renderedHistory = []  // for re-render on mode toggle

function applyCompact() {
    document.documentElement.classList.toggle('compact', compactMode)
    compactbtn.innerHTML = compactMode
        ? '<i class="ti ti-layout-list"></i> modern mode'
        : '<i class="ti ti-layout-list"></i> compact mode'
}

applyCompact()
compactbtn.addEventListener('click', () => {
    compactMode = !compactMode
    localStorage.setItem('compactMode', compactMode)
    applyCompact()
    // re-render so grouping applies (or is removed) immediately
    const ul = document.querySelector('ul')
    ul.innerHTML = ''
    lastMsgMeta = null
    renderedHistory.forEach(data => renderMessage(data))
    window.scrollTo({ top: document.body.scrollHeight })
})

const tooltipsbtn = document.querySelector('#tooltips-btn')
let tooltipsHidden = localStorage.getItem('tooltipsHidden') === 'true'

function applyTooltips() {
    document.documentElement.classList.toggle('no-tooltips', tooltipsHidden)
    tooltipsbtn.innerHTML = tooltipsHidden
        ? '<i class="ti ti-info-circle"></i> show tooltips'
        : '<i class="ti ti-info-circle"></i> hide tooltips'
}

applyTooltips()
tooltipsbtn.addEventListener('click', () => {
    tooltipsHidden = !tooltipsHidden
    localStorage.setItem('tooltipsHidden', tooltipsHidden)
    applyTooltips()
})

// avatar
const avatarInput = document.querySelector('#avatar-input')

socket.on('savedAvatar', (url) => {
    myAvatar = url
    updateProfileBtn()
    // refresh avatar wrap in panel if open and showing own profile
    if (profilePanel && profilePanel.style.display !== 'none' &&
        profilePanel.dataset.profileUsername === username) {
        renderProfileAvatarWrap(url)
    }
})

async function uploadAvatar(file) {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`${window.location.origin}/upload?session=${encodeURIComponent(session || '')}&avatar=1`, {
        method: 'POST',
        body: formData
    })
    const { url, error } = await res.json()
    if (error) throw new Error(error)
    return url
}

let pendingAvatar = undefined  // undefined=no change, null=remove, string=new url
let suppressProfileClose = false

avatarInput.addEventListener('change', async () => {
    const file = avatarInput.files[0]
    if (!file) return
    avatarInput.value = ''
    try {
        const url = await uploadAvatar(file)
        pendingAvatar = url
        // preview in the panel without saving yet
        renderProfileAvatarWrap(url, true)
    } catch (e) {
        showError('avatar upload failed')
    }
})

// prevent panel close when file dialog opens
avatarInput.addEventListener('click', () => {
    suppressProfileClose = true
    setTimeout(() => { suppressProfileClose = false }, 500)
})

const STATUS_OPTIONS = [
    { value: 'online', label: 'Online',         color: 'online' },
    { value: 'idle',   label: 'Idle',           color: 'idle' },
    { value: 'dnd',    label: 'Do Not Disturb', color: 'dnd' },
]

function statusDot(value) {
    const dot = document.createElement('span')
    dot.className = `status-dot ${value || 'online'}`
    return dot
}

function statusLabel(value) {
    return STATUS_OPTIONS.find(o => o.value === value)?.label ?? 'Online'
}

// saved profile
socket.on('savedProfile', (data) => {
    if (!data) return
    myBio = data.bio ?? ''
    myStatus = data.status ?? 'online'
    myPronouns = data.pronouns ?? ''
    // refresh panel if showing own profile
    const panel = document.querySelector('#profile-panel')
    if (panel.style.display !== 'none' && panel.dataset.profileUsername === username) {
        renderStatusDisplay(myStatus, true)
        document.querySelector('#profile-bio-display').textContent = myBio
    }
})

// profile panel
const profilePanel = document.querySelector('#profile-panel')

function openProfile(targetUsername, editMode = false) {
    profilePanel.style.display = 'block'; document.querySelector('#profile-backdrop').style.display = 'block'
    profilePanel.dataset.profileUsername = targetUsername
    // clear previous content
    document.querySelector('#profile-avatar-wrap').innerHTML = ''
    document.querySelector('#profile-name-row').innerHTML = ''
    document.querySelector('#profile-pronouns-display').textContent = ''
    document.querySelector('#profile-status-display').textContent = '...'
    document.querySelector('#profile-bio-display').textContent = ''
    document.querySelector('#profile-edit').style.display = 'none'
    document.querySelector('#profile-edit-btn').style.display = 'none'
    socket.emit('getProfile', targetUsername)
    if (editMode) profilePanel.dataset.editOnLoad = '1'
}

function renderProfileAvatarWrap(avatarUrl, editable = false) {
    const avWrap = document.querySelector('#profile-avatar-wrap')
    avWrap.innerHTML = ''
    avWrap.onclick = null

    // inner: relative container so overlay sits on top of avatar
    const inner = document.createElement('div')
    inner.className = 'avatar-inner'
    inner.style.cssText = 'position:relative;display:inline-block;overflow:hidden;border-radius:10px'

    if (avatarUrl) {
        const img = document.createElement('img')
        img.src = avatarUrl
        img.className = 'profile-avatar'
        inner.appendChild(img)
    } else {
        const pl = document.createElement('div')
        pl.className = 'profile-avatar-placeholder'
        pl.textContent = (username || '?')[0]
        pl.style.backgroundColor = `hsl(${nameHash(username) % 360}, 55%, 38%)`
        inner.appendChild(pl)
    }

    if (editable) {
        const overlay = document.createElement('div')
        overlay.className = 'avatar-edit-overlay'
        overlay.innerHTML = '<i class="ti ti-camera"></i>'
        inner.appendChild(overlay)
        inner.style.cursor = 'pointer'
        inner.addEventListener('click', (e) => { e.stopPropagation(); avatarInput.click() })

        if (avatarUrl) {
            const removeBtn = document.createElement('button')
            removeBtn.type = 'button'
            removeBtn.className = 'avatar-remove-btn'
            removeBtn.textContent = 'remove'
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation()
                pendingAvatar = null
                renderProfileAvatarWrap(null, true)
            })
            avWrap.appendChild(inner)
            avWrap.appendChild(removeBtn)
            return
        }
    }

    avWrap.appendChild(inner)
}

function renderStatusDisplay(currentStatus, editable = false) {
    const sd = document.querySelector('#profile-status-display')
    sd.innerHTML = ''
    sd.appendChild(statusDot(currentStatus || 'online'))
    sd.appendChild(document.createTextNode(statusLabel(currentStatus || 'online')))

    if (!editable) { sd.style.cursor = ''; sd.onclick = null; return }

    const chevron = document.createElement('i')
    chevron.className = 'ti ti-chevron-down'
    chevron.style.cssText = 'font-size:11px;color:var(--muted);margin-left:3px'
    sd.appendChild(chevron)
    sd.style.cursor = 'pointer'
    sd.title = 'change status'
    sd.style.position = 'relative'

    let dropdown = document.createElement('div')
    dropdown.className = 'status-dropdown'
    dropdown.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);top:calc(100% + 4px);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:4px;z-index:600;min-width:170px;display:none;flex-direction:column;gap:2px;box-shadow:0 4px 16px rgba(0,0,0,0.4)'
    STATUS_OPTIONS.forEach(opt => {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.dataset.value = opt.value
        btn.className = 'status-option' + (opt.value === (currentStatus || 'online') ? ' active' : '')
        btn.appendChild(statusDot(opt.value))
        btn.appendChild(document.createTextNode(opt.label))
        btn.addEventListener('click', (e) => {
            e.stopPropagation()
            socket.emit('setStatus', opt.value)
            myStatus = opt.value
            dropdown.style.display = 'none'
        })
        dropdown.appendChild(btn)
    })
    sd.appendChild(dropdown)
    sd.onclick = (e) => {
        e.stopPropagation()
        dropdown.style.display = dropdown.style.display === 'none' ? 'flex' : 'none'
    }
}

socket.on('profileData', (data) => {
    if (!data) {
        document.querySelector('#profile-status-display').textContent = 'profile not found'
        return
    }
    const panel = profilePanel
    const color = data.color || getNameColor(data.username)

    // avatar (static initially; becomes editable when edit section opens)
    renderProfileAvatarWrap(data.avatar, false)

    // name row
    const nameRow = document.querySelector('#profile-name-row')
    nameRow.innerHTML = ''
    const nameEl = document.createElement('span')
    applyFlagColor(nameEl, color)
    nameEl.textContent = data.username
    nameRow.appendChild(nameEl)
    if (data.isOwner) nameRow.appendChild(makeBadge('https://cdn.chattm.app/verified_owner.png', 14, 'this user is verified to be the owner of chat™'))
    else if (data.verified) nameRow.appendChild(makeBadge('https://cdn.chattm.app/verified.png', 14, 'this user has been verified'))

    document.querySelector('#profile-pronouns-display').textContent = data.pronouns || ''

    // status display
    const isOwnProfile = data.username === username
    if (isOwnProfile) {
        myVerified = data.verified
        updateProfileBtn()
    }


    renderStatusDisplay(data.status || 'online', isOwnProfile)

    // bio
    document.querySelector('#profile-bio-display').textContent = data.bio || ''
    const editBtn = document.querySelector('#profile-edit-btn')
    const editActions = document.querySelector('#profile-edit-actions')
    editBtn.style.display = isOwnProfile ? '' : 'none'
    editBtn.disabled = data.isGuest
    editBtn.style.opacity = data.isGuest ? '0.4' : ''
    editBtn.title = data.isGuest ? "guests can't edit their profile" : ''

    function openEdit() {
        document.querySelector('#profile-username-input').value = data.username
        const pronounsInput = document.querySelector('#profile-pronouns-input')
        pronounsInput.value = data.pronouns || ''
        pronounsInput.disabled = data.isGuest
        const bioInput = document.querySelector('#profile-bio-input')
        bioInput.value = data.bio || ''
        bioInput.disabled = data.isGuest
        bioInput.placeholder = data.isGuest ? "guests can't set a bio" : 'bio (optional)'
        document.querySelector('#profile-edit').style.display = 'flex'
        editBtn.style.display = 'none'
        editActions.style.display = 'flex'
        if (!data.isGuest) renderProfileAvatarWrap(myAvatar, true)
    }

    function closeEdit() {
        document.querySelector('#profile-edit').style.display = 'none'
        editBtn.style.display = ''
        editActions.style.display = 'none'
        renderProfileAvatarWrap(myAvatar, false)
    }

    editBtn.onclick = openEdit

    if (panel.dataset.editOnLoad === '1') {
        delete panel.dataset.editOnLoad
        openEdit()
    }
})

document.querySelector('#profile-save-btn').addEventListener('click', () => {
    const newName = document.querySelector('#profile-username-input').value.trim()
    const newPronouns = document.querySelector('#profile-pronouns-input').value.trim()
    const newBio = document.querySelector('#profile-bio-input').value.trim()
    if (newName && newName !== username) socket.emit('setUsername', newName)
    if (newPronouns !== myPronouns) socket.emit('setPronouns', newPronouns)
    if (newBio !== myBio) socket.emit('setBio', newBio)
    if (pendingAvatar === null) socket.emit('deleteAvatar')
    else if (pendingAvatar !== undefined) socket.emit('setAvatar', pendingAvatar)
    pendingAvatar = undefined
    document.querySelector('#profile-edit').style.display = 'none'
    document.querySelector('#profile-edit-btn').style.display = ''
    document.querySelector('#profile-edit-actions').style.display = 'none'
})

document.querySelector('#profile-cancel-btn').addEventListener('click', () => {
    pendingAvatar = undefined
    renderProfileAvatarWrap(myAvatar, false)
    document.querySelector('#profile-edit').style.display = 'none'
    document.querySelector('#profile-edit-btn').style.display = ''
    document.querySelector('#profile-edit-actions').style.display = 'none'
})

function closeProfile() {
    profilePanel.style.display = 'none'
    document.querySelector('#profile-backdrop').style.display = 'none'
    document.querySelector('#profile-edit').style.display = 'none'
    document.querySelector('#profile-edit-actions').style.display = 'none'
    document.querySelector('#profile-edit-btn').style.display = 'none'
    document.querySelector('#profile-avatar-wrap').innerHTML = ''
    pendingAvatar = undefined
}

document.querySelector('#profile-close').addEventListener('click', closeProfile)

document.addEventListener('click', (e) => {
    // close any open status dropdown
    const dropdown = document.querySelector('.status-dropdown')
    if (dropdown && !dropdown.contains(e.target) && !document.querySelector('#profile-status-display')?.contains(e.target)) {
        dropdown.style.display = 'none'
    }
    if (suppressProfileClose) return
    if (profilePanel.style.display !== 'none' &&
        !profilePanel.contains(e.target) &&
        e.target !== document.querySelector('#profile-btn')) {
        closeProfile()
    }
})

// custom emoji picker
const emojiPicker = document.querySelector('#emoji-picker')
const emojiBtn = document.querySelector('#emoji-btn')

function renderEmojiPicker() {
    emojiPicker.innerHTML = ''
    const entries = Object.entries(customEmoji)
    if (!entries.length) {
        emojiPicker.style.display = 'none'
        return
    }
    for (const [shortcode, url] of entries) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.title = shortcode
        const img = document.createElement('img')
        img.src = url
        btn.appendChild(img)
        btn.addEventListener('click', () => {
            const input = document.querySelector('#message-input')
            const pos = input.selectionStart
            const val = input.value
            const insert = shortcode + ' '
            input.value = val.slice(0, pos) + insert + val.slice(pos)
            input.selectionStart = input.selectionEnd = pos + insert.length
            input.focus()
            emojiPicker.style.display = 'none'
        })
        emojiPicker.appendChild(btn)
    }
}

socket.on('emoji', map => { customEmoji = map; renderEmojiPicker() })
socket.on('emojiUpdate', map => {
    customEmoji = map
    renderEmojiPicker()
})

emojiBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    if (!Object.keys(customEmoji).length) return
    emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'grid' : 'none'
})

document.addEventListener('click', (e) => {
    if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
        emojiPicker.style.display = 'none'
    }
})

// typing indicator stuff
let typeTimeout
document.querySelector('#message-input').addEventListener('input', () => {
    socket.emit('typing')
    clearTimeout(typeTimeout)
    typeTimeout = setTimeout(() => socket.emit('stopTyping'), 2000)
})

const typingUsers = new Set()

function updateTypingIndicator() {
    const ind = document.querySelector('#typing-indicator')
    if (typingUsers.size === 0) {
        ind.textContent = ''
    } else if (typingUsers.size >= 3) {
        ind.textContent = 'several people are typing...'
    } else {
        const names = [...typingUsers].join(', ')
        ind.textContent = `${names} ${typingUsers.size === 1 ? 'is' : 'are'} typing...`
    }
}

socket.on('typing', (name) => {
    typingUsers.add(name)
    updateTypingIndicator()
})

socket.on('stopTyping', (name) => {
    typingUsers.delete(name)
    updateTypingIndicator()
})

// join only appears when active function
function activitya() {
    if (!activity) {
        activity = true
        socket.emit('userActive')
    }
}


// message history
socket.on('history', (messages) => {
    renderedHistory = messages
    lastMsgMeta = null
    atBottom = false  // suppress per-message scrolls during batch render
    messages.forEach(data => renderMessage(data))
    atBottom = true
    window.scrollTo({ top: document.body.scrollHeight })
})

async function sendMessageNew(e) {
    e.preventDefault()
    hideSuggestion()
    // stops typing when a message is sent
    socket.emit('stopTyping')
    const textInput = document.querySelector('#message-input')
    const fileInput = document.querySelector('#file-input')

    const file = fileInput.files[0]

    if (!textInput.value && !file) return

    if (file) {
        if (file.size > MAX_SIZE) {
            showError('file too big (max is 50mb)')
            fileInput.value = ''
            document.querySelector('#attach-btn').style.borderColor = ''
            document.querySelector('#attach-btn').style.color = ''
            return
        }
        const isImage = file.type.startsWith('image/')
        showStatus('uploading...')
        const url = await uploadFile(file)
        showStatus('uploaded!', 'pink')
        setTimeout(hideStatus, 3000)
        socket.emit('message', {
            username,
            text: isImage ? (textInput.value || null) : `${textInput.value ? textInput.value + ' ' : ''}${file.name}: ${url}`,
            image: isImage ? url : null
        })
        textInput.value = ''
        fileInput.value = ''
        document.querySelector('#attach-btn').style.borderColor = ''
        document.querySelector('#attach-btn').style.color = ''
    } else {
        socket.emit('message', {
            username,
            text: textInput.value,
            image: null
        })
        textInput.value = ''
    }
    textInput.focus()
}

// force enter to send message
document.querySelector('#file-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        document.querySelector('#message-form').requestSubmit()
    }
})
let atBottom = true
let scrolling = false
window.addEventListener('scroll', () => {
    if (scrolling) return
    atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 150
}, { passive: true })

function scrollToBottom() {
    atBottom = true
    scrolling = true
    window.scrollTo({ top: document.body.scrollHeight })
    requestAnimationFrame(() => { scrolling = false })
}

function appendMessage(li) {
    const ul = document.querySelector('ul')
    const shouldScroll = atBottom
    ul.appendChild(li)
    if (shouldScroll) scrollToBottom()

    // re-scroll after images load since they change page height
    const img = li.querySelector('img')
    if (img && !img.complete) {
        img.addEventListener('load', () => { if (atBottom) scrollToBottom() }, { once: true })
    }

    // nuke the oldest message because why not
    while (ul.children.length > maxmessages) {
        ul.removeChild(ul.firstChild)
    }
}

socket.on('connect', () => {
    localStorage.removeItem('banned')
    hideStatus()
})

socket.on('savedUsername', (name) => {
    const nameToUse = name || username
    username = nameToUse
    socket.emit('setUsername', nameToUse)
    // guests: avatar upload is hidden inside the edit profile view
    updateProfileBtn()
})

socket.on('disconnect', () => {
    showStatus('disconnected, reconnecting...', 'var(--muted)')
})


document.querySelector('#message-form').addEventListener('submit', sendMessageNew)

// more activity stuff
document.addEventListener('click', activitya)
document.addEventListener('keydown', activitya)
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) activitya()
})
socket.on("message", (data) => {
    if (isSystemMessage(data)) return
    renderedHistory.push(data)
    renderMessage(data)
    if (!notifymuted && myStatus !== 'dnd' && data.mentions && data.mentions.some(m => m.toLowerCase() === username.toLowerCase())) beep()
    if (document.hidden) {
        unread++
        document.title = `(${unread}) chat™`
    }
})
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        unread = 0
        document.title = 'chat™'
    }
})

let lastMsgMeta = null  // { username, time } — for message grouping

function makeBadge(src, size, tooltip) {
    const wrap = document.createElement('span')
    wrap.className = 'badge-wrap'
    wrap.dataset.tooltip = tooltip
    const img = document.createElement('img')
    img.src = src
    img.style.cssText = `width:${size}px;height:${size}px;vertical-align:middle;margin-left:4px;position:relative;top:-2px`
    wrap.appendChild(img)
    return wrap
}

function buildMsgContent(data, color) {
    const content = document.createElement('div')
    content.className = 'msg-content'
    if (data.text) content.appendChild(functioninglinks(data.text, flags[color] ? null : color))
    if (data.image) {
        const img = document.createElement('img')
        img.src = data.image
        img.addEventListener('click', () => lightbox(data.image))
        content.appendChild(img)
    }
    return content
}

function renderMessage(data) {
    const ausername = data.username
    const color = data.color || getNameColor(ausername)

    const isContinuation = !document.documentElement.classList.contains('compact') &&
        lastMsgMeta &&
        lastMsgMeta.username === ausername &&
        (data.time - lastMsgMeta.time) < 5 * 60 * 1000

    lastMsgMeta = { username: ausername, time: data.time }

    if (isContinuation) {
        const li = document.createElement('li')
        li.className = 'msg-cont'
        li.dataset.id = data.id
        li.appendChild(buildMsgContent(data, color))
        if (ausername === username || isOwner) {
            li.addEventListener('contextmenu', (e) => {
                e.preventDefault()
                openMessageContextMenu(li, data.id)
            })
        }
        appendMessage(li)
        return
    }

    const li = document.createElement('li')
    li.className = 'msg'
    li.dataset.id = data.id

    // left: avatar or initial placeholder
    const avatarCol = document.createElement('div')
    avatarCol.className = 'msg-avatar'
    if (data.avatar) {
        const av = document.createElement('img')
        av.src = data.avatar
        av.className = 'avatar'
        avatarCol.appendChild(av)
    } else {
        const placeholder = document.createElement('div')
        placeholder.className = 'avatar-placeholder'
        placeholder.textContent = (ausername || '?')[0]
        placeholder.style.backgroundColor = `hsl(${nameHash(ausername) % 360}, 55%, 38%)`
        avatarCol.appendChild(placeholder)
    }
    avatarCol.style.cursor = 'pointer'
    avatarCol.addEventListener('click', (e) => { e.stopPropagation(); openProfile(ausername) })
    li.appendChild(avatarCol)

    // right: body
    const body = document.createElement('div')
    body.className = 'msg-body'

    // header row: username + badges + time
    const header = document.createElement('div')
    header.className = 'msg-header'

    const namespan = document.createElement('span')
    namespan.className = 'msg-username'
    const nametext = document.createElement('span')
    applyFlagColor(nametext, color)
    nametext.textContent = ausername
    namespan.appendChild(nametext)
    if (data.isToken) namespan.appendChild(makeBadge('https://cdn.chattm.app/verified_owner.png', 14, 'this user is verified to be the owner of chat™'))
    if (data.verified && !data.isToken) namespan.appendChild(makeBadge('https://cdn.chattm.app/verified.png', 14, 'this user has been verified'))
    namespan.style.cursor = 'pointer'
    namespan.addEventListener('click', (e) => { e.stopPropagation(); openProfile(ausername) })
    header.appendChild(namespan)

    const timespan = document.createElement('span')
    timespan.className = 'msg-time'
    timespan.textContent = new Date(Number(data.time)).toLocaleString([], {hour: '2-digit', minute: '2-digit'})
    header.appendChild(timespan)
    body.appendChild(header)

    body.appendChild(buildMsgContent(data, color))
    li.appendChild(body)

    if (ausername === username || isOwner) {
        li.addEventListener('contextmenu', (e) => {
            e.preventDefault()
            openMessageContextMenu(li, data.id)
        })
    }

    appendMessage(li)
}

function openMessageContextMenu(li, messageId) {
    const menu = document.querySelector('#message-context-menu')
    const rect = li.getBoundingClientRect()
    menu.style.left = `${rect.left}px`
    menu.style.top = `${rect.bottom + 4}px`
    menu.classList.add('open')

    const deleteBtn = document.querySelector('#ctx-delete-btn')
    deleteBtn.onclick = () => {
        socket.emit('deleteMessage', messageId)
        menu.classList.remove('open')
    }
}

document.addEventListener('click', (e) => {
    const ctxMenu = document.querySelector('#message-context-menu')
    if (!ctxMenu.contains(e.target)) {
        ctxMenu.classList.remove('open')
    }
})

document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('li')) {
        document.querySelector('#message-context-menu').classList.remove('open')
    }
})

socket.on('messageDeleted', (messageId) => {
    const li = document.querySelector(`li[data-id="${messageId}"]`)
    if (li) li.remove()
})
// user renamed status
socket.on('userRenamed', ({from, to}, guest) => {
    if (guest) {
        return
    } else {
        showStatus(`changed username to ${to}`, 'hotpink')
        setTimeout(hideStatus, 3000)
    }
})

/*
// user renamed system message
socket.on('userRenamedSys', ({from, to}, guest) => {
    if (guest) {
        return
    } else {
        systemMessage(`${from} changed their username to ${to}`)
    }
}) 
    */

// cdn/image stuff
async function uploadFile(file) {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('username', username)
    const res = await fetch(`${window.location.origin}/upload?session=${encodeURIComponent(session || '')}`, {
        method: 'POST',
        body: formData
    })
    const {url} = await res.json()
    return url
}

// links show up as links in chat
function functioninglinks(text, color) {
    const tokenRegex = /(https?:\/\/[^\s]+)|(@[a-zA-Z0-9_]+)|(:[a-z0-9_-]+:)/g
    const parts = text.split(tokenRegex).filter(p => p !== undefined)
    const fragment = document.createDocumentFragment()

    for (const part of parts) {
        if (!part) continue
        if (/^https?:\/\//.test(part)) {
            const a = document.createElement('a')
            a.href = part
            a.textContent = part
            a.target = '_blank'
            a.rel = 'noopener noreferer'
            a.style.color = color
            fragment.appendChild(a)
        } else if (/^@[a-zA-Z0-9_]+$/.test(part)) {
            const span = document.createElement('span')
            span.className = 'mention'
            span.textContent = part
            fragment.appendChild(span)
        } else if (/^:[a-z0-9_-]+:$/.test(part) && customEmoji[part]) {
            const img = document.createElement('img')
            img.src = customEmoji[part]
            img.className = 'custom-emoji'
            img.title = part
            img.alt = part
            fragment.appendChild(img)
        } else {
            fragment.appendChild(document.createTextNode(part))
        }
    }
    return fragment
}

// upload error stuff
function showError(msg) {
    const e = document.querySelector('#upload-error')
    e.textContent = msg
    e.style.display = 'block'
    setTimeout(() => {
        e.style.display = 'none'
        e.textContent = ''
    }, 3000)
}

// status stuff
function showStatus(msg, color = 'gray') {
    const e = document.querySelector('#upload-status')
    e.textContent = msg
    e.style.display = 'block'
    e.style.color = color || 'gray'
}

function hideStatus() {
    const e = document.querySelector('#upload-status')
    e.style.display = 'none'
    e.textContent = ''
}
// beep
function getaudioctx() {
    if (!audioctx) {
        audioctx = new AudioContext()
    }
    if (audioctx.state === 'suspended') {
        audioctx.resume()
    }
    return audioctx
}
function beep() {
    const ctx = getaudioctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 440
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.2)
}

// sign out button thingys
document.querySelector('#signout').addEventListener('click', () => {
    const session = localStorage.getItem('session')
    localStorage.removeItem('session')
    window.location.href = `/signout?session=${session}`
})

// banned
socket.on('banned', (reason) => {
    // useless localStorage.setItem('banned', reason || 'no reason given')
    location.reload()
})

socket.on('kicked', (reason) => {
    localStorage.removeItem('session')
    sessionStorage.setItem('kickedReason', reason || 'no reason given')
    window.location.href = '/'
})

// an iq too high?
// join/leave messages/system messages

// nuke session and reload if unauthenticated, updated for maintenance
socket.on('connect_error', (err) => {
    if (err.message === 'maintenance') {
        showMaintenance(maintenanceCheck.reason)
        return
    }
    if (err.message === 'banned') {
        document.body.className = 'login-page'
        document.body.innerHTML = `
            <h1>chat™</h1>
            <p style="color: var(--pink)">you have been banned</p>
            <p>reason: ${err.data?.reason || 'no reason given'}</p>
            <p style="color: var(--muted)">to appeal, email <a href="mailto:emma@chattm.app">emma@chattm.app</a></p>
        `
        devInstanceBanner()
        return
    }
    if (err.message === 'not authenticated') {
        localStorage.removeItem('session')
        location.reload()
    }
    if (err.message === 'rate limited') return  // socket.io will retry automatically
    // for transient errors, let socket.io reconnect automatically
})

socket.on('maintenance', (enabled, reason) => {
    if (enabled) {
        try {
            showMaintenance(reason)
        } catch (e) {}
    }
})

// user list client side stuff
let onlineUsernames = []

function makeUserlistEntry(u) {
    const div = document.createElement('div')
    div.className = 'ul-entry' + (u.online ? '' : ' ul-offline')

    // avatar with status dot overlay
    const avWrap = document.createElement('div')
    avWrap.className = 'ul-avatar-wrap'
    if (u.avatar) {
        const img = document.createElement('img')
        img.src = u.avatar
        img.className = 'ul-avatar'
        avWrap.appendChild(img)
    } else {
        const pl = document.createElement('div')
        pl.className = 'ul-avatar ul-avatar-placeholder'
        pl.textContent = (u.username || '?')[0]
        pl.style.backgroundColor = `hsl(${nameHash(u.username) % 360}, 55%, 38%)`
        avWrap.appendChild(pl)
    }
    const dot = document.createElement('span')
    dot.className = `ul-status-dot ${u.online ? (u.status || 'online') : 'offline'}`
    avWrap.appendChild(dot)
    div.appendChild(avWrap)

    // name + badges
    const info = document.createElement('div')
    info.className = 'ul-info'
    const nameEl = document.createElement('span')
    nameEl.className = 'ul-name'
    applyFlagColor(nameEl, u.color || getNameColor(u.username))
    nameEl.textContent = u.username
    info.appendChild(nameEl)
    if (u.isOwner) info.appendChild(makeBadge('https://cdn.chattm.app/verified_owner.png', 11, 'this user is verified to be the owner of chat™'))
    else if (u.verified) info.appendChild(makeBadge('https://cdn.chattm.app/verified.png', 11, 'this user has been verified'))
    div.appendChild(info)

    div.addEventListener('click', (e) => { e.stopPropagation(); openProfile(u.username) })
    return div
}

socket.on('userlist', (users) => {
    onlineUsernames = users.filter(u => u.online).map(u => u.username).filter(Boolean)
    const ul = document.querySelector('#userlist')
    ul.innerHTML = ''

    const online = users.filter(u => u.online)
    const offline = users.filter(u => !u.online)

    if (online.length) {
        const header = document.createElement('div')
        header.className = 'ul-section'
        header.textContent = `online — ${online.length}`
        ul.appendChild(header)
        online.forEach(u => ul.appendChild(makeUserlistEntry(u)))
    }

    if (offline.length) {
        const header = document.createElement('div')
        header.className = 'ul-section'
        header.textContent = `offline — ${offline.length}`
        ul.appendChild(header)
        offline.forEach(u => ul.appendChild(makeUserlistEntry(u)))
    }
})

// file input stuff
document.querySelector('#attach-btn').addEventListener('click', () => {
    document.querySelector('#file-input').click()
})

document.querySelector('#file-input').addEventListener('change', () => {
    const file = document.querySelector('#file-input').files[0]
    const btn = document.querySelector('#attach-btn')
    btn.style.borderColor = file ? 'var(--pink)' : ''
    btn.style.color = file ? 'var(--pink)' : ''
})

// clear chat command
socket.on('clear', () => {
    document.querySelector('ul').innerHTML = ''
})

// command autocomplete
const commands = ["/whois [username]", '/noguests', '/setnick [oldname] [newname]', '/allowguests', '/removefilter [word]', '/addfilter [word]', '/reloadfilter', "/kick [username] [reason]", '/setcolor [username] [color]', '/resetstrikes [username]', "/clear", "/announce [text]", '/mute [username] [time] [reason]', '/unmute [username]', "/mutechat", "/status [text]", "/unmutechat", "/color [color|pride|trans|bi|lesbian|nb|gay]", "/colour [colour|pride|trans|bi|lesbian|nb|gay]", "/nick [name]", "/ban [username] [reason]", '/unban [email]', '/unbanip [ip]', '/addemoji [:shortcode:] [url]', '/removeemoji [:shortcode:]', '/reloademojis', '/verify [email]', '/unverify [email]']

// stores what to actually insert on Tab (may differ from displayed suggestion text)
let suggestionInsert = null

function showSuggestion(displayText, insertValue, prefixImg = null) {
    const suggestion = document.querySelector('#command-suggestion')
    suggestion.innerHTML = ''
    if (prefixImg) {
        const img = document.createElement('img')
        img.src = prefixImg
        img.className = 'custom-emoji'
        img.style.marginRight = '5px'
        suggestion.appendChild(img)
    }
    suggestion.appendChild(document.createTextNode(displayText))
    suggestion.style.display = 'block'
    suggestionInsert = insertValue
}

function hideSuggestion() {
    const suggestion = document.querySelector('#command-suggestion')
    suggestion.style.display = 'none'
    suggestion.innerHTML = ''
    suggestionInsert = null
}

document.querySelector('#message-input').addEventListener('input', (e) => {
    const value = e.target.value
    const cursor = e.target.selectionStart

    const usernameCmdMatch = value.match(/^\/(kick|mute|unmute|whois|resetstrikes|setcolor|ban)\s+([a-zA-Z0-9-]*)$/)
    if (usernameCmdMatch) {
        const [, cmd, partial] = usernameCmdMatch
        const lower = partial.toLowerCase()
        const userMatch = onlineUsernames.find(name => name.toLowerCase().startsWith(lower) && name.toLowerCase() !== lower)
        if (userMatch) {
            const full = `/${cmd} ${userMatch} `
            showSuggestion(full, full)
            return
        }
    }

    const before = value.slice(0, cursor)
    const mentionMatch = before.match(/@([a-zA-Z0-9_]*)$/)
    if (mentionMatch) {
        const fragment = mentionMatch[1].toLowerCase()
        const userMatch = onlineUsernames.find(name => name.toLowerCase().startsWith(fragment) && name.toLowerCase() !== fragment)
        if (userMatch) {
            const full = value.slice(0, cursor - mentionMatch[1].length) + userMatch + value.slice(cursor)
            showSuggestion(full, full)
            return
        }
    }

    // emoji shortcode autocomplete: match :partial before cursor
    const emojiMatch = before.match(/:([a-z0-9_-]*)$/)
    if (emojiMatch && !value.startsWith('/')) {
        const partial = emojiMatch[1].toLowerCase()
        const match = Object.keys(customEmoji).find(sc => sc.slice(1).startsWith(partial) && sc.slice(1) !== partial)
        if (match) {
            const afterCursor = value.slice(cursor)
            const completed = value.slice(0, cursor - emojiMatch[1].length) + match.slice(1) + ' ' + afterCursor
            showSuggestion(match + ' ', completed, customEmoji[match])
            return
        }
    }

    if (value.startsWith('/')) {
        const match = commands.find(c => c.startsWith(value))
        if (match && match !== value) {
            showSuggestion(match, match)
        } else {
            hideSuggestion()
        }
    } else {
        hideSuggestion()
    }
})

document.querySelector('#message-input').addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        const suggestion = document.querySelector('#command-suggestion')
        if (suggestion.style.display !== 'none' && suggestionInsert !== null) {
            e.preventDefault()
            document.querySelector('#message-input').value = suggestionInsert
            hideSuggestion()
        }
    }
})

socket.on('commandError', (msg) => {
    showError(msg)
})

let chatMutedb = false

// check owner status and mute chat status on connect
socket.on('init', ({isOwner: owner, chatMuted: muted, color, uMuted}) => {
    isOwner = owner
    updateProfileBtn()
    if (muted && !isOwner) {
        showStatus('chat has been muted', 'pink')
        document.querySelector('#message-input').disabled = true
        document.querySelector('#message-form button[type="submit"]').disabled = true
        document.querySelector('#attach-btn').disabled = true
    }
    if (uMuted) {
        document.querySelector('#message-input').disabled = true
        document.querySelector('#message-form button[type="submit"]').disabled = true
        showStatus(`you are muted${uMuted.until ? ' until ' + new Date(uMuted.until).toLocaleString() : ''} — ${uMuted.reason}`, 'pink')
    }
    if (isOwner) {
        document.querySelector('#owner-divider').style.display = 'block'
        document.querySelector('#owner-tools').style.display = 'flex'
    }

    if (color) userColor = color
})

document.querySelector('#owner-mutechat-btn').addEventListener('click', () => {
    socket.emit('message', {text: chatMutedb ? '/unmutechat' : '/mutechat'})
})
document.querySelector('#owner-maintenance-btn').addEventListener('click', async () => {
    const reason = await showModal({message: "maintenance reason (leave blank to turn off):", withInput: true})
    if (reason === null) return
    socket.emit('message', {text: `/maintenance ${reason}`})
})
document.querySelector('#owner-clear-btn').addEventListener('click', async () => {
    const confirmed = await showModal({message: "clear all chat history? this can't be reversed"})
    if (confirmed) {
        socket.emit('message', {text: '/clear'})
    }
})
document.querySelector('#owner-refresh-version-btn').addEventListener('click', () => {
    loadVersionStatus(true)
    showStatus('refreshing version status...', 'pink')
    setTimeout(hideStatus, 1500)
})

// mute chat
socket.on('mutechat', (ann) => {
    if (!isOwner) {
    document.querySelector('#message-input').disabled = true
    document.querySelector('#message-form button[type="submit"]').disabled = true
    document.querySelector('#attach-btn').disabled = false
    }
    chatMutedb = true
    showStatus(ann, 'pink')
})

// unmute chat
socket.on('unmutechat', (ann) => {
    hideStatus()
    document.querySelector('#message-input').disabled = false
    document.querySelector('#message-form button[type="submit"]').disabled = false
    document.querySelector('#attach-btn').disabled = false
    chatMutedb = false
})

// status
socket.on('status', (status) => {
    showStatus(status, 'pink')
})

// color status
socket.on('colorChanged', (color) => {
    const display = color.startsWith('flag:') ? color.slice(5) : color
    showStatus(`name color changed to ${display}`, 'pink')
    setTimeout(hideStatus, 3000)
})

// muteded stuff
socket.on('muted', ({reason, until}) => {
    document.querySelector('#message-input').disabled = true
    document.querySelector('#message-form button[type="submit"]').disabled = true
    showStatus(`you are muted${until ? ' until ' + new Date(until).toLocaleString() : ''} - reason: ${reason}`, 'pink')
})
socket.on('unmuted', () => {
    document.querySelector('#message-input').disabled = false
    document.querySelector('#message-form button[type="submit"]').disabled = false
    hideStatus()
})

// modal
function showModal({message, withInput = false, defaultValue = ''}) {
    return new Promise((resolve) => {
        const overlay = document.querySelector('#modal-overlay')
        const msgEl = document.querySelector('#modal-message')
        const inputEl = document.querySelector('#modal-input')
        const confirmBtn = document.querySelector('#modal-confirm')
        const cancelBtn = document.querySelector('#modal-cancel')

        msgEl.textContent = message
        inputEl.style.display = withInput ? 'block' : 'none'
        inputEl.value = defaultValue
        overlay.style.display = 'flex'
        if (withInput) inputEl.focus()

        function cleanUp(result) {
            overlay.style.display = 'none'
            confirmBtn.removeEventListener('click', onConfirm)
            cancelBtn.removeEventListener('click', onCancel)
            resolve(result)
        }
        function onConfirm() {
            cleanUp(withInput ? inputEl.value : true)
        }
        function onCancel() {
            cleanUp(withInput ? null : false)
        }
        confirmBtn.addEventListener('click', onConfirm)
        cancelBtn.addEventListener('click', onCancel)
    })
}

/* useless

// color picker stuff
const colorBtn = document.querySelector('#color-btn')
const colorInput = document.querySelector('#color-input')

// i am aware this implementation sucks and the position probably doesn't work but i am not making a custom color picker

colorBtn.addEventListener('click', () => {
    const rect = colorBtn.getBoundingClientRect()
    colorInput.style.position = 'fixed'
    colorInput.style.top = `${rect.bottom + 4}px`
    colorInput.style.left = `${rect.left}px`
    colorInput.click()
})

colorInput.addEventListener('change', (e) => {
    socket.emit('message', { text: `/color ${e.target.value}` })
})

*/

}