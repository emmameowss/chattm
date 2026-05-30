


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

// set this to the ip/url of the site/proxy you're using for the backend server thing
const socket = io('wss://domainnotverified.emmameowss.gay') // note for emma - DONT TOUCH THIS EVER AGAIN I SWEAR
// for dev reasons:
// const socket = io('ws://localhost:3000')
const resetId = document.querySelector("#resetid")
const maxmessages = 25

// move socket joined/left stuff after intialiing socket
socket.on('userJoined', (name) => { 
    systemMessage(`${name} joined`)
})
socket.on('userLeft', (name) =>  {
    systemMessage(`${name} left`)
})
/* old stuff
function sendMessage(e) {
    e.preventDefault()
    const textinput = document.querySelector('input[type="text"]')
    const fileinput = document.querySelector('input[type="file"]')
    // actual image stuff
    if (fileinput.files[0]) {
        const file = fileinput.files[0]
        const reader = new FileReader()
        reader.onload = () => {
            socket.emit('image', {userId, data: reader.result})
            fileinput.value = ""
        }
        reader.onerror = () => console.log('reader error:', reader.error)
        reader.readAsDataURL(file)
    }
    // text stuff
    if (textinput.value) {  
        socket.emit("message", {
            userId,
            text: textinput.value
        })
        textinput.value = ""
    }
    textinput.focus()
}
*/
function sendMessageNew(e) {
    e.preventDefault()
    const textInput = document.querySelector('#message-input')
    const fileInput = document.querySelector('#file-input')

    const file = fileInput.files[0]

    if (!textInput.value && !file) return

    if (file) {
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
    // this is useless but still keeping it   document.querySelector(`#userid`).textContent = `user id: ${userId.slice(0,5)} (basically useless now)`
})


socket.on('usercount', (count) => {
    document.querySelector(`#usercount`).textContent = `${count} users online`
})

document.querySelector('#message-form').addEventListener('submit', sendMessageNew)
// this is also mostly useless probably but id rather nto touch it for now
/*
resetId.addEventListener("click", () => {
    let reset = prompt("Please type RESET to confirm resetting your User ID.")
    if (reset === null) {
        return
    } else if (reset === "RESET") {
        userId = crypto.randomUUID()
        localStorage.setItem("userId", userId)
        document.querySelector('p').textContent = `user id: ${userId.slice(0,5)} (basically useless now)`
    } else if (reset === "") {
        return
    }
})
*/

// more activity stuff
document.addEventListener('click', activitya)
document.addEventListener('keydown', activitya)
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) activitya()
})
socket.on("message", (data) => {
    const li = document.createElement('li')
    const name = data.username
    const namespan = document.createElement('span')
        namespan.style.color = getNameColor(name)
        if (data.isToken) {
        const tag = document.createElement('span')
        tag.textContent = '♛ '
        tag.style.color = 'hotpink'
        namespan.appendChild(tag)
        }
    namespan.appendChild(document.createTextNode(`[${data.time}] ${name}: `))
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
/* old stuff
socket.on("message", (data) => {
    const li = document.createElement('li')
    li.textContent = `[${data.time}] ${data.userId.slice(0,5)}: ${data.text}`
    appendMessage(li)
})

// more image sending stuff
socket.on('image', (payload) => {
    const li = document.createElement('li')
    const img = document.createElement('img')
    img.src = payload.data
    img.style.maxWidth = '300px'
    img.style.display = 'block'
    li.textContent = `${payload.userId.slice(0,5)}: `
    li.appendChild(img)
    appendMessage(li)
    li.scrollIntoView({behavior: 'smooth'})
}) */