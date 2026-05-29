
// THIS CODE WORKS DONT TOUCH IT IF YOU DONT NEED TO PLEASE

import {Server} from "socket.io"
import {createServer} from "http"
import { readFileSync } from 'fs'

const httpServer = createServer()
const io = new Server(httpServer, {
    cors: {
        origin: ["https://chat.emmameowss.gay", "http://localhost:3000", "http://127.0.0.1:5500", "https://domainnotverified.emmameowss.gay"] 
    },
    maxHttpBufferSize: 1e8
})

io.on('connection', socket => {

    console.log(`User ${socket.id} connected successfully!`)

    socket.on('message', data => {
        console.log(data)
        io.emit("message", `${data.userId.slice(0,5)}: ${data.text}`)
    })
    socket.on('image', (payload) => {
        io.emit('image', payload)
        console.log('4. image received on client:', payload)
    })
})


httpServer.listen(3000, () => console.log("Server listening on port 3000"))