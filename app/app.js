

// persistent userid generation stuff
let userId = localStorage.getItem("userId")
if (!userId || userId == null) {
    userId = crypto.randomUUID()
    localStorage.setItem("userId", userId)
}


// set this to the ip/url of the site/proxy you're using for the backend server thing
// const socket = io('wss://domainnotverified.emmameowss.gay') // note for emma - DONT TOUCH THIS EVER AGAIN I SWEAR
// for dev reasons:
const socket = io('ws://localhost:3000')
const resetId = document.querySelector("#resetid")

function sendMessage(e) {
    e.preventDefault()
    const textinput = document.querySelector('input[type="text"]')
    const fileinput = document.querySelector('input[type="file"]')
    // actual image stuff
    if (fileinput.files[0]) {
        const file = fileinput.files[0]
        console.log("got file", file.name, file.size)
        const reader = new FileReader()
        reader.onload = () => {
            console.log("read file")
            socket.emit('image', {userId, data: reader.result})
            console.log("emitted")
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

socket.on('connect', () =>{
    document.querySelector('p').textContent = `user id: ${userId.slice(0,5)}`
})

document.querySelector('form')
.addEventListener('submit', sendMessage)
resetId.addEventListener("click", () => {
    let reset = prompt("Please type RESET to confirm resetting your User ID.")
    if (reset === null) {
        return
    } else if (reset === "RESET") {
        userId = crypto.randomUUID()
        localStorage.setItem("userId", userId)
        document.querySelector('p').textContent = `user id: ${userId.slice(0,5)}`
    } else if (reset === "") {
        return
    }
})


socket.on("message", (data) => {
    const li = document.createElement('li')
    li.textContent = data
    document.querySelector('ul').appendChild(li)
})

// more image sending stuff
socket.on('image', (payload) => {
    const img = document.createElement('img')
    img.src = payload.data
    document.querySelector('ul').appendChild(img)
})