// persistent userid generation stuff
let userId = localStorage.getItem("userId")
if (!userId || userId == null) {
    userId = crypto.randomUUID()
    localStorage.setItem("userId", userId)
}


// set this to the ip/url of the site/proxy you're using for the backend server thing
const socket = io('wss://domainnotverified.emmameowss.gay') // note for emma - DONT TOUCH THIS EVER AGAIN I SWEAR
const resetId = document.querySelector("#resetid")

function sendMessage(e) {
    e.preventDefault()
    const input = document.querySelector('input')
    if (input.value) {  
        socket.emit("message", {
            userId,
            text: input.value
        })
        input.value = ""
    }
    input.focus()
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

// image sending stuff
document.getElementById('file').addEventListener('change', function() {
    const reader = new FileReader()
    reader.onload = function() {
        const base64 = this.result.replace(/.*base64,/, '')
        socket.emit('image', base64)
    }
    reader.readAsDataURL(this.files[0])
}, false)

socket.on("message", (data) => {
    const li = document.createElement('li')
    li.textContent = data
    document.querySelector('ul').appendChild(li)
})
