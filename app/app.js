// persistent userid generation stuff
let userId = localStorage.getItem("userId")
if (!userId || userId == null) {
    userId = crypto.randomUUID()
    localStorage.setItem("userId", userId)
}

const socket = io('ws://localhost:3000')

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

socket.on("message", (data) => {
    const li = document.createElement('li')
    li.textContent = data
    document.querySelector('ul').appendChild(li)
})