
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
    io.emit('usercount', io.engine.clientsCount)

    socket.on('setUsername', (name) => {
        socket.username = name
        socket.broadcast.emit('userJoined', name)
    })

    console.log(`User ${socket.id} connected successfully!`)
/*
    socket.on('message', data => {
        console.log(data)
        io.emit('message', {
            ...data,
            time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit'})
        })
    })
    socket.on('image', (payload) => {
        io.emit('image', payload)
    }) */
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
            time: new Date().toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'})
        })
    }
    )
})


httpServer.listen(3000, () => console.log("Server listening on port 3000"))