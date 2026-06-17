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
        <p style="color: var(--muted)">to appeal, email <a href="mailto:emma@csarcade.wiki">emma@csarcade.wiki</a></p>
    `
    devInstanceBanner()
    throw new Error('banned')
}

// colors
function getNameColor(name) {
    if (!name) return 'var(--muted)'
    if (name.toLowerCase() === 'emma') return 'hotpink'
    let hash = 0
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash)
    }
    return `hsl(${hash % 360}, 70%, 65%)`
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
        'dev.chat.emmameowss.gay',
        'localhost',
        '127.0.0.1'
    ]

    if (!devHosts.includes(window.location.hostname)) return
    if (document.querySelector('#dev-banner')) return

    if (devHosts.includes('https://dev.chat.emmameowss.gay')) {
        const banner = document.createElement('div')
        banner.id = 'dev-banner'
        banner.textContent = 'this is a beta instance of chat™ - things may not be stable, data is wiped every 24 hours'
        document.body.appendChild(banner)
    } else {
        const banner = document.createElement('div')
        banner.id = 'dev-banner'
        banner.textContent = 'this is a dev instance of chat™ - things may not be stable and may break often'
        document.body.appendChild(banner)
    }
}

fetch('/version').then(r => r.json()).then(v => {
    if (v.upToDate === null) return
    const el = document.querySelector('#version-status')
    if (v.upToDate) {
        el.textContent = `up to date (${v.currentCommit})`
    } else if (v.ahead) {
        el.textContent = `${v.ahead} commit${v.ahead === 1 ? '' : 's'} ahead (${v.currentCommit})`
    } else {
        el.textContent = `${v.behind} commit${v.behind === 1 ? '' : 's'} behind (${v.currentCommit})`
        el.classList.add('outdated')
    }
}).catch(() => {})

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

let hideSysMsg = localStorage.getItem('hideSysMsg') === 'true'
const sysMsgBtn = document.querySelector('#sysmsg-btn')
sysMsgBtn.classList.toggle('hidden-active', hideSysMsg)

sysMsgBtn.addEventListener('click', () => {
    hideSysMsg = !hideSysMsg
    localStorage.setItem('hideSysMsg', hideSysMsg)
    sysMsgBtn.classList.toggle('hidden-active', hideSysMsg)
})

const flags = {
    'flag:pride':       'linear-gradient(90deg,#ff0018,#ffa52c,#ffff41,#008018,#0000f9,#86007d)',
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
if (new URLSearchParams(window.location.search).get('error') === 'auth_denied') {
    window.history.replaceState({}, '', '/')
    sessionStorage.setItem('authDenied', '1')
}

if (!session) {
    if (maintenanceCheck.maintenance) showMaintenance(maintenanceCheck.reason)
    document.body.className = 'login-page'
    document.body.innerHTML = `
        <h1>chat™</h1>
        <p>you need to sign in to chat</p>
        <a href="/login"><button><i class="ti ti-login-2"></i> login with Hack Club</button></a>
        <a href="/guest"><button><i class="ti ti-user"></i> continue as guest</button></a>
        ${sessionStorage.getItem('authDenied') ? '<p style="color: var(--pink)">login was cancelled or denied</p>' : ''}
    `
    devInstanceBanner()
    sessionStorage.removeItem('authDenied')
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
        auth: { session: localStorage.getItem('session') }
    }
)
const resetId = document.querySelector("#resetid")
const maxmessages = 20
let announce = false
const MAX_SIZE = 50 * 1024 * 1024 // 10mb limit to images

// username functionality stuff
document.querySelector('#username-input').value = username

document.querySelector('#username-form').addEventListener('submit', (e) => {
    e.preventDefault()
    const input = document.querySelector('#username-input')
    const value = input.value.trim()
    if (!/^[a-zA-Z0-9]{1,20}$/.test(value)) {
        showError("invalid username, make sure it's within the character limit and uses only letters and numbers")
        return
    }
    username = input.value.trim()
    localStorage.setItem('username', username)
    socket.emit('setUsername', username)
})

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
    messages.forEach(data => {
        if (isSystemMessage(data)) {
            if (hideSysMsg) return
            const li = document.createElement('li')
            li.textContent = data.text
            li.style.color = 'gray'
            li.style.fontStyle = 'italic'
            appendMessage(li)
            return
        }
        const li = document.createElement('li')
        const ausername = data.username
        const color = data.color || getNameColor(ausername)
        const namespan = document.createElement('span')
        const timespan = document.createElement('span')
        timespan.className = 'msg-time'
        timespan.textContent = `[${new Date(Number(data.time)).toLocaleString([], {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'})}]`
        applyFlagColor(timespan, color)
        li.appendChild(timespan)
        li.appendChild(namespan)
        const nametext = document.createElement('span')
        nametext.textContent = ausername
        if (data.isToken) {
           const tag = document.createElement('span')
           tag.textContent = '♛'
           tag.style.cssText = 'color:hotpink;margin-right:8px'
           namespan.appendChild(tag)
        }
        if (data.isGuest) {
            const badge = document.createElement('i')
            badge.className = 'ti ti-user'
            badge.style.cssText = `font-size:10px;margin-right:8px`
            applyFlagColor(badge, color)
            namespan.appendChild(badge)
        }
        applyFlagColor(nametext, color)
        nametext.style.display = 'inline-block'
        namespan.appendChild(nametext)
        namespan.appendChild(document.createTextNode(': '))
        if (data.text) {
           li.appendChild(functioninglinks(data.text, flags[color] ? null : color))
        }
        if (data.image) {
            const img = document.createElement('img')
            img.src = data.image
            img.style.cssText = 'max-width:300px;display:block;cursor:zoom-in'
            img.addEventListener('click', () => lightbox(data.image))
            li.appendChild(img)
        }
        appendMessage(li)
    })
})

async function sendMessageNew(e) {
    e.preventDefault()
    // stops typing when a message is sent
    socket.emit('stopTyping')
    const textInput = document.querySelector('#message-input')
    const fileInput = document.querySelector('#file-input')

    const file = fileInput.files[0]

    if (!textInput.value && !file) return

    if (file) {
        if (file.size > MAX_SIZE) {
            showError('file too big (max is 50mb)')
            fileInput.value('')
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
function appendMessage(li) {
    const ul = document.querySelector('ul')
    ul.appendChild(li)
    li.scrollIntoView({behavior: 'smooth'})

    // nuke the oldest message because why not
    while (ul.children.length > maxmessages) {
        ul.removeChild(ul.firstChild)
    }

}

socket.on('connect', () => {
    localStorage.removeItem('banned')
    const token = localStorage.getItem('token')
    socket.emit('setUsername', username, token)
    if (!username.startsWith('guest-') && !localStorage.getItem('isGuest')) {
        socket.emit('setUsername', username, token)
    }
})


document.querySelector('#message-form').addEventListener('submit', sendMessageNew)

// more activity stuff
document.addEventListener('click', activitya)
document.addEventListener('keydown', activitya)
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) activitya()
})
socket.on("message", (data) => {
    if (isSystemMessage(data)) {
        if (hideSysMsg) return
        const li = document.createElement('li')
        li.textContent = data.text
        li.style.color = 'gray'
        li.style.fontStyle = 'italic'
        appendMessage(li)
        return
    }
    const li = document.createElement('li')
    const ausername = data.username
    const color = data.color || getNameColor(ausername)
    const timespan = document.createElement('span')
    timespan.className = 'msg-time'
    timespan.textContent = `[${new Date().toLocaleString([], {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'})}]`
    const namespan = document.createElement('span')
    applyFlagColor(timespan, color)
    li.appendChild(timespan)
    li.appendChild(namespan)
    const nametext = document.createElement('span')
    nametext.textContent = ausername
    if (data.isToken) {
        const tag = document.createElement('span')
        tag.textContent = '♛'
        tag.style.cssText = 'color:hotpink;margin-right:8px'
        namespan.appendChild(tag)
    }
    if (data.isGuest) {
        const badge = document.createElement('i')
        badge.className = 'ti ti-user'
        badge.style.cssText = `font-size:10px;margin-right:8px`
        applyFlagColor(badge, color)
        namespan.appendChild(badge)
    }
    if (data.username === 'SYSTEM') {
        socket.emit('commandError', 'invalid username')
        return
    }
    applyFlagColor(nametext, color)
    nametext.style.display = 'inline-block'
    namespan.appendChild(nametext)
    namespan.appendChild(document.createTextNode(': '))
    if (data.text) {
        li.appendChild(functioninglinks(data.text, flags[color] ? null : color))
    }
    if (data.image) {
        const img = document.createElement('img')
        img.src = data.image
        img.style.cssText = 'max-width:300px;display:block;cursor:zoom-in'
        img.addEventListener('click', () => lightbox(data.image))
        li.appendChild(img)
    }

    appendMessage(li)
    if (document.hidden && !notifymuted) {
        beep()
    }

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
// user renamed status
socket.on('userRenamed', ({from, to}, guest) => {
    if (guest) {
        return
    } else {
        showStatus(`changed username to ${to}`, 'hotpink')
        setTimeout(hideStatus, 3000)
    }
})

// user renamed system message
socket.on('userRenamedSys', ({from, to}, guest) => {
    if (guest) {
        return
    } else {
        systemMessage(`${from} changed their username to ${to}`)
    }
}) 

// cdn/image stuff
async function uploadFile(file) {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('username', username)
    formData.append('session', localStorage.getItem('session'))
    const res = await fetch(`${window.location.origin}/upload`, {
        method: 'POST',
        body: formData
    })
    const {url} = await res.json()
    return url
}

// links show up as links in chat
function functioninglinks(text, color) {
    const urlRegex = /(https?:\/\/[^\s]+)/g
    const parts = text.split(urlRegex)
    const fragment = document.createDocumentFragment()

    parts.forEach((part, i) => {
        if (i % 2 === 1) {
            const a = document.createElement('a')
            a.href = part
            a.textContent = part
            a.target = '_blank'
            a.rel = 'noopener noreferer'
            a.style.color = color
            fragment.appendChild(a)
        } else {
            fragment.appendChild(document.createTextNode(part))
        }
    })
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
// handle announcement command
socket.on('announcement', (ann) => {
    announce = true
    systemMessage(ann)
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
            <p style="color: var(--muted)">to appeal, email <a href="mailto:emma@csarcade.wiki">emma@csarcade.wiki</a></p>
        `
        devInstanceBanner()
        return
    }
    localStorage.removeItem('session')
    location.reload()
})

socket.on('maintenance', (enabled, reason) => {
    if (enabled) {
        try {
            showMaintenance(reason)
        } catch (e) {}
    }
})

// user list client side stuff
socket.on('userlist', (users) => {
    const ul = document.querySelector('#userlist')
    ul.innerHTML = `<strong>online (${users.length})</strong><br>`
    users.forEach(u => {
        const div = document.createElement('div')
        const inner = document.createElement('span')
        inner.textContent = u.username
        inner.style.display = 'inline-block'
        applyFlagColor(inner, u.color || getNameColor(u.username))
        div.appendChild(inner)
        if (u.guest) {
            const badge = document.createElement('span')
            badge.className = 'ti ti-user'
            badge.style.cssText = 'font-size:10px;color:var(--pink);margin-right:8px'
            div.insertBefore(badge,inner)
        }
        if (u.isOwner) {
            const crown = document.createElement('span')
            crown.textContent = '♛'
            crown.style.cssText = 'color:hotpink;margin-right:8px;font-size:10px'
            div.insertBefore(crown, inner)
}
        ul.appendChild(div)
    })
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
    systemMessage('chat was cleared')
})

// command autocomplete
const commands = ["/whois [username]", '/setcolor [username] [color]', '/resetstrikes [username]', "/clear", "/announce [text]", '/mute [username] [time] [reason]', '/unmute [username]', "/mutechat", "/status [text]", "/unmutechat", "/color [color|pride|trans|bi|lesbian|nb]", "/colour [colour|pride|trans|bi|lesbian|nb]", "/nick [name]", "/ban [email]", '/unban [email]', '/unbanip [ip]']

document.querySelector('#message-input').addEventListener('input', (e) => {
    const value = e.target.value
    const suggestion = document.querySelector('#command-suggestion')

    if (value.startsWith('/')) {
        const match = commands.find(c => c.startsWith(value))
        if (match && match !== value) {
            suggestion.textContent = match
            suggestion.style.display = 'block'
        } else {
            suggestion.style.display = 'none'
        }
    } else {
        suggestion.style.display = 'none'
    }
})

document.querySelector('#message-input').addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        const suggestion = document.querySelector('#command-suggestion')
        if (suggestion.style.display !== 'none') {
            e.preventDefault()
            document.querySelector('#message-input').value = suggestion.textContent
            suggestion.style.display = 'none'
        }
    }
})
// guest sign in stuff
socket.on('guestUsername', (name, guest) => {
    username = name
    guest = true
    document.querySelector('#username-input').value = name
    socket.emit('setUsername', name, guest)

    document.querySelector('#username-input').disabled = true
    document.querySelector('#username-form button[type="submit"]').disabled = true
})

socket.on('commandError', (msg) => {
    showError(msg)
})

let chatMutedb = false

// check owner status and mute chat status on connect
socket.on('init', ({isOwner: owner, chatMuted: muted, color, uMuted}) => {
    isOwner = owner
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