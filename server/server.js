// THIS CODE WORKS DONT TOUCH IT IF YOU DONT NEED TO PLEASE
import 'dotenv/config'
import { Server } from "socket.io"
import { createServer } from "http"
import formidable from 'formidable'
import fetch from 'node-fetch'
import { randomBytes } from 'crypto'
import { readFile, appendFile } from 'fs/promises'
import { extname, normalize, resolve, sep } from 'path'
import { execSync } from 'child_process'
import { randomUUID } from 'crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import {
    getHistory, addMessage, deleteMessage, clearMessages,
    getSession, saveSession, deleteSession,
    getColor, setColor, deleteColor,
    getMute, setMute, deleteMute, getExpiredMutes,
    getStrikes, setStrikes, deleteStrikes,
    isBanned, getBanReason, addBan, removeBan,
    isIpBanned, addIpBan, removeIpBan,
    getFilterWords, addFilterWord, removeFilterWord, replaceFilterWords,
    getSetting, setSetting,
    migrateFromFiles
} from './db.js'

const httpServer = createServer()
const io = new Server(httpServer, {
    cors: {
        origin: ["http://localhost:3000", "https://chattm.app", "https://beta.chattm.app"]
    },
    maxHttpBufferSize: 1e6
})
const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
})

// migrate from legacy files on first run
await migrateFromFiles()

const msgcooldown = 1000
const lastmessage = {}
const CDN_API_KEY = process.env.CDN_API_KEY

const ownercmds = ['/ban', '/removefilter', '/addfilter', '/reloadfilter', '/unban', '/mute', '/setcolor', '/unmute', '/resetstrikes', '/clear', '/announce', '/mutechat', '/unmutechat', '/maintenance', '/unbanip', '/whois', '/kick']

let chatMuted = false
let status = ''
let maintenance = getSetting('maintenance') === '1'
let reason = getSetting('maintenance_reason') ?? ''
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

const blockedColors = ['#0e0e0e', '#161616', '#242424', '#e8e8e8', '#000']

function isBlockedColor(color) {
    return blockedColors.includes(color.toLowerCase())
}

function loadFilterWordsIntoMemory() {
    filteredwords.length = 0
    getFilterWords().forEach(w => filteredwords.push(w))
    console.log(`loaded ${filteredwords.length} filter words`)
}

const filteredwords = []
loadFilterWordsIntoMemory()

function containsFilteredWord(text) {
    if (!text) return null
    const lower = text.toLowerCase()
    return filteredwords.find(w => lower.includes(w)) || null
}

console.log(`loaded ${getHistory().length} messages in history`)

async function getVersionStatus(forceRefresh = false) {
    if (!forceRefresh && versionCache && Date.now() - versionCacheTime < 10 * 60 * 1000) {
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

function isMuted(email) {
    const m = getMute(email)
    if (!m) return false
    if (m.until && Date.now() > m.until) {
        deleteMute(email)
        return false
    }
    return true
}

function systemMessage(text, options = {}) {
    const { excludeUserEmail = null, saveToHistory = true } = options

    const message = {
        username: 'SYSTEM',
        text,
        time: Date.now(),
        system: true
    }
    if (saveToHistory) {
        addMessage({ ...message, id: randomUUID() })
    }
    if (!excludeUserEmail) {
        io.emit('message', message)
        return
    }

    for (const [id, s] of io.sockets.sockets) {
        if (s.userEmail === excludeUserEmail) continue
        s.emit('message', message)
    }
}

function parseDuration(str) {
    const match = str.match(/^(\d+)(s|m|h|d)$/)
    if (!match) return null
    const num = parseInt(match[1])
    const unit = {s: 1000, m: 60000, h: 3600000, d: 86400000}[match[2]]
    return num * unit
}

function isValidUsername(name) {
    return /^[a-zA-Z0-9-]{1,20}$/.test(name)
}

setInterval(() => {
    const expired = getExpiredMutes(Date.now())
    for (const email of expired) {
        deleteMute(email)
        for (const [id, s] of io.sockets.sockets) {
            if (s.userEmail === email) {
                s.emit('unmuted')
            }
        }
    }
}, 10 * 1000)

function emitUserList() {
    const users = []
    for (const [id, s] of io.sockets.sockets) {
        if (s.username) users.push({
            username: s.username,
            email: s.userEmail,
            color: getColor(s.userEmail),
            guest: s.userEmail.endsWith('@guest'),
            isOwner: s.userEmail === process.env.OWNER_EMAIL
        })
    }
    io.emit('userlist', users)
}

io.use((socket, next) => {
    const sessionId = socket.handshake.auth.session
    const user = getSession(sessionId)
    if (!user) return next(new Error('not authenticated'))
    if (isBanned(user.email)) {
        const err = new Error('banned')
        err.data = { reason: getBanReason(user.email) || 'no reason given' }
        return next(err)
    }
    const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() || socket.handshake.address
    if (isIpBanned(ip)) return next(new Error('banned'))

    // guest expiry stuff
    if (user.guest) {
        const today = new Date().toISOString().slice(0,10)
        if (user.expires !== today) {
            deleteSession(sessionId)
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
    // strip ownerEmail before sending history to client
    socket.emit('history', getHistory().map(({ ownerEmail, ...m }) => m))
    socket.emit('init', {
        isOwner: socket.userEmail === process.env.OWNER_EMAIL,
        chatMuted,
        uMuted: isMuted(socket.userEmail) ? getMute(socket.userEmail) : null
    })
    if (status) socket.emit('status', status)
    // check blocked colors on connect
    const currentColor = getColor(socket.userEmail)
    if (currentColor && isBlockedColor(currentColor)) {
        deleteColor(socket.userEmail)
    }
    if (chatMuted) {
        const ann = 'chat is currently muted'
        systemMessage(ann)
    }

    if (socket.userEmail.endsWith('@guest')) {
        const guestUsername = socket.userEmail.replace('@guest', '')
        socket.username = guestUsername
        socket.emit('guestUsername', guestUsername)
        emitUserList()
    }

    socket.on('setUsername', (name, guest) => {
        if (!isValidUsername(name)) {
            socket.emit('commandError', "invalid username, make sure it's within the character limit and uses only letters and numbers")
            return
        }
        const prevUser = socket.username
        socket.username = name
        const isGuest = socket.userEmail.endsWith('@guest')
        if (prevUser && prevUser !== name && !isGuest) {
            socket.broadcast.emit('userRenamedSys', {from: prevUser, to: name}, guest)
            socket.emit('userRenamed', { from: prevUser, to: name }, guest)
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
            systemMessage(`${socket.username} joined`, { excludeUserEmail: socket.userEmail, saveToHistory: false })
        }
    })

    socket.on('disconnect', () => {
        io.emit('usercount', io.engine.clientsCount)
        if (socket.username && !socket.skipLeaveMessage) {
            systemMessage(`${socket.username} left`, { excludeUserEmail: socket.userEmail, saveToHistory: false })
        }
        emitUserList()
    })

    socket.on('deleteMessage', (messageId) => {
        const history = getHistory()
        const msg = history.find(m => m.id === messageId)
        if (!msg) return

        const isOwnerOfMsg = msg.ownerEmail === socket.userEmail
        const isAdmin = socket.userEmail === process.env.OWNER_EMAIL

        if (!isOwnerOfMsg && !isAdmin) {
            socket.emit('commandError', 'you can only delete your own messages')
            return
        }
        deleteMessage(messageId)
        io.emit('messageDeleted', messageId)
    })

    socket.on('message', async (data) => {

        // check if muted
        if (isMuted(socket.userEmail) && socket.userEmail !== process.env.OWNER_EMAIL) {
            const m = getMute(socket.userEmail)
            socket.emit('commandError', `you are muted${m.until ? ' until ' + new Date(m.until).toLocaleString() : ''} - reason: ${m.reason}`)
            return
        }

        // filter
        if (socket.userEmail !== process.env.OWNER_EMAIL) {
            const hit = containsFilteredWord(data.text)
            if (hit) {
                const count = getStrikes(socket.userEmail) + 1
                setStrikes(socket.userEmail, count)

                if (count > 5) {
                    const banReason = 'banned by server - too many automatic mutes'
                    addBan(socket.userEmail, banReason)
                    addIpBan(socket.userIP)
                    await appendFile('bans.log', `${new Date().toISOString()}: also banned IP ${socket.userIP}\n`)
                    await appendFile('filter.log', `${new Date().toISOString()}: ${socket.userEmail} (${data.username}) auto-banned, 5th strike triggered by "${hit}" — message: ${data.text}\n`)
                    socket.emit('banned', banReason)
                    socket.skipLeaveMessage = true
                    socket.disconnect()
                    return
                }
                const durationMs = 10 * 60 * 1000
                setMute(socket.userEmail, `muted by server: word filter (strike ${count}/5)`, Date.now() + durationMs)
                const m = getMute(socket.userEmail)
                await appendFile('filter.log', `${new Date().toISOString()}: ${socket.userEmail} (${data.username}) muted for 10m, strike ${count}/5, triggered by "${hit}" - message: ${data.text}\n`)
                socket.emit('muted', { reason: m.reason, until: m.until })
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
            socket.emit('commandError', "chat is currently muted")
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
            const banReason = reasonParts.join(' ') || 'no reason given'
            addBan(targetEmail, banReason)
            await appendFile('bans.log', `${new Date().toISOString()}: ${socket.userEmail} (${data.username}) banned ${targetEmail} - reason: ${banReason}\n`)
            for (const [id, s] of io.sockets.sockets) {
                if (s.userEmail === targetEmail) {
                    addIpBan(s.userIP)
                    await appendFile('bans.log', `${new Date().toISOString()}: also banned IP ${s.userIP}\n`)
                    s.emit('banned', banReason)
                    socket.emit('commandError', `banned ${targetEmail}`)
                    s.skipLeaveMessage = true
                    s.disconnect()
                }
            }
            return
        }

        if (data.text?.startsWith('/kick ') && socket.userEmail === process.env.OWNER_EMAIL) {
            const args = data.text.slice(6).trim()
            const [targetUsername, ...reasonParts] = args.split(' ')
            const kickReason = reasonParts.join(' ') || 'kicked by server'

            if (!targetUsername) {
                socket.emit('commandError', 'usage: /kick <username> [reason]')
                return
            }

            let kicked = false
            for (const [id, s] of io.sockets.sockets) {
                if (s.username === targetUsername) {
                    s.emit('kicked', kickReason)
                    s.skipLeaveMessage = true
                    s.disconnect()
                    systemMessage(`${targetUsername} was kicked for ${kickReason}`)
                    kicked = true
                    break
                }
            }

            if (!kicked) {
                socket.emit('commandError', `no user found with username ${targetUsername}`)
                return
            }

            socket.emit('commandError', `kicked ${targetUsername}`)
            await appendFile('kicks.log', `${new Date().toISOString()}: ${socket.userEmail} (${data.username}) kicked ${targetUsername} - reason: ${kickReason}\n`)
            return
        }

        if (data.text?.startsWith('/unban ') && socket.userEmail === process.env.OWNER_EMAIL) {
            const targetEmail = data.text.slice(7).trim()
            removeBan(targetEmail)
            socket.emit('commandError', `unbanned ${targetEmail}, use /unbanip for IP`)
            return
        }
        if (data.text?.startsWith('/unbanip ') && socket.userEmail === process.env.OWNER_EMAIL) {
            const targetIP = data.text.slice(9).trim()
            removeIpBan(targetIP)
            socket.emit('commandError', `unbanned ${targetIP}`)
            return
        }
        if (data.text?.startsWith('/mute ') && socket.userEmail === process.env.OWNER_EMAIL) {
            const args = data.text.slice(6).trim().split(' ')
            const targetUsername = args[0]
            const durationStr = args[1]
            const muteReason = args.slice(2).join(' ') || 'no reason given'

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
            setMute(targetEmail, muteReason, durationMs ? Date.now() + durationMs : null)
            const m = getMute(targetEmail)
            await appendFile('mutes.log', `${new Date().toISOString()}: ${socket.userEmail}`)

            for (const [id,s] of io.sockets.sockets) {
                if (s.userEmail === targetEmail) {
                    s.emit('muted', { reason: muteReason, until: m.until })
                }
            }
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
            if (!targetEmail || !getMute(targetEmail)) {
                socket.emit('commandError', `${targetUsername} is not muted`)
                return
            }
            deleteMute(targetEmail)
            for (const [id,s] of io.sockets.sockets) {
                if (s.userEmail === targetEmail) {
                    s.emit('unmuted')
                }
            }
            socket.emit('commandError', `unmuted ${targetUsername}`)
            return
        }
        if (data.text?.startsWith('/resetstrikes ') && socket.userEmail === process.env.OWNER_EMAIL) {
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
            deleteStrikes(targetEmail)
            socket.emit('commandError', `reset filter strikes for ${targetUsername}`)
            return
        }
        if (data.text?.startsWith('/clear') && socket.userEmail === process.env.OWNER_EMAIL) {
            clearMessages()
            io.emit('clear')
            systemMessage('chat was cleared', { saveToHistory: false })
            return
        }

        if (data.text?.startsWith('/announce ') && socket.userEmail === process.env.OWNER_EMAIL) {
            const ann = data.text.slice(10).trim()
            systemMessage(ann)
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
            if (!isValidUsername(nick)) {
                socket.emit('commandError', "invalid username, make sure it's within the character limit and uses only letters and numbers")
                return
            }
            if (socket.userEmail.endsWith('@guest')) {
                socket.emit('commandError', 'guests cannot change their username')
                return
            }
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
            setSetting('maintenance', maintenance ? '1' : '0')
            setSetting('maintenance_reason', reason)
            for (const [id,s] of io.sockets.sockets) {
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
        if (data.text?.startsWith('/color ') || data.text?.startsWith('/colour ')) {
            const sliceAt = data.text.startsWith('/color ') ? 7 : 8
            const colorinput = data.text.slice(sliceAt).trim().toLowerCase()
            const flags = {
                'pride':       'flag:pride', 'rainbow': 'flag:pride',
                'gay':         'flag:gay',
                'trans':       'flag:trans', 'transgender': 'flag:trans',
                'bi':          'flag:bi', 'bisexual': 'flag:bi',
                'lesbian':     'flag:lesbian',
                'nb':          'flag:nb', 'nonbinary': 'flag:nb'
            }
            const color = flags[colorinput] ?? colorinput
            if (isBlockedColor(color)) {
                socket.emit('commandError', 'please choose a different color')
                return
            }
            setColor(socket.userEmail, color)
            socket.emit('colorChanged', color)
            emitUserList()
            return
        }
        if (data.text?.startsWith('/addfilter ') && socket.userEmail === process.env.OWNER_EMAIL) {
            const word = data.text.slice(11).trim().toLowerCase()
            if (!word) {
                socket.emit('commandError', 'you need to specify a word')
                return
            }
            addFilterWord(word)
            loadFilterWordsIntoMemory()
            socket.emit('commandError', `added ${word} to filter list`)
            return
        }
        if (data.text?.startsWith('/reloadfilter') && socket.userEmail === process.env.OWNER_EMAIL) {
            loadFilterWordsIntoMemory()
            socket.emit('commandError', `${filteredwords.length} words loaded`)
            return
        }
        if (data.text?.startsWith('/removefilter ') && socket.userEmail === process.env.OWNER_EMAIL) {
            const word = data.text.slice(14).trim().toLowerCase()
            if (!filteredwords.includes(word)) {
                socket.emit('commandError', `${word} is not in the filter`)
                return
            }
            removeFilterWord(word)
            loadFilterWordsIntoMemory()
            socket.emit('commandError', `removed ${word} from the filter`)
            return
        }
        if (data.text?.startsWith('/setcolor ') && socket.userEmail === process.env.OWNER_EMAIL) {
            const args = data.text.slice(10).trim().split(' ')
            const targetUsername = args[0]
            const colorInput = args.slice(1).join(' ').toLowerCase()

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
            const flagColors = {
                'flag:pride': 'linear-gradient(90deg,#ff0018,#ffa52c,#ffff41,#008018,#0000f9,#86007d)',
                'flag:trans': 'linear-gradient(90deg,#55cdfc,#f7a8b8,#fff,#f7a8b8,#55cdfc)',
                'flag:bi': 'linear-gradient(90deg,#d60270,#d60270,#9b4f96,#0038a8,#0038a8)',
                'flag:lesbian': 'linear-gradient(90deg,#d62900,#ff9b55,#fff,#d461a6,#a50062)',
                'flag:nb': 'linear-gradient(90deg,#fcf434,#fff,#9c59d1,#2c2c2c)'
            }
            const color = flagColors[colorInput] ?? colorInput
            if (isBlockedColor(color)) {
                socket.emit('commandError', 'please choose a different color')
                return
            }
            setColor(targetEmail, color)
            for (const [id,s] of io.sockets.sockets) {
                if (s.userEmail === targetEmail) {
                    s.emit('colorChanged', color)
                }
            }
            emitUserList()
            socket.emit('commandError', `set ${targetUsername}'s color to ${color.startsWith('flag:') ? color.slice(5) : color}`)
            return
        }
        const timestamp = new Date().toISOString()
        await appendFile('messages.log', `${timestamp}: ${socket.userEmail} (${data.username}): ${data.text || '[image]'}\n`)
        const message = {
            ...data,
            id: randomUUID(),
            ownerEmail: socket.userEmail,
            username: socket.username,
            time: Date.now(),
            isToken: socket.userEmail === process.env.OWNER_EMAIL,
            isGuest: socket.userEmail.endsWith('@guest'),
            color: getColor(socket.userEmail) ?? null
        }
        const onlineNames = [...io.sockets.sockets.values()].map(s => s.username).filter(Boolean)
        const mentions = [...new Set(
            [...(data.text || '').matchAll(/@([a-zA-Z0-9_]+)/g)]
                .map(m => m[1])
                .filter(n => onlineNames.some(u => u.toLowerCase() === n.toLowerCase()))
        )]
        message.mentions = mentions
        addMessage(message)
        const {ownerEmail, ...publicMessage} = message
        io.emit('message', publicMessage)
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
        saveSession(sessionid, { email: primary_email, ip })
        const redirectUrl = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}/#session=${sessionid}`
        res.writeHead(302, { Location: redirectUrl })
        res.end()
        return
    }

    if (url.pathname === '/signout') {
        const sessionId = url.searchParams.get('session')
        if (sessionId) {
            deleteSession(sessionId)
        }
        res.writeHead(302, { Location: '/' })
        res.end()
        return
    }

    if (url.pathname === '/upload') {
        const allowedOrigins = ["http://localhost:3000", "https://chattm.app", "https://beta.chattm.app"]
        const origin = req.headers.origin
        if (allowedOrigins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin)
        }
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

        if (req.method === 'OPTIONS') {
            res.writeHead(204)
            res.end()
            return
        }

        if (req.method !== 'POST') {
            res.writeHead(405)
            res.end(JSON.stringify({ error: 'Method not allowed' }))
            return
        }

        const uploadSessionId = url.searchParams.get('session')
        const uploadSession = uploadSessionId ? getSession(uploadSessionId) : null
        if (!uploadSession) {
            res.writeHead(401)
            res.end(JSON.stringify({ error: 'Unauthorized' }))
            return
        }

        const form = formidable({ maxFileSize: 50 * 1024 * 1024 })
        form.parse(req, async (err, fields, files) => {
            if (err) {
                res.writeHead(500)
                res.end(JSON.stringify({ error: err.message }))
                return
            }
            try {
                if (!files.file || !files.file[0]) {
                    res.writeHead(400)
                    res.end(JSON.stringify({ error: 'No file uploaded' }))
                    return
                }

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
                    res.end(JSON.stringify({ error: 'file type not allowed' }))
                    return
                }

                const fileBuffer = await readFile(file.filepath)
                const ext = extname(file.originalFilename || '')
                const key = `uploads/${Date.now()}-${randomBytes(6).toString('hex')}${ext}`

                await s3.send(new PutObjectCommand({
                    Bucket: process.env.AWS_S3_BUCKET,
                    Key: key,
                    Body: fileBuffer,
                    ContentType: file.mimetype,
                    ACL: 'public-read'
                }))

                const publicUrl = `${process.env.AWS_S3_PUBLIC_URL}/${key}`

                const userEmail = uploadSession.email
                const uUsername = fields.username?.[0] || 'unknown'
                await appendFile('uploads.log', `${new Date().toISOString()}: ${userEmail} (${uUsername}): ${publicUrl}\n`)

                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ url: publicUrl }))
            } catch (e) {
                console.error('Upload error:', e)
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
        const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress
        await appendFile('login.log', `${new Date().toISOString()}: guest-${guestId} signed in from ${ip}\n`)
        saveSession(sessionid, {
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
        const forceRefresh = url.searchParams.get('refresh') === '1'
        const vStatus = await getVersionStatus(forceRefresh)
        res.writeHead(200, {"content-type": "application/json", "cache-control": "no-store"})
        res.end(JSON.stringify(vStatus))
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
