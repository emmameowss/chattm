// THIS CODE WORKS DONT TOUCH IT IF YOU DONT NEED TO PLEASE
import 'dotenv/config'
import { Server } from "socket.io"
import { createServer } from "http"
import formidable from 'formidable'
import fetch from 'node-fetch'
import { randomBytes } from 'crypto'
import { readFile, appendFile, writeFile } from 'fs/promises'
import { extname, normalize, resolve, sep } from 'path'

const httpServer = createServer()
const io = new Server(httpServer, {
    cors: {
        origin: ["https://chat.emmameowss.gay", "http://localhost:3000", "http://127.0.0.1:5500"]
    },
    maxHttpBufferSize: 1e6
})

const history = []
const maxhistory = 25
const CDN_API_KEY = process.env.CDN_API_KEY

let sessions = {}
let chatMuted = false
try {
    const data = await readFile('sessions.json', 'utf8')
    sessions = JSON.parse(data)
} catch (e) {}

const types = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon'
}

const banlist = new Set()
try {
    const data = await readFile('bans.txt', 'utf8')
    data.split('\n').filter(Boolean).forEach(email => banlist.add(email))
    console.log(`loaded ${banlist.size} bans`)
} catch (e) {}

async function saveBans() {
    await writeFile('bans.txt', [...banlist].join('\n'))
}

async function saveSession(id, data) {
    sessions[id] = data
    await writeFile('sessions.json', JSON.stringify(sessions))
}


function emitUserList() {
    const users = []
    for (const [id, s] of io.sockets.sockets) {
        if (s.username) users.push({ username: s.username, email: s.userEmail })
    }
    io.emit('userlist', users)
}

io.use((socket, next) => {
    const sessionId = socket.handshake.auth.session
    const user = sessions[sessionId]
    if (!user) return next(new Error('not authenticated'))
    if (banlist.has(user.email)) return next(new Error('banned'))
    
    // guest expiry stuff
    if (user.guest) {
        const today = new Date().toISOString().slice(0,10)
        if (user.expires !== today) {
            delete sessions[sessionId]
            writeFile('sessions.json', JSON.stringify(sessions))
            return next(new Error('not authenticated'))
        }
    }
    socket.userEmail = user.email
    socket.username = null
    next()
})

io.on('connection', socket => {
    console.log(`${socket.userEmail} connected`)
    io.emit('usercount', io.engine.clientsCount)
    socket.emit('history', history)
    socket.emit('init', { 
        isOwner: socket.userEmail === process.env.OWNER_EMAIL,
        chatMuted
    })


    if (chatMuted) {
        const ann = 'chat is currently muted'
        socket.emit('chatmuted', ann)
    }

    if (socket.userEmail.endsWith('@guest')) {
        const guestUsername = socket.userEmail.replace('@guest', '')
        socket.username = guestUsername
        socket.emit('guestUsername', guestUsername)
        emitUserList()
    }

    socket.on('setUsername', (name, guest) => {
        const prevUser = socket.username
        socket.username = name
        const isGuest = socket.userEmail.endsWith('@guest')
        if (prevUser && prevUser !== name && !isGuest) {
            socket.broadcast.emit('userRenamed', { from: prevUser, to: name }, guest)
        }
        emitUserList()
    })

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

    socket.on('disconnect', () => {
        io.emit('usercount', io.engine.clientsCount)
        if (socket.username) io.emit('userLeft', socket.username)
        emitUserList()
    })

    socket.on('message', async (data) => {

        if (chatMuted && socket.userEmail !== process.env.OWNER_EMAIL) {
            socket.emit('commandError', "chat is currently muted") // disabled input should prevent messages, this is in case it fails
            return
        }

        if (data.text?.startsWith('/') && socket.userEmail !== process.env.OWNER_EMAIL) {
            socket.emit('commandError', "you don't have permission to use commands")
            return
        }
        // /ban command
        if (data.text?.startsWith('/ban ') && socket.userEmail === process.env.OWNER_EMAIL) {
            const targetEmail = data.text.slice(5).trim()
            banlist.add(targetEmail)
            await saveBans()
            await appendFile('bans.log', `${new Date().toISOString()}: ${socket.userEmail} (${data.username}) banned ${targetEmail}\n`)
            let targetUsername = targetEmail
            for (const [id, s] of io.sockets.sockets) {
                if (s.userEmail === targetEmail) {
                    targetUsername = s.username || targetEmail
                    s.emit('banned')
                    s.disconnect()
                }
            }
            return
        }

        if (data.text?.startsWith('/unban ') && socket.userEmail === process.env.OWNER_EMAIL) {
            const targetEmail = data.text.slice(7).trim()
            banlist.delete(targetEmail)
            await saveBans()
            return
        }
        if (data.text?.startsWith('/clear') && socket.userEmail === process.env.OWNER_EMAIL) {
            history.length = 0
            io.emit('clear')
            return
        }

        if (data.text?.startsWith('/announce ') && socket.userEmail === process.env.OWNER_EMAIL) {
            const ann = data.text.slice(10).trim()
            io.emit('announcement', ann)
            return
        }
        if (data.text?.startsWith('/mutechat') && socket.userEmail === process.env.OWNER_EMAIL) {
            const ann = "chat has been muted"
            chatMuted = true
            io.emit('mutechat', ann)
            return
        }
        if (data.text?.startsWith('/unmutechat') && socket.userEmail === process.env.OWNER_EMAIL) {
            const ann = "chat has been unmuted"
            chatMuted = false
            io.emit('unmutechat', ann)
            return
        }
        const timestamp = new Date().toISOString()
        await appendFile('messages.log', `${timestamp}: ${socket.userEmail} (${data.username}): ${data.text || '[image]'}\n`)
        const message = {
            ...data,
            time: Date.now(),
            isToken: socket.userEmail === process.env.OWNER_EMAIL
        }
        history.push(message)
        if (history.length > maxhistory) history.shift()
        io.emit('message', message)
    })
})

httpServer.on('request', async (req, res) => {
    if (req.url.includes('socket.io')) return

    const url = new URL(req.url, 'https://chat.emmameowss.gay')

    if (url.pathname === '/login') {
        const authUrl = `https://auth.hackclub.com/oauth/authorize?client_id=${process.env.HCA_CLIENT_ID}&redirect_uri=${process.env.HCA_REDIRECT_URI}&response_type=code&scope=profile+email+name`
        res.writeHead(302, { location: authUrl })
        res.end()
        return
    }

    if (url.pathname === '/callback') {
        const code = url.searchParams.get('code')
        const tokenRes = await fetch('https://auth.hackclub.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: process.env.HCA_CLIENT_ID,
                client_secret: process.env.HCA_CLIENT_SECRET,
                redirect_uri: process.env.HCA_REDIRECT_URI,
                code,
                grant_type: 'authorization_code'
            })
        })
        const tokenJson = await tokenRes.json()
        const { access_token } = tokenJson
        const userRes = await fetch('https://auth.hackclub.com/api/v1/me', {
            headers: { Authorization: `Bearer ${access_token}` }
        })
        const user = await userRes.json()
        const { primary_email } = user.identity
        await appendFile('login.log', `${new Date().toISOString()}: ${primary_email} signed in\n`)
        const sessionid = randomBytes(32).toString('hex')
        await saveSession(sessionid, { email: primary_email })
        const redirectUrl = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}/#session=${sessionid}`
        res.writeHead(302, { Location: redirectUrl })
        res.end()
        return
    }

    if (url.pathname === '/signout') {
        const sessionId = url.searchParams.get('session')
        if (sessionId) {
            delete sessions[sessionId]
            await writeFile('sessions.json', JSON.stringify(sessions))
        }
        res.writeHead(302, { Location: '/' })
        res.end()
        return
    }

    if (url.pathname === '/upload' && req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
        res.writeHead(204)
        res.end()
        return
    }

    if (url.pathname === '/upload' && req.method === 'POST') {
        res.setHeader('Access-Control-Allow-Origin', '*')
        const form = formidable({ maxFileSize: 10 * 1024 * 1024 })
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
        return
    }

    if (url.pathname === '/guest') {
        const guestId = randomBytes(3).toString('hex')
        const today = new Date().toISOString().slice(0,10)
        const sessionid = randomBytes(32).toString('hex')
        const guestUsername = `guest-${guestId}`
        await saveSession(sessionid, {
            email: `guest-${guestId}@guest`,
            guest: true,
            expires: today
        })
        const redirectUrl = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}/#session=${sessionid}`
        res.writeHead(302, {Location: redirectUrl})
        res.end()
        return
    }

    if (req.method === 'GET') {
        let filePath = url.pathname === '/' ? '/index.html' : url.pathname
        try {
            const appDir = resolve(process.cwd(), '../app')
            const resolvedPath = resolve(appDir, `.${normalize(filePath)}`)
            if (resolvedPath !== appDir && !resolvedPath.startsWith(`${appDir}${sep}`)) {
                res.writeHead(403)
                res.end('forbidden')
                return
            }
            const data = await readFile(resolvedPath)
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
})

httpServer.listen(3000, () => console.log("Server listening on port 3000"))