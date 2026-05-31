
// THIS CODE WORKS DONT TOUCH IT IF YOU DONT NEED TO PLEASE

import {Server} from "socket.io"
import {createServer} from "http"
import formidable from 'formidable'
import fetch from 'node-fetch'
import { readFileSync, promises as fs } from 'fs'
import { readFile } from 'fs/promises'
import 'dotenv/config'

const httpServer = createServer()
const io = new Server(httpServer, {
    cors: {
        origin: ["https://chat.emmameowss.gay", "http://localhost:3000", "http://127.0.0.1:5500", "https://domainnotverified.emmameowss.gay"] 
    },
    maxHttpBufferSize: 1e6
})
const history = []
const maxhistory = 25
const CDN_API_KEY = process.env.CDN_API_KEY

io.on('connection', socket => {
    io.emit('usercount', io.engine.clientsCount)
    socket.emit('history', history)

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
        /*
        console.log(data)
        io.emit('message', {
            ...data,
            isToken: socket.isToken
        })
        */
       const message = {
        ...data,
        isToken: socket.isToken
       }
       history.push(message)
       if (history.length > maxhistory) {
        history.shift()
       }
       io.emit('message', message)
    }

    )
})

// cdn upload stuff
httpServer.on('request', async (req,res) => {
    if (req.url !== '/upload') return
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
    }

    if (req.method === 'POST' && req.url === '/upload') {
        const form = formidable({ maxFileSize: 10 * 1024 * 1024 }) // 10mb max file size i dont want my account full of whateverthehell
        form.parse(req, async (err, fields, files) => {
            if (err) {
                res.writeHead(500)
                res.end(JSON.stringify({ error: err.message }))
                return
            }

            try {
                const file = files.file[0]
                const fileBuffer = await readFile(file.filepath)
                const blob = new Blob([fileBuffer])
                const formData = new FormData()
                formData.append('file', blob, file.originalFilename)

                const response = await fetch('https://cdn.hackclub.com/api/v4/upload', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${CDN_API_KEY}` },
                    body: formData
                })
                const json = await response.json()
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ url: json.url }))
            } catch (e) {
                res.writeHead(500)
                res.end(JSON.stringify({ error: e.message }))
            }
        })
    }
})

httpServer.listen(3000, () => console.log("Server listening on port 3000"))