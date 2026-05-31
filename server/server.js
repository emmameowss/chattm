
// THIS CODE WORKS DONT TOUCH IT IF YOU DONT NEED TO PLEASE

import {Server} from "socket.io"
import {createServer} from "http"
import { readFileSync } from 'fs'
import 'dotenv/config'

const httpServer = createServer()
const io = new Server(httpServer, {
    cors: {
        origin: ["https://chat.emmameowss.gay", "http://localhost:3000", "http://127.0.0.1:5500", "https://domainnotverified.emmameowss.gay"] 
    },
    maxHttpBufferSize: 1e8
})

io.on('connection', socket => {
    io.emit('usercount', io.engine.clientsCount)

    socket.on('setUsername', (name, token) => {
        const prevUser = socket.username
        socket.username = name
        socket.isToken = token === process.env.TOKEN
        if (prevUser && prevUser !== name) {
            socket.broadcast.emit('userRenamed', {from: prevUser, to: name})
        }
    })

    // serverside typing indicator stuff
    socket.on('typing', () => {
        socket.broadcast.emit('typing', socket.username)
    })

    socket.on('stopTyping', () => {
        socket.broadcast.emit('stopTyping', socket.username)
    })

    socket.on('userActive', () => {
        if (socket.username && !socket.hasJoined) {
            socket.hasJoined = true
            socket.broadcast.emit('userJoined', socket.username)
        }
    })

    console.log(`User ${socket.id} connected successfully!`)
    socket.on('disconnect', () => {
        io.emit('usercount', io.engine.clientsCount)
        if (socket.username) {
            io.emit('userLeft', socket.username)
        }
    })

    socket.on('message', (data) => {
        console.log(data)
        io.emit('message', {
            ...data,
            isToken: socket.isToken
        })
    }

    )
})


httpServer.listen(3000, () => console.log("Server listening on port 3000"))