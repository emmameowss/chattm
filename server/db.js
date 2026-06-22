import Database from 'better-sqlite3'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'

const db = new Database('chat.db')
db.pragma('journal_mode = WAL')
try { db.exec("ALTER TABLE messages ADD COLUMN mentions TEXT DEFAULT '[]'") } catch {}
try { db.exec("ALTER TABLE messages ADD COLUMN avatar_url TEXT") } catch {}
try { db.exec("ALTER TABLE messages ADD COLUMN is_verified INTEGER DEFAULT 0") } catch {}
try { db.exec("ALTER TABLE profiles ADD COLUMN pronouns TEXT") } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    username TEXT,
    text TEXT,
    image TEXT,
    owner_email TEXT,
    time INTEGER,
    is_token INTEGER DEFAULT 0,
    is_guest INTEGER DEFAULT 0,
    color TEXT,
    system INTEGER DEFAULT 0,
    mentions TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    guest INTEGER DEFAULT 0,
    expires TEXT,
    ip TEXT
  );

  CREATE TABLE IF NOT EXISTS colors (
    email TEXT PRIMARY KEY,
    color TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS mutes (
    email TEXT PRIMARY KEY,
    reason TEXT,
    until INTEGER
  );

  CREATE TABLE IF NOT EXISTS strikes (
    email TEXT PRIMARY KEY,
    count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS bans (
    email TEXT PRIMARY KEY,
    reason TEXT
  );

  CREATE TABLE IF NOT EXISTS ip_bans (
    ip TEXT PRIMARY KEY
  );

  CREATE TABLE IF NOT EXISTS filter_words (
    word TEXT PRIMARY KEY
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS usernames (
    email TEXT PRIMARY KEY,
    username TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS avatars (
    email TEXT PRIMARY KEY,
    url TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS custom_emoji (
    shortcode TEXT PRIMARY KEY,
    url TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS verified_users (
    email TEXT PRIMARY KEY
  );

  CREATE TABLE IF NOT EXISTS profiles (
    email TEXT PRIMARY KEY,
    bio TEXT,
    status TEXT,
    pronouns TEXT
  );
`)

// ─── Messages ────────────────────────────────────────────────────────────────

const MAX_HISTORY = 100

const stmts = {
  insertMessage: db.prepare(`
    INSERT OR REPLACE INTO messages (id, username, text, image, owner_email, time, is_token, is_guest, color, system, mentions, avatar_url, is_verified)
    VALUES (@id, @username, @text, @image, @owner_email, @time, @is_token, @is_guest, @color, @system, @mentions, @avatar_url, @is_verified)
  `),
  getMessages: db.prepare(`SELECT * FROM messages ORDER BY time ASC`),
  deleteMessage: db.prepare(`DELETE FROM messages WHERE id = ?`),
  countMessages: db.prepare(`SELECT COUNT(*) as n FROM messages`),
  oldestMessageId: db.prepare(`SELECT id FROM messages ORDER BY time ASC LIMIT 1`),
  clearMessages: db.prepare(`DELETE FROM messages`),

  // Sessions
  getSession: db.prepare(`SELECT * FROM sessions WHERE id = ?`),
  upsertSession: db.prepare(`INSERT OR REPLACE INTO sessions (id, email, guest, expires, ip) VALUES (@id, @email, @guest, @expires, @ip)`),
  deleteSession: db.prepare(`DELETE FROM sessions WHERE id = ?`),
  deleteAllGuestSessions: db.prepare(`DELETE FROM sessions WHERE guest = 1`),

  // Colors
  getColor: db.prepare(`SELECT color FROM colors WHERE email = ?`),
  setColor: db.prepare(`INSERT OR REPLACE INTO colors (email, color) VALUES (?, ?)`),
  deleteColor: db.prepare(`DELETE FROM colors WHERE email = ?`),
  getAllColors: db.prepare(`SELECT email, color FROM colors`),

  // Mutes
  getMute: db.prepare(`SELECT * FROM mutes WHERE email = ?`),
  setMute: db.prepare(`INSERT OR REPLACE INTO mutes (email, reason, until) VALUES (@email, @reason, @until)`),
  deleteMute: db.prepare(`DELETE FROM mutes WHERE email = ?`),
  getExpiredMutes: db.prepare(`SELECT email FROM mutes WHERE until IS NOT NULL AND until < ?`),

  // Strikes
  getStrikes: db.prepare(`SELECT count FROM strikes WHERE email = ?`),
  setStrikes: db.prepare(`INSERT OR REPLACE INTO strikes (email, count) VALUES (?, ?)`),
  deleteStrikes: db.prepare(`DELETE FROM strikes WHERE email = ?`),

  // Bans
  getBan: db.prepare(`SELECT reason FROM bans WHERE email = ?`),
  addBan: db.prepare(`INSERT OR REPLACE INTO bans (email, reason) VALUES (?, ?)`),
  removeBan: db.prepare(`DELETE FROM bans WHERE email = ?`),
  getAllBans: db.prepare(`SELECT email FROM bans`),

  // IP bans
  getIpBan: db.prepare(`SELECT ip FROM ip_bans WHERE ip = ?`),
  addIpBan: db.prepare(`INSERT OR IGNORE INTO ip_bans (ip) VALUES (?)`),
  removeIpBan: db.prepare(`DELETE FROM ip_bans WHERE ip = ?`),
  getAllIpBans: db.prepare(`SELECT ip FROM ip_bans`),

  // Filter words
  getFilterWords: db.prepare(`SELECT word FROM filter_words ORDER BY word`),
  addFilterWord: db.prepare(`INSERT OR IGNORE INTO filter_words (word) VALUES (?)`),
  removeFilterWord: db.prepare(`DELETE FROM filter_words WHERE word = ?`),
  clearFilterWords: db.prepare(`DELETE FROM filter_words`),

  // Settings
  getSetting: db.prepare(`SELECT value FROM settings WHERE key = ?`),
  setSetting: db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`),

  // Usernames
  getStoredUsername: db.prepare(`SELECT username FROM usernames WHERE email = ?`),
  getEmailByUsername: db.prepare(`SELECT email FROM usernames WHERE username = ?`),
  saveUsername: db.prepare(`INSERT OR REPLACE INTO usernames (email, username) VALUES (?, ?)`),

  // Avatars
  getAvatar: db.prepare(`SELECT url FROM avatars WHERE email = ?`),
  setAvatar: db.prepare(`INSERT OR REPLACE INTO avatars (email, url) VALUES (?, ?)`),
  deleteAvatar: db.prepare(`DELETE FROM avatars WHERE email = ?`),

  // Custom emoji
  getCustomEmoji: db.prepare(`SELECT shortcode, url FROM custom_emoji ORDER BY shortcode`),
  addCustomEmoji: db.prepare(`INSERT OR REPLACE INTO custom_emoji (shortcode, url) VALUES (?, ?)`),
  removeCustomEmoji: db.prepare(`DELETE FROM custom_emoji WHERE shortcode = ?`),

  // Verified users
  isVerified: db.prepare(`SELECT 1 FROM verified_users WHERE email = ?`),
  setVerified: db.prepare(`INSERT OR IGNORE INTO verified_users (email) VALUES (?)`),
  removeVerified: db.prepare(`DELETE FROM verified_users WHERE email = ?`),

  // Profiles
  getProfileData: db.prepare(`SELECT bio, status, pronouns FROM profiles WHERE email = ?`),
  setProfileBio: db.prepare(`INSERT INTO profiles (email, bio) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET bio = excluded.bio`),
  setProfileStatus: db.prepare(`INSERT INTO profiles (email, status) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET status = excluded.status`),
  setProfilePronouns: db.prepare(`INSERT INTO profiles (email, pronouns) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET pronouns = excluded.pronouns`),
}

// ─── Message API ─────────────────────────────────────────────────────────────

export function getHistory() {
  return stmts.getMessages.all().map(row => ({
    id: row.id,
    username: row.username,
    text: row.text,
    image: row.image,
    ownerEmail: row.owner_email,
    time: row.time,
    isToken: !!row.is_token,
    isGuest: !!row.is_guest,
    color: row.color,
    system: !!row.system,
    mentions: JSON.parse(row.mentions || '[]'),
    avatar: row.avatar_url ?? null,
    verified: !!row.is_verified,
  }))
}

export function addMessage(msg) {
  stmts.insertMessage.run({
    id: msg.id,
    username: msg.username,
    text: msg.text ?? null,
    image: msg.image ?? null,
    owner_email: msg.ownerEmail ?? null,
    time: msg.time,
    is_token: msg.isToken ? 1 : 0,
    is_guest: msg.isGuest ? 1 : 0,
    color: msg.color ?? null,
    system: msg.system ? 1 : 0,
    mentions: JSON.stringify(msg.mentions ?? []),
    avatar_url: msg.avatar ?? null,
    is_verified: msg.verified ? 1 : 0,
  })
  // trim to max
  const { n } = stmts.countMessages.get()
  if (n > MAX_HISTORY) {
    const oldest = stmts.oldestMessageId.get()
    if (oldest) stmts.deleteMessage.run(oldest.id)
  }
}

export function deleteMessage(id) {
  stmts.deleteMessage.run(id)
}

export function clearMessages() {
  stmts.clearMessages.run()
}

// ─── Session API ─────────────────────────────────────────────────────────────

export function getSession(id) {
  const row = stmts.getSession.get(id)
  if (!row) return null
  return {
    email: row.email,
    guest: !!row.guest,
    expires: row.expires,
    ip: row.ip,
  }
}

export function saveSession(id, data) {
  stmts.upsertSession.run({
    id,
    email: data.email,
    guest: data.guest ? 1 : 0,
    expires: data.expires ?? null,
    ip: data.ip ?? null,
  })
}

export function deleteSession(id) {
  stmts.deleteSession.run(id)
}

export function deleteAllGuestSessions() {
  stmts.deleteAllGuestSessions.run()
}

// ─── Color API ───────────────────────────────────────────────────────────────

export function getColor(email) {
  return stmts.getColor.get(email)?.color ?? null
}

export function setColor(email, color) {
  stmts.setColor.run(email, color)
}

export function deleteColor(email) {
  stmts.deleteColor.run(email)
}

export function getAllColors() {
  const result = {}
  for (const { email, color } of stmts.getAllColors.all()) result[email] = color
  return result
}

// ─── Mute API ────────────────────────────────────────────────────────────────

export function getMute(email) {
  const row = stmts.getMute.get(email)
  if (!row) return null
  return { reason: row.reason, until: row.until }
}

export function setMute(email, reason, until) {
  stmts.setMute.run({ email, reason, until: until ?? null })
}

export function deleteMute(email) {
  stmts.deleteMute.run(email)
}

export function getExpiredMutes(now) {
  return stmts.getExpiredMutes.all(now).map(r => r.email)
}

// ─── Strike API ──────────────────────────────────────────────────────────────

export function getStrikes(email) {
  return stmts.getStrikes.get(email)?.count ?? 0
}

export function setStrikes(email, count) {
  stmts.setStrikes.run(email, count)
}

export function deleteStrikes(email) {
  stmts.deleteStrikes.run(email)
}

// ─── Ban API ─────────────────────────────────────────────────────────────────

export function isBanned(email) {
  return !!stmts.getBan.get(email)
}

export function getBanReason(email) {
  return stmts.getBan.get(email)?.reason ?? null
}

export function addBan(email, reason) {
  stmts.addBan.run(email, reason ?? null)
}

export function removeBan(email) {
  stmts.removeBan.run(email)
}

// ─── IP Ban API ──────────────────────────────────────────────────────────────

export function isIpBanned(ip) {
  return !!stmts.getIpBan.get(ip)
}

export function addIpBan(ip) {
  stmts.addIpBan.run(ip)
}

export function removeIpBan(ip) {
  stmts.removeIpBan.run(ip)
}

// ─── Filter Word API ─────────────────────────────────────────────────────────

export function getFilterWords() {
  return stmts.getFilterWords.all().map(r => r.word)
}

export function addFilterWord(word) {
  stmts.addFilterWord.run(word)
}

export function removeFilterWord(word) {
  stmts.removeFilterWord.run(word)
}

export function replaceFilterWords(words) {
  const replace = db.transaction(ws => {
    stmts.clearFilterWords.run()
    for (const w of ws) stmts.addFilterWord.run(w)
  })
  replace(words)
}

// ─── Settings API ────────────────────────────────────────────────────────────

export function getSetting(key) {
  return stmts.getSetting.get(key)?.value ?? null
}

export function setSetting(key, value) {
  stmts.setSetting.run(key, String(value))
}

// ─── Username API ────────────────────────────────────────────────────────────

export function getStoredUsername(email) {
  return stmts.getStoredUsername.get(email)?.username ?? null
}

export function getEmailByUsername(username) {
  return stmts.getEmailByUsername.get(username)?.email ?? null
}

export function saveUsername(email, username) {
  stmts.saveUsername.run(email, username)
}

// ─── Avatar API ──────────────────────────────────────────────────────────────

export function getAvatar(email) {
  return stmts.getAvatar.get(email)?.url ?? null
}

export function setAvatar(email, url) {
  stmts.setAvatar.run(email, url)
}

export function deleteAvatar(email) {
  stmts.deleteAvatar.run(email)
}

// ─── Custom Emoji API ────────────────────────────────────────────────────────

export function getCustomEmoji() {
  const result = {}
  for (const { shortcode, url } of stmts.getCustomEmoji.all()) result[shortcode] = url
  return result
}

export function addCustomEmoji(shortcode, url) {
  stmts.addCustomEmoji.run(shortcode, url)
}

export function removeCustomEmoji(shortcode) {
  stmts.removeCustomEmoji.run(shortcode)
}

// ─── Verified Users API ──────────────────────────────────────────────────────

export function isVerified(email) {
  return !!stmts.isVerified.get(email)
}

export function setVerified(email) {
  stmts.setVerified.run(email)
}

export function removeVerified(email) {
  stmts.removeVerified.run(email)
}

// ─── Profile API ─────────────────────────────────────────────────────────────

export function getProfileData(email) {
  const row = stmts.getProfileData.get(email)
  return { bio: row?.bio ?? null, status: row?.status ?? null, pronouns: row?.pronouns ?? null }
}

export function setProfileBio(email, bio) {
  stmts.setProfileBio.run(email, bio)
}

export function setProfileStatus(email, status) {
  stmts.setProfileStatus.run(email, status)
}

export function setProfilePronouns(email, pronouns) {
  stmts.setProfilePronouns.run(email, pronouns)
}

// ─── Migration from legacy files ─────────────────────────────────────────────

export async function migrateFromFiles() {
  if (getSetting('migrated_from_files') === '1') return
  const migrated = []

  async function tryJSON(path) {
    try { return JSON.parse(await readFile(path, 'utf8')) } catch { return null }
  }
  async function tryText(path) {
    try { return await readFile(path, 'utf8') } catch { return null }
  }

  if (existsSync('history.json')) {
    const data = await tryJSON('history.json')
    if (Array.isArray(data) && data.length) {
      const insert = db.transaction(() => {
        for (const m of data) {
          try {
            stmts.insertMessage.run({
              id: m.id ?? crypto.randomUUID(),
              username: m.username ?? null,
              text: m.text ?? null,
              image: m.image ?? null,
              owner_email: m.ownerEmail ?? null,
              time: m.time ?? Date.now(),
              is_token: m.isToken ? 1 : 0,
              is_guest: m.isGuest ? 1 : 0,
              color: m.color ?? null,
              system: m.system ? 1 : 0,
            })
          } catch {}
        }
      })
      insert()
      migrated.push('history.json')
    }
  }

  if (existsSync('sessions.json')) {
    const data = await tryJSON('sessions.json')
    if (data && typeof data === 'object') {
      const insert = db.transaction(() => {
        for (const [id, s] of Object.entries(data)) {
          try {
            stmts.upsertSession.run({ id, email: s.email, guest: s.guest ? 1 : 0, expires: s.expires ?? null, ip: s.ip ?? null })
          } catch {}
        }
      })
      insert()
      migrated.push('sessions.json')
    }
  }

  if (existsSync('colors.json')) {
    const data = await tryJSON('colors.json')
    if (data && typeof data === 'object') {
      const insert = db.transaction(() => {
        for (const [email, color] of Object.entries(data)) {
          try { stmts.setColor.run(email, color) } catch {}
        }
      })
      insert()
      migrated.push('colors.json')
    }
  }

  if (existsSync('mutes.json')) {
    const data = await tryJSON('mutes.json')
    if (data && typeof data === 'object') {
      const insert = db.transaction(() => {
        for (const [email, m] of Object.entries(data)) {
          try { stmts.setMute.run({ email, reason: m.reason ?? null, until: m.until ?? null }) } catch {}
        }
      })
      insert()
      migrated.push('mutes.json')
    }
  }

  if (existsSync('strikes.json')) {
    const data = await tryJSON('strikes.json')
    if (data && typeof data === 'object') {
      const insert = db.transaction(() => {
        for (const [email, count] of Object.entries(data)) {
          try { stmts.setStrikes.run(email, count) } catch {}
        }
      })
      insert()
      migrated.push('strikes.json')
    }
  }

  if (existsSync('banreasons.json')) {
    const reasons = await tryJSON('banreasons.json') ?? {}
    if (existsSync('bans.txt')) {
      const data = await tryText('bans.txt')
      if (data) {
        const insert = db.transaction(() => {
          for (const email of data.split('\n').filter(Boolean)) {
            try { stmts.addBan.run(email, reasons[email] ?? null) } catch {}
          }
        })
        insert()
        migrated.push('bans.txt', 'banreasons.json')
      }
    }
  }

  if (existsSync('ipbans.txt')) {
    const data = await tryText('ipbans.txt')
    if (data) {
      const insert = db.transaction(() => {
        for (const ip of data.split('\n').filter(Boolean)) {
          try { stmts.addIpBan.run(ip) } catch {}
        }
      })
      insert()
      migrated.push('ipbans.txt')
    }
  }

  if (existsSync('filter.txt')) {
    const data = await tryText('filter.txt')
    if (data) {
      const words = data.split('\n').map(w => w.trim().toLowerCase()).filter(Boolean)
      replaceFilterWords(words)
      migrated.push('filter.txt')
    }
  }

  if (existsSync('maintenance.json')) {
    const data = await tryJSON('maintenance.json')
    if (data) {
      if (data.maintenance !== undefined) setSetting('maintenance', data.maintenance ? '1' : '0')
      if (data.reason !== undefined) setSetting('maintenance_reason', data.reason)
      migrated.push('maintenance.json')
    }
  }

  setSetting('migrated_from_files', '1')
  if (migrated.length) {
    console.log(`migrated from legacy files: ${migrated.join(', ')}`)
  }
}
