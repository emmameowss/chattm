const socket = io('ws://localhost:3000')

function sendMessage(e) {
    e.preventDefault()
    const input = document.querySelector('input')
    if (input.value) {
        socket.emit("message", input.value)
        input.value = ""
    }
    input.focus()
}

socket.on('connect', () =>{
    document.querySelector('p').textContent = `user id: ${socket.id} (only the first 5 characters show up in chat right now)`
})

document.querySelector('form')
.addEventListener('submit', sendMessage)

socket.on("message", (data) => {
    const li = document.createElement('li')
    li.textContent = data
    document.querySelector('ul').appendChild(li)
})