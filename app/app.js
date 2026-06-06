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

if (!session) {
    document.body.className = 'login-page'
    document.body.innerHTML = `
        <h1>chat™</h1>
        <p>you need to sign in to chat</p>
        <a href="/login"><button><i class="ti ti-login-2"></i> login with Hack Club</button></a>
        <a href="/guest"><button><i class="ti ti-login-2"></i> continue as guest</button></a>
    `
    throw new Error('not authenticated')
}

if (session) {
    /* not needed anymore
    if (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
        showStatus('ui not optimised for mobile', 'pink')
    }
        */
if (localStorage.getItem('banned')) {
    // localStorage.removeItem('banned')
    showStatus('you have been banned', 'red')
} else if (sessionStorage.getItem('newlogin')) {
    sessionStorage.removeItem('newlogin')
    showStatus("welcome to chat™, set your username above if you haven't", 'pink')
    setTimeout(hideStatus, 3000)
}


const socket = io(
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'ws://localhost:3000'
        : 'wss://chat.emmameowss.gay', // set this to the ip/url of the site/proxy you're using for the backend server thing
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
    if (input.value.trim()) {
        username = input.value.trim()
        localStorage.setItem('username', username)
        socket.emit('setUsername', username)
    }
})

// move socket joined/left stuff after intialiing socket
socket.on('userJoined', (name) => { 
    systemMessage(`${name} joined`)
})
socket.on('userLeft', (name) =>  {
    systemMessage(`${name} left`)
})
// mute button
let notifymuted = localStorage.getItem('notifymuted') === 'true'
const mutebtn = document.querySelector('#mute-btn')
mutebtn.innerHTML = ''
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
        const li = document.createElement('li')
        const ausername = data.username
        const color = data.color || getNameColor(ausername)
        const namespan = document.createElement('span')
        const timespan = document.createElement('span')
        timespan.className = 'msg-time'
        timespan.textContent = `[${new Date(Number(data.time)).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}]`
        applyFlagColor(timespan, color)
        if (data.isToken) {
           const tag = document.createElement('span')
           tag.textContent = '♛ '
           tag.style.color = 'hotpink'
           namespan.appendChild(tag)
        }
        li.appendChild(timespan)
        li.appendChild(namespan)
        const nametext = document.createElement('span')
        nametext.textContent = ausername
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
    if (e.key === 'Enter' ** !e.shiftKey) {
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
})


document.querySelector('#message-form').addEventListener('submit', sendMessageNew)

// more activity stuff
document.addEventListener('click', activitya)
document.addEventListener('keydown', activitya)
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) activitya()
})
socket.on("message", (data) => {
    const li = document.createElement('li')
    const ausername = data.username
    const color = data.color || getNameColor(ausername)
    const timespan = document.createElement('span')
    timespan.className = 'msg-time'
    timespan.textContent = `[${new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}]`
    const namespan = document.createElement('span')
    applyFlagColor(timespan, color)
    if (data.isToken) {
        const tag = document.createElement('span')
        tag.textContent = '♛ '
        tag.style.color = 'hotpink'
        namespan.appendChild(tag)
        }
    li.appendChild(timespan)
    li.appendChild(namespan)
    const nametext = document.createElement('span')
    nametext.textContent = ausername
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
socket.on('banned', () => {
    localStorage.setItem('banned', '1') // lazy and shit ass way of doing it but it's just for the ban ui they're stiull banned serverside idot care
    location.reload()
})
// handle announcement command
socket.on('announcement', (ann) => {
    announce = true
    systemMessage(ann)
})
// an iq too high?
// join/leave messages/system messages
function systemMessage(text) {
    console.log(text)
    if (announce) {
        const li = document.createElement('li')
        li.textContent = text
        li.style.color = 'pink'
        li.style.fontStyle = 'italic'
        appendMessage(li)
        announce = false
    } 
    else {
    const li = document.createElement('li')
    li.textContent = text
    li.style.color = 'gray'
    li.style.fontStyle = 'italic'
    appendMessage(li)
    }
}

// nuke session and reload if unauthenticated
socket.on('connect_error', (err) => {
    localStorage.removeItem('session')
    location.reload()
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
const commands = ["/clear", "/announce ", "/mutechat", "/status", "/unmutechat", "/color [color|pride|trans|bi|lesbian|nb]"]

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

// check owner status and mute chat status on connect
socket.on('init', ({isOwner: owner, chatMuted: muted, color}) => {
    isOwner = owner
    if (muted && !isOwner) {
        showStatus('chat has been muted', 'pink')
        document.querySelector('#message-input').disabled = true
        document.querySelector('#message-form button[type="submit"]').disabled = true
        document.querySelector('#attach-btn').disabled = true
    }
    if (color) userColor = color
})

// mute chat
socket.on('mutechat', (ann) => {
    if (!isOwner) {
    document.querySelector('#message-input').disabled = true
    document.querySelector('#message-form button[type="submit"]').disabled = true
    document.querySelector('#attach-btn').disabled = false
    }
    systemMessage(ann)
    showStatus(ann, 'pink')
})

// unmute chat
socket.on('unmutechat', (ann) => {
    systemMessage(ann)
    hideStatus()
    document.querySelector('#message-input').disabled = false
    document.querySelector('#message-form button[type="submit"]').disabled = false
    document.querySelector('#attach-btn').disabled = false
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

}