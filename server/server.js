
// THIS CODE WORKS DONT TOUCH IT IF YOU DONT NEED TO PLEASE

import {Server} from "socket.io"
import {createServer} from "http"

const httpServer = createServer()
const io = new Server(httpServer, {
    cors: {
        origin: process.env.NODE_ENV === "production" ? false : 
        ["http://localhost:5500", "http://127.0.0.1:5500"]
    }
})

io.on('connection', socket => {

    console.log(`User ${socket.id} connected successfully!`)

    socket.on('message', data => {
        console.log(data)
        io.emit("message", `${socket.id.substring(0,5)}: ${data}`)
    })
})

httpServer.listen(3000, () => console.log("Server listening on port 3000"))