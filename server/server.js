
// THIS CODE WORKS DONT TOUCH IT IF YOU DONT NEED TO PLEASE

import {Server} from "socket.io"
import {createServer} from "http"
import { readFileSync } from 'fs'
const config = JSON.parse(readFileSync('./config.json', 'utf-8'));

const httpServer = createServer()
const io = new Server(httpServer, {
    cors: {
        origin: ["https://chat.emmameowss.gay", "http://localhost:3000", "http://127.0.0.1:5500", config.ip] 
    }
})

io.on('connection', socket => {

    console.log(`User ${socket.id} connected successfully!`)

    socket.on('message', data => {
        console.log(data)
        io.emit("message", `${data.userId.slice(0,5)}: ${data.text}`)
    })
})

httpServer.listen(3000, () => console.log("Server listening on port 3000"))