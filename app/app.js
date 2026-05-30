// persistent userid generation stuff
let userId = localStorage.getItem("userId")
if (!userId || userId == null) {
    userId = crypto.randomUUID()
    localStorage.setItem("userId", userId)
}

let unread = 0
let activity = false
let username = localStorage.getItem('username') || userId.slice(0,5)

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

// join/leave messages/system messages
function systemMessage(text) {
    console.log(text)
    const li = document.createElement('li')
    li.textContent = text
    li.style.color = 'gray'
    li.style.fontStyle = 'italic'
    appendMessage(li)
}

// join only appears when active function
function activitya() {
    if (!activity) {
        activity = true
        socket.emit('userActive')
    }
}

// colors
function getNameColor(name) {
    if (name.toLowerCase() === 'emma') return 'hotpink'
    let hash = 0
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash)
    }
    return `hsl(${hash % 360}, 70%, 65%)`
}

// set this (specifically the second one) to the ip/url of the site/proxy you're using for the backend server thing
const socket = io(
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'ws://localhost:3000'
        : 'wss://domainnotverified.emmameowss.gay'
)
const resetId = document.querySelector("#resetid")
const maxmessages = 25

// move socket joined/left stuff after intialiing socket
socket.on('userJoined', (name) => { 
    systemMessage(`${name} joined`)
})
socket.on('userLeft', (name) =>  {
    systemMessage(`${name} left`)
})

function sendMessageNew(e) {
    e.preventDefault()
    const textInput = document.querySelector('#message-input')
    const fileInput = document.querySelector('#file-input')

    const file = fileInput.files[0]

    if (!textInput.value && !file) return

    if (file) {
        if (!file.type.startsWith('image/')) {
            fileInput.value = ''
            if (!textInput.value) return
        } else {
        const reader = new FileReader()
        reader.onload = () => {
            socket.emit('message', {
                username,
                text: textInput.value || null,
                image: reader.result
            })
            textInput.value = ""
            fileInput.value = ""
        }
        reader.readAsDataURL(file)
    }
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
    const token = localStorage.getItem('token')
    socket.emit('setUsername', username, token)
})


socket.on('usercount', (count) => {
    document.querySelector(`#usercount`).textContent = `${count} users online`
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
        li.appendChild(document.createTextNode(data.text))
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