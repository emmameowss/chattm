// THIS CODE WORKS DONT TOUCH IT IF YOU DONT NEED TO PLEASE
import 'dotenv/config'
import { Server } from "socket.io"
import { createServer } from "http"
import formidable from 'formidable'
import fetch from 'node-fetch'
import { randomBytes } from 'crypto'
import { readFile, appendFile, writeFile } from 'fs/promises'
import { extname, normalize, resolve, sep } from 'path'
import { execSync } from 'child_process'

const httpServer = createServer()
const io = new Server(httpServer, {
    cors: {
        origin: ["https://chat.emmameowss.gay", "http://localhost:3000"]
    },
    maxHttpBufferSize: 1e6
})

const history = []
const maxhistory = 20
const msgcooldown = 1000
const lastmessage = {}
const CDN_API_KEY = process.env.CDN_API_KEY
const userColors = {}
try {
    const data = await readFile('colors.json', 'utf-8')
    Object.assign(userColors, JSON.parse(data))
} catch (e) {}

async function saveColors() {
    await writeFile('colors.json', JSON.stringify(userColors))
}

const ownercmds = ['/ban', '/unban', '/mute', '/unmute', '/resetstrikes', '/clear', '/announce', '/mutechat', '/unmutechat', '/maintenance', '/unbanip', '/whois']

let sessions = {}
let chatMuted = false
let status = ''
try {
    const data = await readFile('sessions.json', 'utf8')
    sessions = JSON.parse(data)
} catch (e) {}
let maintenance = false
let reason = ''
try {
    const data = await readFile('maintenance.json', 'utf8')
    const saved = JSON.parse(data)
    maintenance = saved.maintenance || false
    reason = saved.reason || ''
} catch (e) {}
const PORT = process.env.PORT || 3000
let versionCache = null
let versionCacheTime = 0


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

const ipbanlist = new Set()
try { 
    const data = await readFile('ipbans.txt', 'utf8')
    data.split('\n').filter(Boolean).forEach(ip => ipbanlist.add(ip))
    console.log(`loaded ${ipbanlist.size} ip bans`)
} catch (e) {}

const banReasons = {}
try {
    const data = await readFile('banreasons.json', 'utf-8')
    Object.assign(banReasons, JSON.parse(data))
} catch (e) {}

const muted = {}
try {
    const data = await readFile('mutes.json', 'utf8')
    Object.assign(muted, JSON.parse(data))
} catch (e) {}

const filteredwords = []
async function loadFilterWords() {
    try {
        const data = await readFile('filter.txt', 'utf8')
        filteredwords.length = 0
        data.split('\n').map(w => w.trim().toLowerCase()).filter(Boolean).forEach(w => filteredwords.push(w))
        console.log(`loaded ${filteredwords.length} filter words`)
    } catch (e) {
        console.log('no filter.txt found, filter disabled')
    }
}
await loadFilterWords()
function containsFilteredWord(text) {
    if (!text) return null
    const lower = text.toLowerCase()
    return filteredwords.find(w => lower.includes(w)) || null
}

const strikes = {}
try {
    const data = await readFile('strikes.json', 'utf8')
    Object.assign(strikes, JSON.parse(data))
} catch (e) {}

async function saveStrikes() {
    await writeFile('strikes.json', JSON.stringify(strikes))
}

async function saveMutes() {
    await writeFile('mutes.json', JSON.stringify(muted))
}

async function saveBanReasons() {
    await writeFile('banreasons.json', JSON.stringify(banReasons))
}

async function saveIpBans() {
    await writeFile('ipbans.txt', [...ipbanlist].join('\n'))
}

async function saveBans() {
    await writeFile('bans.txt', [...banlist].join('\n'))
}

async function saveSession(id, data) {
    sessions[id] = data
    await writeFile('sessions.json', JSON.stringify(sessions))
}

async function saveMaintenance() {
    await writeFile('maintenance.json', JSON.stringify({maintenance, reason}))
}

async function getVersionStatus() {
    if (versionCache && Date.now() - versionCacheTime < 10 * 60 * 1000) {
        return versionCache
    }
    let result
    try {
        const localCommit = execSync('git rev-parse HEAD', { cwd: '..' }).toString().trim()
        const localCommitDate = execSync('git show -s --format=%cI HEAD', { cwd: '..' }).toString().trim()
        const res = await fetch('https://api.github.com/repos/emmameowss/chattm/commits?per_page=50')
        const commits = await res.json()
        const localIndex = commits.findIndex(c => c.sha === localCommit)
        const currentCommit = localCommit.slice(0,7)

        if (localIndex === -1) {
            const latestRemoteDate = commits[0]?.commit?.committer?.date
            if (latestRemoteDate && new Date(localCommitDate) > new Date(latestRemoteDate)) {
                let ahead = 0
                try {
                    ahead = parseInt(execSync(`git rev-list --count origin/main..HEAD`, { cwd: '..' }).toString().trim())
                } catch (e) {
                    ahead = '1+'
                }
                result = { upToDate: false, ahead, latestCommit: commits[0]?.sha?.slice(0,7), currentCommit }
            } else {
                result = { upToDate: false, behind: '50+', latestCommit: commits[0]?.sha?.slice(0,7), currentCommit }
            }
        } else {
            result = { upToDate: localIndex === 0, behind: localIndex, latestCommit: commits[0]?.sha?.slice(0,7), currentCommit }
        }
    } catch (e) {
        result = { upToDate: null, behind: null, error: e.message }
    }
    versionCache = result
    versionCacheTime = Date.now()
    return result
}

// mutes
function isMuted(email) {
    const m = muted[email]
    if (!m) return false
    if (m.until && Date.now() > m.until) {
        delete muted[email]
        saveMutes()
        return false
    }
    return true
}

function parseDuration(str) {
    const match = str.match(/^(\d+)(s|m|h|d)$/)
    if (!match) return null
    const num = parseInt(match[1])
    const unit = {s: 1000, m: 60000, h: 3600000, d: 86400000}[match[2]]
    return num * unit
}

setInterval(async () => {
    const now = Date.now()
    let changed = false
    for (const email of Object.keys(muted)) {
        const m = muted[email]
        if (m.until && now > m.until) {
            delete muted[email]
            changed = true
            for (const [id, s] of io.sockets.sockets) {
                if (s.userEmail === email) {
                    s.emit('unmuted')
                }
            }
        }
    }
    if (changed) await saveMutes()
}, 10 * 1000)


function emitUserList() {
    const users = []
    for (const [id, s] of io.sockets.sockets) {
        if (s.username) users.push({ 
            username: s.username, 
            email: s.userEmail,
            color: userColors[s.userEmail] || null,
            guest: s.userEmail.endsWith('@guest'),
            isOwner: s.userEmail === process.env.OWNER_EMAIL
        })
    }
    io.emit('userlist', users)
}

io.use((socket, next) => {
    const sessionId = socket.handshake.auth.session
    const user = sessions[sessionId]
    if (!user) return next(new Error('not authenticated'))
    if (banlist.has(user.email)) {
        return next(new Error('banned'))
        err.data = { reason: banReasons[user.email] || 'no reason given' }
    }
    const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() || socket.handshake.address
    // if (ipbanlist.has(ip)) return next(new Error('banned'))
    
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
    if (maintenance && socket.userEmail !== process.env.OWNER_EMAIL) {
        return next(new Error('maintenance'))
    }
    next()
})

io.on('connection', socket => {
    socket.userIP = socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() || socket.handshake.address
    let lastMessage = 0
    console.log(`${socket.userEmail} connected`)
    io.emit('usercount', io.engine.clientsCount)
    socket.emit('history', history)
    socket.emit('init', { 
        isOwner: socket.userEmail === process.env.OWNER_EMAIL,
        chatMuted,
        uMuted: isMuted(socket.userEmail) ? muted[socket.userEmail] : null
    })
    if (status) socket.emit('status', status)


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
        if (prevUser && prevUser !== name) {
            socket.broadcast.emit('userRenamedSys', {from: prevUser, to: name}, guest)
            socket.emit('userRenamed', { from: prevUser, to: name })
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

        // check if muted
        if (isMuted(socket.userEmail) && socket.userEmail !== process.env.OWNER_EMAIL) {
            const m = muted[socket.userEmail]
            socket.emit('commandError', `you are muted${m.until ? ' until ' + new Date(m.until).toLocaleString() : ''} - reason: ${m.reason}`)
            return
        }

        // filter
        if (socket.userEmail !== process.env.OWNER_EMAIL) {
            const hit = containsFilteredWord(data.text)
            if (hit) {
                strikes[socket.userEmail] = (strikes[socket.userEmail] || 0 ) + 1
                await saveStrikes()

                if (strikes[socket.userEmail] > 5) {
                    const reason = 'banned by server - too many automatic mutes'
                    banlist.add(socket.userEmail)
                    banReasons[socket.userEmail] = reason
                    await saveBans()
                    await saveBanReasons()
                    await appendFile('filter.log', `${new Date().toISOString()}: ${socket.userEmail} (${data.username}) auto-banned, 5th strike triggered by "${hit}" — message: ${data.text}\n`)
                    socket.emit('banned', reason)
                    socket.disconnect()
                    return
                }
                const durationMs = 10 * 60 * 1000
                muted[socket.userEmail] = {
                    until: Date.now() + durationMs,
                    reason: `muted by server: word filter (strike ${strikes[socket.userEmail]}/5)`
                }
                await saveMutes()
                await appendFile('filter.log', `${new Date().toISOString()}: ${socket.userEmail} (${data.username}) muted for 10m, strike ${strikes[socket.userEmail]}/5, triggered by "${hit}" - message: ${data.text}\n`)
                socket.emit('muted', {reason: muted[socket.userEmail].reason, until: muted[socket.userEmail].until})
                return
            }
        }

        const now = Date.now()
        if (lastmessage[socket.userEmail] && now - lastmessage[socket.userEmail] < msgcooldown) {
            socket.emit('commandError', 'slow down')
            return
        }
        lastmessage[socket.userEmail] = now

        if (chatMuted && socket.userEmail !== process.env.OWNER_EMAIL) {
            socket.emit('commandError', "chat is currently muted") // disabled input should prevent messages, this is in case it fails
            return
        }

        if (data.text?.startsWith('/') && socket.userEmail !== process.env.OWNER_EMAIL) {
            if (ownercmds.some(cmd => data.text.startsWith(cmd))) {
                socket.emit('commandError', 'you do not have permission to use commands')
                return
    }
}
        // /ban command
        if (data.text?.startsWith('/ban ') && socket.userEmail === process.env.OWNER_EMAIL) {
            const args = data.text.slice(5).trim()
            const [targetEmail, ...reasonParts] = args.split(' ')
            const reason = reasonParts.join(' ') || 'no reason given'
            banlist.add(targetEmail)
            banReasons[targetEmail] = reason
            await saveBanReasons()
            await saveBans()
            await appendFile('bans.log', `${new Date().toISOString()}: ${socket.userEmail} (${data.username}) banned ${targetEmail} - reason: ${reason}\n`)
            for (const [id, s] of io.sockets.sockets) {
                if (s.userEmail === targetEmail) {
                    // not sure if this is gonna work, commented out for now
                    // ipbanlist.add(s.userIP)
                    // await saveIpBans()
                    // await appendFile('bans.log', `${new Date().toISOString()}: also banned IP ${s.userIP}\n`)
                    s.emit('banned', reason)
                    socket.emit('commandError', `banned ${targetEmail}`)
                    s.disconnect()
                }
            }
            return
        }

        if (data.text?.startsWith('/unban ') && socket.userEmail === process.env.OWNER_EMAIL) {
            const targetEmail = data.text.slice(7).trim()
            banlist.delete(targetEmail)
            await saveBans()
            socket.emit('commandError', `unbanned ${targetEmail}, use /unbanip for IP`)
            return
        }
        if (data.text?.startsWith('/unbanip ') && socket.userEmail === process.env.OWNER_EMAIL) {
            const targetIP = data.text.slice(9).trim()
            ipbanlist.delete(targetIP)
            await saveIpBans()
            socket.emit('commandError', `unbanned ${targetIP}`)
            return
        }
        if (data.text?.startsWith('/mute ') && socket.userEmail === process.env.OWNER_EMAIL) {
            const args = data.text.slice(6).trim().split(' ')
            const targetUsername = args[0]
            const durationStr = args[1]
            const reason = args.slice(2).join(' ') || 'no reason given'

            let targetEmail = null
            for (const [id,s] of io.sockets.sockets) {
                if (s.username === targetUsername) {
                    targetEmail = s.userEmail
                    break
                }
            }
            if (!targetEmail) {
                socket.emit('commandError', `no user found with username ${targetUsername}`)
                return
            }
            const durationMs = durationStr ? parseDuration(durationStr) : null
            if (durationStr && !durationMs) {
                socket.emit('commandError', 'invalid duration format')
                return
            }
            muted[targetEmail] = {
                until: durationMs ? Date.now() + durationMs : null,
                reason
            }
            await saveMutes()
            await appendFile('mutes.log', `${new Date().toISOString()}: ${socket.userEmail}`)

            for (const [id,s] of io.sockets.sockets) {
                if (s.userEmail === targetEmail) {
                    s.emit('muted', {reason, until: muted[targetEmail].until})
                }
            }
            // i don't understand why this function/call is still called commandError, it's not used for just errors anymor
            socket.emit('commandError', `muted ${targetUsername}${durationStr ? ' for ' + durationStr : ''}`)
            return
        }
        if (data.text?.startsWith('/unmute ') && socket.userEmail === process.env.OWNER_EMAIL) {
            const targetUsername = data.text.slice(8).trim()
            let targetEmail = null
            for (const [id,s] of io.sockets.sockets) {
                if (s.username === targetUsername) {
                    targetEmail = s.userEmail
                    break
                }
            }
            if (!targetEmail || !muted[targetEmail]) {
                socket.emit('commandError', `${targetUsername} is not muted`)
                return
            }
            delete muted[targetEmail]
            await saveMutes()
            for (const [id,s] of io.sockets.sockets) {
                if (s.userEmail === targetEmail) {
                    s.emit('unmuted')
                }
            }
            socket.emit('commandError', `unmuted ${targetUsername}`)
            return
        }
        if (data.text?.startsWIth('/resetstrikes ') && socket.userEmail === process.env.OWNER_EMAIL) {
            const targetUsername = data.text.slice(14).trim()
            let targetEmail = null
            for (const [id,s] of io.sockets.sockets) {
                if (s.username === targetUsername) {
                    targetEmail = s.userEmail
                    break
                }
            }
            if (!targetEmail) {
                socket.emit('commandError', `no user found with username ${targetUsername}`)
                return
            }
            delete strikes[targetEmail]
            await saveStrikes()
            socket.emit('commandError', `reset filter strikes for ${targetUsername}`)
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
        if (data.text?.startsWith('/whois ') && socket.userEmail === process.env.OWNER_EMAIL) {
            const targetUsername = data.text.slice(7).trim()
            let found = null
            for (const [id, s] of io.sockets.sockets) {
                if (s.username === targetUsername) {
                found = s
                break
                }
            }
            if (found) {
                socket.emit('commandError', `${targetUsername}: ${found.userEmail}`)
            } else {
                socket.emit('commandError', `no user found with username "${targetUsername}"`)
            }
            return
        }
        if (data.text?.startsWith('/nick ')) {
            const nick = data.text.slice(6).trim()
            const prevUser = socket.username
            socket.username = nick
            const isGuest = socket.userEmail.endsWith('@guest')
            if (prevUser && prevUser !== nick) {
               socket.broadcast.emit('userRenamedSys', {from: prevUser, to: nick}, isGuest)
               socket.emit('userRenamed', { from: prevUser, to: nick })
            }
            emitUserList()
            return
        }
        // maintenance cmd
        if (data.text?.startsWith('/maintenance') && socket.userEmail === process.env.OWNER_EMAIL) {
            maintenance = !maintenance
            reason = maintenance ? data.text.slice(12).trim() : ''
            await saveMaintenance()
            for (const [id,s ] of io.sockets.sockets) {
                if (s.userEmail !== process.env.OWNER_EMAIL) {
                    s.emit('maintenance', maintenance, reason)
                    if (maintenance) s.disconnect()
                }
            }
            socket.emit('commandError', maintenance ? 'maintenance enabled' : 'maintenance disabled')
            return
        } 
        if (data.text?.startsWith('/status ') && socket.userEmail === process.env.OWNER_EMAIL) {
            status = data.text.slice(8).trim()
            socket.emit('status', status)
            return
        }
        if (data.text?.startsWith('/color ')) {
            const colorinput = data.text.slice(7).trim().toLowerCase()
            const flags = {
                'pride':       'flag:pride', 'rainbow': 'flag:pride',
                'trans':       'flag:trans', 'transgender': 'flag:trans',
                'bi':          'flag:bi', 'bisexual': 'flag:bi',
                'lesbian':     'flag:lesbian',
                'nb':          'flag:nb', 'nonbinary': 'flag:nb'
            }
            const color = flags[colorinput] ?? colorinput
            userColors[socket.userEmail] = color
            await saveColors()
            socket.emit('colorChanged', color)
            emitUserList()
            return
        }
        // different syntax
        if (data.text?.startsWith('/colour ')) {
            const colorinput = data.text.slice(7).trim().toLowerCase()
            const flags = {
                'pride':       'flag:pride', 'rainbow': 'flag:pride',
                'trans':       'flag:trans', 'transgender': 'flag:trans',
                'bi':          'flag:bi', 'bisexual': 'flag:bi',
                'lesbian':     'flag:lesbian',
                'nb':          'flag:nb', 'nonbinary': 'flag:nb'
            }
            const color = flags[colorinput] ?? colorinput
            userColors[socket.userEmail] = color
            await saveColors()
            socket.emit('colorChanged', color)
            emitUserList()
            return
        }
        const timestamp = new Date().toISOString()
        await appendFile('messages.log', `${timestamp}: ${socket.userEmail} (${data.username}): ${data.text || '[image]'}\n`)
        const message = {
            ...data,
            username: socket.username,
            time: Date.now(),
            isToken: socket.userEmail === process.env.OWNER_EMAIL,
            isGuest: socket.userEmail.endsWith('@guest'),
            color: userColors[socket.userEmail] || null
        }
        history.push(message)
        if (history.length > maxhistory) history.shift()
        io.emit('message', message)
    })
})

httpServer.on('request', async (req, res) => {
    if (req.url.includes('socket.io')) return

    const url = new URL(req.url, `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`)

    if (url.pathname === '/login') {
        const authUrl = `https://auth.hackclub.com/oauth/authorize?client_id=${process.env.HCA_CLIENT_ID}&redirect_uri=${process.env.HCA_REDIRECT_URI}&response_type=code&scope=email`
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
        if (!user.identity?.primary_email) {
            res.writeHead(302, {Location: '/?error=auth_denied'})
            res.end()
            return
        }
        const { primary_email } = user.identity
        const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress
        await appendFile('login.log', `${new Date().toISOString()}: ${primary_email} signed in from ${ip}\n`)
        const sessionid = randomBytes(32).toString('hex')
        await saveSession(sessionid, { email: primary_email, ip })
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
                const allowedTypes = [
                    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
                    'video/mp4', 'video/quicktime',
                    'audio/mpeg', 'audio/ogg', 'audio/wav',
                    'application/pdf', 'text/plain', 'text/markdown',
                    'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed',
                    'application/x-tar', 'application/gzip',
                    'application/json', 'text/csv',
                    'image/vnd.adobe.photoshop', 'application/figma'
               ]
                if (!allowedTypes.includes(file.mimetype)) {
                    res.writeHead(400)
                    res.end(JSON.stringify({error: "file type not allowed"}))
                    return
                }
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
                const sessionId = fields.session?.[0]
                const userEmail = sessions[sessionId]?.email || 'unknown'
                const uUsername = fields.username?.[0] || 'unknown'
                await appendFile('uploads.log', `${new Date().toISOString()}: ${userEmail} (${uUsername}): ${json.url}\n`)
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
        const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress
        await appendFile('login.log', `${new Date().toISOString()}: guest-${guestId} signed in from ${ip}\n`)
        await saveSession(sessionid, {
            email: `guest-${guestId}@guest`,
            guest: true,
            expires: today,
            ip
        })
        const redirectUrl = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}/#session=${sessionid}`
        res.writeHead(302, {Location: redirectUrl})
        res.end()
        return
    }

    if (url.pathname === '/maintenance') {
        res.writeHead(200, {'content-type': 'application/json'})
        res.end(JSON.stringify({maintenance: maintenance, reason: reason}))
        return
    }

    if (url.pathname === '/config') {
        res.writeHead(200, {"content-type": "application/json"})
        res.end(JSON.stringify({port: PORT}))
        return
    }

    if (url.pathname === '/version') {
        const status = await getVersionStatus()
        res.writeHead(200, {"content-type": "application/json"})
        res.end(JSON.stringify(status))
        return
    }

    if (url.pathname === '/privacy') {
        const content = await readFile('../app/privacy.html') // privacy.html is not included in this repo or project in general as it's mostly ai generated so it's not fair to include it in both this project or time stats
        res.writeHead(200, {"content-type": 'text/html'})
        res.end(content)
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

httpServer.listen(PORT, () => console.log(`Server listening on port ${PORT}`))