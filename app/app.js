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
        <a href="/login"><button>login with Hack Club</button></a>
    `
    throw new Error('not authenticated')
}

if (session) {
if (localStorage.getItem('banned')) {
    // localStorage.removeItem('banned')
    showUploadStatus('you have been banned', 'red')
} else if (sessionStorage.getItem('newlogin')) {
    sessionStorage.removeItem('newlogin')
    showUploadStatus("welcome to chat™, set your username above if you haven't", 'pink')
    setTimeout(hideUploadStatus, 3000)
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
const maxmessages = 25
// for testing reasons: 500kb limit
// const MAX_SIZE = 500 * 1024
const MAX_SIZE = 10 * 1024 * 1024 // 10mb limit to images

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
        const name = data.username
        const namespan = document.createElement('span')
        const time = new Date(data.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        namespan.style.color = getNameColor(name)
        if (data.isToken) {
           const tag = document.createElement('span')
           tag.textContent = '♛ '
           tag.style.color = 'hotpink'
           namespan.appendChild(tag)
        }
        namespan.appendChild(document.createTextNode(`[${time}] ${name}: `))
        li.appendChild(namespan)
        if (data.text) {
           li.appendChild(functioninglinks(data.text, getNameColor(name)))
        }
        if (data.image) {
            const img = document.createElement('img')
            img.src = data.image
            img.style.maxWidth = '300px'
            img.style.display = 'block'
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
            showUploadError('image too big (max is 10mb)')
            fileInput.value = ''
            return
        }

        showUploadStatus('uploading...')
        const imageUrl = await uploadImage(file)
        showUploadStatus('uploaded!', 'pink')
        setTimeout(hideUploadStatus, 3000)

            socket.emit('message', {
                username,
                text: textInput.value || null,
                image: imageUrl
            })
            textInput.value = ""
            fileInput.value = ""
            document.querySelector('#attach-btn').style.borderColor = ''
            document.querySelector('#attach-btn').style.color = ''
 } else {
        socket.emit('message', {
            username,
            text: textInput.value,
            image: null
        })
        textInput.value = ""
    }
    textInput.focus()
}

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

/*
socket.on('usercount', (count) => {
    document.querySelector(`#usercount`).textContent = `${count} users online`
})
    */

document.querySelector('#message-form').addEventListener('submit', sendMessageNew)

// more activity stuff
document.addEventListener('click', activitya)
document.addEventListener('keydown', activitya)
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) activitya()
})
socket.on("message", (data) => {
    const li = document.createElement('li')
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const name = data.username
    const namespan = document.createElement('span')
        namespan.style.color = getNameColor(name)
        if (data.isToken) {
        const tag = document.createElement('span')
        tag.textContent = '♛ '
        tag.style.color = 'hotpink'
        namespan.appendChild(tag)
        }
    namespan.appendChild(document.createTextNode(`[${time}] ${name}: `))
    li.appendChild(namespan)
    if (data.text) {
        li.appendChild(functioninglinks(data.text, getNameColor(name)))
    }
    if (data.image) {
        const img = document.createElement('img')
        img.src = data.image
        img.style.maxWidth = '300px'
        img.style.display = 'block'
        li.appendChild(img)
    }

    appendMessage(li)
    if (document.hidden) {
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
// user renamed message
socket.on('userRenamed', ({from, to}) => {
    systemMessage(`${from} changed their username to ${to}`)
})

// cdn/image stuff
async function uploadImage(file) {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch('https://chat.emmameowss.gay/upload', {
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
function showUploadError(msg) {
    const e = document.querySelector('#upload-error')
    e.textContent = msg
    e.style.display = 'block'
    setTimeout(() => {
        e.style.display = 'none'
        e.textContent = ''
    }, 3000)
}

// upload status stuff
function showUploadStatus(msg, color = 'gray') {
    const e = document.querySelector('#upload-status')
    e.textContent = msg
    e.style.display = 'block'
    e.style.color = color || 'gray'
}

function hideUploadStatus() {
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
// an iq too high?
// join/leave messages/system messages
function systemMessage(text) {
    console.log(text)
    const li = document.createElement('li')
    li.textContent = text
    li.style.color = 'gray'
    li.style.fontStyle = 'italic'
    appendMessage(li)
}

// nuke session and reload if unauthenticated
socket.on('connect_error', (err) => {
    localStorage.removeItem('session')
    location.reload()
})

// user list client side stuff
socket.on('userlist', (users) => {
    const ul = document.querySelector('#userlist')
    ul.innerHTML = '<strong>online</strong><br>'
    users.forEach(u => {
        const span = document.createElement('div')
        span.textContent = u.username
        span.style.color = getNameColor(u.username)
        ul.appendChild(span)
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

}