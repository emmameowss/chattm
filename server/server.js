
// THIS CODE WORKS DONT TOUCH IT IF YOU DONT NEED TO PLEASE
import 'dotenv/config'
import {Server} from "socket.io"
import {createServer} from "http"
import formidable from 'formidable'
import fetch from 'node-fetch'
import { readFileSync, promises as fs } from 'fs'
import { randomBytes } from 'crypto'
import { readFile } from 'fs/promises'
import { extname } from 'path'

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
const sessions = {}
const types = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon'
}

io.use((socket,next) => {
    console.log('socket auth:', socket.handshake.auth)
    const sessionId = socket.handshake.auth.session
    console.log('sessionId:', sessionId)
    console.log('sessions:', sessions)
    const user = sessions[sessionId]
    if (!user) return next(new Error('not authenticated'))
    socket.userEmail = user.email 
    socket.username = null // this gets set later
    next()
})

io.on('connection', socket => {

    console.log(`${socket.userEmail} connected`)
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

// cdn upload stuff and hca login stuff
httpServer.on('request', async (req,res) => {
    console.log(req.method, req.url)

    const url = new URL(req.url, 'http://localhost:3000')
    if (url.pathname.includes('socket.io')) return
    if (url.pathname === '/login') {
        const authUrl = `https://auth.hackclub.com/oauth/authorize?client_id=${process.env.HCA_CLIENT_ID}&redirect_uri=${process.env.HCA_REDIRECT_URI}&response_type=code&scope=profile+email+name`
        res.writeHead(302, {location: authUrl})
        res.end()
        return
    }
    if (url.pathname === '/callback') {
        const code = url.searchParams.get('code')
        console.log('code:', code)

        const tokenres = await fetch('https://auth.hackclub.com/oauth/token', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                client_id: process.env.HCA_CLIENT_ID,
                client_secret: process.env.HCA_CLIENT_SECRET,
                redirect_uri: process.env.HCA_REDIRECT_URI,
                code,
                grant_type: 'authorization_code'
            })
        })
        const tokenJson = await tokenres.json()

        const { access_token } = tokenJson
        const userres = await fetch('https://auth.hackclub.com/api/v1/me', {
            headers: { Authorization: `Bearer ${access_token}` }
        })
        const user = await userres.json()
        const {primary_email} = user.identity
        const sessionid = randomBytes(32).toString('hex')
        sessions[sessionid] = { email: primary_email }
        const redirectUrl = `http://localhost:3000#session=${sessionid}` // live server hates me
        console.log('redirecting to:', redirectUrl)
        res.writeHead(302, { Location: redirectUrl })
        res.end()
        return
}
if (req.method === 'GET') {
    let filePath = url.pathname === '/' ? '/index.html' : url.pathname
    try {
        const data = await readFile(`../app${filePath}`)
        const ext = extname(filePath)
        res.writeHead(200, { 'content-type': types[ext] || 'text/plain' })
        res.end(data)
    } catch (e) {
        if (!res.headersSent) {
            res.writeHead(404)
            res.end('not found')
        }
    }
    return
}
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