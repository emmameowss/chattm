import Database from "better-sqlite3";
import { readFile } from "fs/promises";
import { existsSync } from "fs";

const dbPath = process.env.DB_PATH || "./chat.db"
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

export { db };

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

  CREATE TABLE IF NOT EXISTS red_verified_users (
    email TEXT PRIMARY KEY
  );

  CREATE TABLE IF NOT EXISTS profiles (
    email TEXT PRIMARY KEY,
    bio TEXT,
    status TEXT,
    pronouns TEXT,
    last_seen INTEGER
  );

  CREATE TABLE IF NOT EXISTS channels (
    name TEXT PRIMARY KEY,
    created_at INTEGER,
    created_by TEXT
  );

  CREATE TABLE IF NOT EXISTS roles (
    email TEXT PRIMARY KEY,
    role TEXT NOT NULL DEFAULT 'user'
  );

  CREATE TABLE IF NOT EXISTS hidden_users (
    email TEXT PRIMARY KEY
  );

  CREATE TABLE IF NOT EXISTS action_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at INTEGER NOT NULL,
    actor_email TEXT NOT NULL,
    actor_username TEXT,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    category TEXT NOT NULL,
    target TEXT,
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failed', 'denied')),
    details_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
    target_type TEXT NOT NULL CHECK (target_type IN ('message', 'account')),
    target_key TEXT NOT NULL,
    target_username TEXT,
    target_email TEXT,
    reporter_email TEXT NOT NULL,
    reporter_username TEXT,
    reporter_role TEXT NOT NULL DEFAULT 'user',
    reason TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    snapshot_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS report_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL,
    occurred_at INTEGER NOT NULL,
    actor_email TEXT NOT NULL,
    actor_username TEXT,
    actor_role TEXT NOT NULL,
    note TEXT NOT NULL
  );
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS action_logs_time_idx ON action_logs (occurred_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS action_logs_category_time_idx ON action_logs (category, occurred_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS action_logs_actor_time_idx ON action_logs (actor_email, occurred_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS reports_status_time_idx ON reports (status, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS reports_target_idx ON reports (target_type, target_key);
  CREATE INDEX IF NOT EXISTS reports_reporter_idx ON reports (reporter_email, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS reports_open_duplicate_idx
    ON reports (reporter_email, target_type, target_key) WHERE status = 'open';
  CREATE INDEX IF NOT EXISTS report_notes_report_time_idx ON report_notes (report_id, occurred_at, id);
`);

// seed the default channel (idempotent)
db.prepare(
  `INSERT OR IGNORE INTO channels (name, created_at, created_by) VALUES ('main', ?, 'system')`,
).run(Date.now());

// column migrations (run after CREATE TABLE so the tables exist)
try {
  db.exec("ALTER TABLE messages ADD COLUMN mentions TEXT DEFAULT '[]'");
} catch {}
try {
  db.exec("ALTER TABLE messages ADD COLUMN avatar_url TEXT");
} catch {}
try {
  db.exec("ALTER TABLE messages ADD COLUMN is_verified INTEGER DEFAULT 0");
} catch {}
try {
  db.exec("ALTER TABLE messages ADD COLUMN reply_to TEXT");
} catch {}
try {
  db.exec("ALTER TABLE messages ADD COLUMN channel TEXT DEFAULT 'main'");
} catch {}
try {
  db.exec("ALTER TABLE sessions ADD COLUMN clerk_id TEXT");
} catch {}
try {
  db.exec("ALTER TABLE sessions ADD COLUMN clerk_session_id TEXT");
} catch { }
try {
  db.exec("ALTER TABLE sessions ADD COLUMN role TEXT DEFAULT 'user'");
} catch {}
try {
  db.exec("ALTER TABLE bans ADD COLUMN ip TEXT");
} catch {}

// profiles column migrations
try {
  db.exec("ALTER TABLE profiles ADD COLUMN pronouns TEXT");
} catch {}
try {
  db.exec("ALTER TABLE profiles ADD COLUMN last_seen INTEGER");
} catch {}

// ─── Messages ────────────────────────────────────────────────────────────────

const stmts = {
  insertMessage: db.prepare(`
    INSERT OR REPLACE INTO messages (id, username, text, image, owner_email, time, is_token, is_guest, color, system, mentions, avatar_url, is_verified, reply_to, channel)
    VALUES (@id, @username, @text, @image, @owner_email, @time, @is_token, @is_guest, @color, @system, @mentions, @avatar_url, @is_verified, @reply_to, @channel)
  `),
  getMessages: db.prepare(`
    SELECT m.*, CASE WHEN rv.email IS NOT NULL THEN 1 ELSE 0 END AS red_verified,
           r.username AS reply_username, r.text AS reply_text, r.image AS reply_image,
           r.color AS reply_color, r.avatar_url AS reply_avatar,
           r.is_token AS reply_is_token, r.is_verified AS reply_is_verified,
           CASE WHEN rv2.email IS NOT NULL THEN 1 ELSE 0 END AS reply_red_verified
    FROM (SELECT * FROM messages WHERE channel = ? ORDER BY time DESC LIMIT 100) m
    LEFT JOIN red_verified_users rv ON rv.email = m.owner_email
    LEFT JOIN messages r ON r.id = m.reply_to
    LEFT JOIN red_verified_users rv2 ON rv2.email = r.owner_email
    ORDER BY m.time ASC
  `),
  getAllMessages: db.prepare(`
    SELECT m.*, CASE WHEN rv.email IS NOT NULL THEN 1 ELSE 0 END AS red_verified,
           r.username AS reply_username, r.text AS reply_text, r.image AS reply_image,
           r.color AS reply_color, r.avatar_url AS reply_avatar,
           r.is_token AS reply_is_token, r.is_verified AS reply_is_verified,
           CASE WHEN rv2.email IS NOT NULL THEN 1 ELSE 0 END AS reply_red_verified
    FROM messages m
    LEFT JOIN red_verified_users rv ON rv.email = m.owner_email
    LEFT JOIN messages r ON r.id = m.reply_to
    LEFT JOIN red_verified_users rv2 ON rv2.email = r.owner_email
    ORDER BY m.time ASC
  `),
  getMessageById: db.prepare(`
    SELECT m.*, CASE WHEN rv.email IS NOT NULL THEN 1 ELSE 0 END AS red_verified,
           r.username AS reply_username, r.text AS reply_text, r.image AS reply_image,
           r.color AS reply_color, r.avatar_url AS reply_avatar,
           r.is_token AS reply_is_token, r.is_verified AS reply_is_verified,
           CASE WHEN rv2.email IS NOT NULL THEN 1 ELSE 0 END AS reply_red_verified
    FROM messages m
    LEFT JOIN red_verified_users rv ON rv.email = m.owner_email
    LEFT JOIN messages r ON r.id = m.reply_to
    LEFT JOIN red_verified_users rv2 ON rv2.email = r.owner_email
    WHERE m.id = ?
  `),
  deleteMessage: db.prepare(`DELETE FROM messages WHERE id = ?`),
  clearMessages: db.prepare(`DELETE FROM messages WHERE channel = ?`),

  // Channels
  listChannels: db.prepare(
    `SELECT name, created_at FROM channels ORDER BY created_at ASC`,
  ),
  getChannel: db.prepare(`SELECT name FROM channels WHERE name = ?`),
  insertChannel: db.prepare(
    `INSERT INTO channels (name, created_at, created_by) VALUES (?, ?, ?)`,
  ),
  deleteChannel: db.prepare(`DELETE FROM channels WHERE name = ?`),
  deleteChannelMessages: db.prepare(`DELETE FROM messages WHERE channel = ?`),

  // Sessions
  getSession: db.prepare(`SELECT * FROM sessions WHERE id = ?`),
  upsertSession: db.prepare(
    `INSERT OR REPLACE INTO sessions (id, email, guest, expires, ip, clerk_id, clerk_session_id, role) VALUES (@id, @email, @guest, @expires, @ip, @clerk_id, @clerk_session_id, @role)`,
  ),
  deleteSession: db.prepare(`DELETE FROM sessions WHERE id = ?`),
  deleteAllGuestSessions: db.prepare(`DELETE FROM sessions WHERE guest = 1`),
  getLastIpByEmail: db.prepare(
    `SELECT ip FROM sessions WHERE email = ? AND ip IS NOT NULL ORDER BY rowid DESC LIMIT 1`,
  ),

  // Colors
  getColor: db.prepare(`SELECT color FROM colors WHERE email = ?`),
  setColor: db.prepare(
    `INSERT OR REPLACE INTO colors (email, color) VALUES (?, ?)`,
  ),
  deleteColor: db.prepare(`DELETE FROM colors WHERE email = ?`),

  // Mutes
  getMute: db.prepare(`SELECT * FROM mutes WHERE email = ?`),
  setMute: db.prepare(
    `INSERT OR REPLACE INTO mutes (email, reason, until) VALUES (@email, @reason, @until)`,
  ),
  deleteMute: db.prepare(`DELETE FROM mutes WHERE email = ?`),
  getExpiredMutes: db.prepare(
    `SELECT email FROM mutes WHERE until IS NOT NULL AND until < ?`,
  ),

  // Strikes
  setStrikes: db.prepare(
    `INSERT OR REPLACE INTO strikes (email, count) VALUES (?, ?)`,
  ),
  deleteStrikes: db.prepare(`DELETE FROM strikes WHERE email = ?`),

  // Bans
  getBan: db.prepare(`SELECT reason, ip FROM bans WHERE email = ?`),
  addBan: db.prepare(
    `INSERT OR REPLACE INTO bans (email, reason, ip) VALUES (?, ?, ?)`,
  ),
  removeBan: db.prepare(`DELETE FROM bans WHERE email = ?`),
  getAllBans: db.prepare(`SELECT email FROM bans`),

  // IP bans
  getIpBan: db.prepare(`SELECT ip FROM ip_bans WHERE ip = ?`),
  addIpBan: db.prepare(`INSERT OR IGNORE INTO ip_bans (ip) VALUES (?)`),
  removeIpBan: db.prepare(`DELETE FROM ip_bans WHERE ip = ?`),
  getAllIpBans: db.prepare(`SELECT ip FROM ip_bans`),

  // Settings
  getSetting: db.prepare(`SELECT value FROM settings WHERE key = ?`),
  setSetting: db.prepare(
    `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`,
  ),

  // Usernames
  getStoredUsername: db.prepare(
    `SELECT username FROM usernames WHERE email = ?`,
  ),
  getEmailByUsername: db.prepare(
    `SELECT email FROM usernames WHERE username = ?`,
  ),
  usernameTakenBy: db.prepare(
    `SELECT email FROM usernames WHERE username = ? COLLATE NOCASE AND email != ? LIMIT 1`,
  ),
  saveUsername: db.prepare(
    `INSERT OR REPLACE INTO usernames (email, username) VALUES (?, ?)`,
  ),

  // Avatars
  getAvatar: db.prepare(`SELECT url FROM avatars WHERE email = ?`),
  setAvatar: db.prepare(
    `INSERT OR REPLACE INTO avatars (email, url) VALUES (?, ?)`,
  ),
  deleteAvatar: db.prepare(`DELETE FROM avatars WHERE email = ?`),

  // Custom emoji
  getCustomEmoji: db.prepare(
    `SELECT shortcode, url FROM custom_emoji ORDER BY shortcode`,
  ),
  addCustomEmoji: db.prepare(
    `INSERT OR REPLACE INTO custom_emoji (shortcode, url) VALUES (?, ?)`,
  ),
  removeCustomEmoji: db.prepare(`DELETE FROM custom_emoji WHERE shortcode = ?`),

  // Verified users
  isVerified: db.prepare(`SELECT 1 FROM verified_users WHERE email = ?`),
  setVerified: db.prepare(
    `INSERT OR IGNORE INTO verified_users (email) VALUES (?)`,
  ),
  removeVerified: db.prepare(`DELETE FROM verified_users WHERE email = ?`),

  // Red verified users
  isRedVerified: db.prepare(`SELECT 1 FROM red_verified_users WHERE email = ?`),
  setRedVerified: db.prepare(
    `INSERT OR IGNORE INTO red_verified_users (email) VALUES (?)`,
  ),
  removeRedVerified: db.prepare(
    `DELETE FROM red_verified_users WHERE email = ?`,
  ),

  // Stats
  countUsers: db.prepare(
    `SELECT COUNT(DISTINCT email) AS n FROM sessions WHERE email NOT LIKE '%@guest'`,
  ),
  countMessages: db.prepare(
    `SELECT COUNT(*) AS n FROM messages WHERE system = 0`,
  ),
  countEmoji: db.prepare(`SELECT COUNT(*) AS n FROM custom_emoji`),
  incrTotalMessages: db.prepare(
    `INSERT INTO settings (key, value) VALUES ('total_messages_sent', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`,
  ),
  getTotalMessages: db.prepare(
    `SELECT value FROM settings WHERE key = 'total_messages_sent'`,
  ),

  // Profiles
  getProfileData: db.prepare(
    `SELECT bio, status, pronouns, last_seen FROM profiles WHERE email = ?`,
  ),
  setProfileBio: db.prepare(
    `INSERT INTO profiles (email, bio) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET bio = excluded.bio`,
  ),
  setProfileStatus: db.prepare(
    `INSERT INTO profiles (email, status) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET status = excluded.status`,
  ),
  setProfilePronouns: db.prepare(
    `INSERT INTO profiles (email, pronouns) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET pronouns = excluded.pronouns`,
  ),
  setLastSeen: db.prepare(
    `INSERT INTO profiles (email, last_seen) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET last_seen = excluded.last_seen`,
  ),
  getRecentUsers: db.prepare(`
    SELECT p.email, p.last_seen, u.username,
           p.status, p.bio, p.pronouns,
           c.color,
           a.url AS avatar,
           CASE WHEN v.email IS NOT NULL THEN 1 ELSE 0 END AS verified,
           CASE WHEN rv.email IS NOT NULL THEN 1 ELSE 0 END AS red_verified,
           COALESCE(r.role, 'user') AS role
    FROM profiles p
    JOIN usernames u ON u.email = p.email
    LEFT JOIN colors c ON c.email = p.email
    LEFT JOIN avatars a ON a.email = p.email
    LEFT JOIN verified_users v ON v.email = p.email
    LEFT JOIN red_verified_users rv ON rv.email = p.email
    LEFT JOIN roles r on r.email = p.email
    WHERE p.last_seen > ? AND u.email NOT LIKE '%@guest'
    ORDER BY p.last_seen DESC LIMIT 100
  `),

  // roles
  getRole: db.prepare(`SELECT role FROM roles WHERE email = ?`),
  setRole: db.prepare(`INSERT OR REPLACE INTO roles (email, role) VALUES (?, ?)`),

  // hidden_users
  isHidden: db.prepare(`SELECT 1 FROM hidden_users WHERE lower(email) = lower(?)`),
  getHiddenUsers: db.prepare(`SELECT DISTINCT lower(email) AS email FROM hidden_users ORDER BY lower(email)`),
  setHidden: db.prepare(`INSERT OR IGNORE INTO hidden_users (email) VALUES (?)`),
  removeHidden: db.prepare(`DELETE FROM hidden_users WHERE lower(email) = lower(?)`),

  // Action audit log
  insertActionLog: db.prepare(`
    INSERT INTO action_logs
      (occurred_at, actor_email, actor_username, actor_role, action, category, target, outcome, details_json)
    VALUES
      (@occurred_at, @actor_email, @actor_username, @actor_role, @action, @category, @target, @outcome, @details_json)
  `),
  pruneActionLogs: db.prepare(`
    DELETE FROM action_logs
    WHERE id NOT IN (SELECT id FROM action_logs ORDER BY id DESC LIMIT ?)
  `)
};

const insertActionLogTransaction = db.transaction((record) => {
  const result = stmts.insertActionLog.run(record);
  if (Number(result.lastInsertRowid) > 10_000) stmts.pruneActionLogs.run(10_000);
  return Number(result.lastInsertRowid);
});

// ─── Message API ─────────────────────────────────────────────────────────────

function mapMessageRow(row) {
  return {
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
    channel: row.channel ?? "main",
    mentions: JSON.parse(row.mentions || "[]"),
    avatar: row.avatar_url ?? null,
    verified: !!row.is_verified,
    redVerified: !!row.red_verified,
    replyTo: row.reply_to
      ? {
          id: row.reply_to,
          username: row.reply_username ?? null,
          text: row.reply_text ?? null,
          image: row.reply_image ?? null,
          color: row.reply_color ?? null,
          avatar: row.reply_avatar ?? null,
          isToken: !!row.reply_is_token,
          verified: !!row.reply_is_verified,
          redVerified: !!row.reply_red_verified,
          deleted: row.reply_username == null,
        }
      : null,
  };
}

export function getAllHistory() {
  return stmts.getAllMessages.all().map(mapMessageRow);
}

export function getHistory(channel = "main") {
  return stmts.getMessages.all(channel).map(mapMessageRow);
}

export function listChannels() {
  return stmts.listChannels
    .all()
    .map((r) => ({
      name: r.name,
      createdAt: r.created_at,
      createdBy: r.created_by,
    }));
}

export function channelExists(name) {
  return !!stmts.getChannel.get(name);
}

export function createChannel(name, email) {
  stmts.insertChannel.run(name, Date.now(), email);
}

export function deleteChannel(name) {
  const t = db.transaction(() => {
    stmts.deleteChannelMessages.run(name);
    stmts.deleteChannel.run(name);
  });
  t();
}

export function getMessageById(id) {
  const row = stmts.getMessageById.get(id);
  return row ? mapMessageRow(row) : null;
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
    reply_to: msg.replyTo ?? null,
    channel: msg.channel ?? "main",
  });
  if (!msg.system) stmts.incrTotalMessages.run();
}

export function deleteMessage(id) {
  stmts.deleteMessage.run(id);
}

export function clearMessages(channel = "main") {
  stmts.clearMessages.run(channel);
}

// ─── Session API ─────────────────────────────────────────────────────────────

export function getSession(id) {
  const row = stmts.getSession.get(id);
  if (!row) return null;
  return {
    email: row.email,
    guest: !!row.guest,
    expires: row.expires,
    ip: row.ip,
    clerkId: row.clerk_id ?? null,
    clerkSessionId: row.clerk_session_id ?? null,
    role: row.role ?? "user",
  };
}

export function saveSession(id, data) {
  stmts.upsertSession.run({
    id,
    email: data.email,
    guest: data.guest ? 1 : 0,
    expires: data.expires ?? null,
    ip: data.ip ?? null,
    clerk_id: data.clerkId ?? null,
    clerk_session_id: data.clerkSessionId ?? null,
    role: data.role ?? "user",
  });
}

export function deleteSession(id) {
  stmts.deleteSession.run(id);
}

export function deleteAllGuestSessions() {
  stmts.deleteAllGuestSessions.run();
}

export function getLastIpByEmail(email) {
  return stmts.getLastIpByEmail.get(email)?.ip ?? null;
}

// ─── Color API ───────────────────────────────────────────────────────────────

export function getColor(email) {
  return stmts.getColor.get(email)?.color ?? null;
}

export function setColor(email, color) {
  stmts.setColor.run(email, color);
}

export function deleteColor(email) {
  stmts.deleteColor.run(email);
}

// ─── Mute API ────────────────────────────────────────────────────────────────

export function getMute(email) {
  const row = stmts.getMute.get(email);
  if (!row) return null;
  return { reason: row.reason, until: row.until };
}

export function setMute(email, reason, until) {
  stmts.setMute.run({ email, reason, until: until ?? null });
}

export function deleteMute(email) {
  stmts.deleteMute.run(email);
}

export function getExpiredMutes(now) {
  return stmts.getExpiredMutes.all(now).map((r) => r.email);
}

// ─── Strike API ──────────────────────────────────────────────────────────────

export function deleteStrikes(email) {
  stmts.deleteStrikes.run(email);
}

// ─── Ban API ─────────────────────────────────────────────────────────────────

export function isBanned(email) {
  return !!stmts.getBan.get(email);
}

export function getBanReason(email) {
  return stmts.getBan.get(email)?.reason ?? null;
}

export function getBanIp(email) {
  return stmts.getBan.get(email)?.ip ?? null;
}

export function addBan(email, reason, ip = null) {
  stmts.addBan.run(email, reason ?? null, ip ?? null);
}

export function removeBan(email) {
  stmts.removeBan.run(email);
}

// ─── IP Ban API ──────────────────────────────────────────────────────────────

export function isIpBanned(ip) {
  return !!stmts.getIpBan.get(ip);
}

export function addIpBan(ip) {
  if (!ip) return;
  stmts.addIpBan.run(ip);
}

export function removeIpBan(ip) {
  if (!ip) return;
  stmts.removeIpBan.run(ip);
}

// ─── Settings API ────────────────────────────────────────────────────────────

export function getSetting(key) {
  return stmts.getSetting.get(key)?.value ?? null;
}

export function setSetting(key, value) {
  stmts.setSetting.run(key, String(value));
}

// ─── Username API ────────────────────────────────────────────────────────────

export function getStoredUsername(email) {
  return stmts.getStoredUsername.get(email)?.username ?? null;
}

export function getEmailByUsername(username) {
  return stmts.getEmailByUsername.get(username)?.email ?? null;
}

export function isUsernameTaken(username, exceptEmail) {
  return !!stmts.usernameTakenBy.get(username, exceptEmail ?? "");
}

export function saveUsername(email, username) {
  stmts.saveUsername.run(email, username);
}

// ─── Avatar API ──────────────────────────────────────────────────────────────

export function getAvatar(email) {
  return stmts.getAvatar.get(email)?.url ?? null;
}

export function setAvatar(email, url) {
  stmts.setAvatar.run(email, url);
}

export function deleteAvatar(email) {
  stmts.deleteAvatar.run(email);
}

// ─── Custom Emoji API ────────────────────────────────────────────────────────

export function getCustomEmoji() {
  const result = {};
  for (const { shortcode, url } of stmts.getCustomEmoji.all())
    result[shortcode] = url;
  return result;
}

export function addCustomEmoji(shortcode, url) {
  stmts.addCustomEmoji.run(shortcode, url);
}

export function removeCustomEmoji(shortcode) {
  stmts.removeCustomEmoji.run(shortcode);
}

// ─── Verified Users API ──────────────────────────────────────────────────────

export function isVerified(email) {
  return !!stmts.isVerified.get(email);
}

export function setVerified(email) {
  stmts.setVerified.run(email);
}

export function removeVerified(email) {
  stmts.removeVerified.run(email);
}

export function isRedVerified(email) {
  return !!stmts.isRedVerified.get(email);
}

export function setRedVerified(email) {
  stmts.setRedVerified.run(email);
}

export function removeRedVerified(email) {
  stmts.removeRedVerified.run(email);
}

// ─── Profile API ─────────────────────────────────────────────────────────────

export function getProfileData(email) {
  const row = stmts.getProfileData.get(email);
  return {
    bio: row?.bio ?? null,
    status: row?.status ?? null,
    pronouns: row?.pronouns ?? null,
    lastSeen: row?.last_seen ?? null,
  };
}

export function setProfileBio(email, bio) {
  stmts.setProfileBio.run(email, bio);
}

export function setProfileStatus(email, status) {
  stmts.setProfileStatus.run(email, status);
}

export function setProfilePronouns(email, pronouns) {
  stmts.setProfilePronouns.run(email, pronouns);
}

export function setLastSeen(email) {
  stmts.setLastSeen.run(email, Date.now());
}

export function getDbStats() {
  const totalRow = stmts.getTotalMessages.get();
  return {
    users: stmts.countUsers.get().n,
    messages: totalRow
      ? parseInt(totalRow.value, 10)
      : stmts.countMessages.get().n,
    emoji: stmts.countEmoji.get().n,
  };
}

export function getRecentUsers(cutoffMs) {
  return stmts.getRecentUsers.all(cutoffMs);
}

export function getRole(email) {
  return stmts.getRole.get(email)?.role ?? 'user';
}

export function addActionLog({
  occurredAt = Date.now(),
  actorEmail,
  actorUsername = null,
  actorRole,
  action,
  category,
  target = null,
  outcome = 'success',
  details = {},
}) {
  if (!actorEmail || !action || !category) return null;
  const inputDetails = details && typeof details === 'object' && !Array.isArray(details)
    ? details
    : {};
  const safeDetails = {};
  for (const [key, value] of Object.entries(inputDetails).slice(0, 20)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) continue;
    if (typeof value === 'string') safeDetails[key] = value.slice(0, 1000);
    else if (typeof value === 'number' && Number.isFinite(value)) safeDetails[key] = value;
    else if (typeof value === 'boolean' || value === null) safeDetails[key] = value;
  }
  let detailsJson = '{}';
  try { detailsJson = JSON.stringify(safeDetails); } catch {}
  if (detailsJson.length > 4000) {
    detailsJson = JSON.stringify({ note: 'additional details omitted' });
  }
  return insertActionLogTransaction({
    occurred_at: Number(occurredAt) || Date.now(),
    actor_email: String(actorEmail).slice(0, 320),
    actor_username: actorUsername ? String(actorUsername).slice(0, 80) : null,
    actor_role: String(actorRole || 'user').slice(0, 20),
    action: String(action).slice(0, 80),
    category: String(category).slice(0, 32),
    target: target ? String(target).slice(0, 320) : null,
    outcome: ['success', 'failed', 'denied'].includes(outcome) ? outcome : 'failed',
    details_json: detailsJson,
  });
}

export function getActionLogs({
  page = 1,
  pageSize = 50,
  search = '',
  category = '',
  from = null,
  to = null,
} = {}) {
  const conditions = [];
  const values = [];
  const normalizedSearch = String(search).trim().slice(0, 100);
  if (normalizedSearch) {
    const pattern = `%${normalizedSearch}%`;
    conditions.push(`(
      actor_email LIKE ? COLLATE NOCASE OR
      actor_username LIKE ? COLLATE NOCASE OR
      action LIKE ? COLLATE NOCASE OR
      target LIKE ? COLLATE NOCASE OR
      details_json LIKE ? COLLATE NOCASE
    )`);
    values.push(pattern, pattern, pattern, pattern, pattern);
  }
  if (category) {
    conditions.push('category = ?');
    values.push(String(category).slice(0, 32));
  }
  if (Number.isFinite(from)) {
    conditions.push('occurred_at >= ?');
    values.push(from);
  }
  if (Number.isFinite(to)) {
    conditions.push('occurred_at < ?');
    values.push(to);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safePageSize = Math.min(50, Math.max(1, Math.floor(Number(pageSize) || 50)));
  const total = db.prepare(`SELECT COUNT(*) AS count FROM action_logs ${where}`).get(...values).count;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const currentPage = Math.min(safePage, totalPages);
  const records = db.prepare(`
    SELECT id, occurred_at, actor_email, actor_username, actor_role,
           action, category, target, outcome, details_json
    FROM action_logs ${where}
    ORDER BY occurred_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...values, safePageSize, (currentPage - 1) * safePageSize).map(row => {
    let details = {};
    try { details = JSON.parse(row.details_json || '{}'); } catch {}
    return {
      id: row.id,
      occurredAt: row.occurred_at,
      actorEmail: row.actor_email,
      actorUsername: row.actor_username,
      actorRole: row.actor_role,
      action: row.action,
      category: row.category,
      target: row.target,
      outcome: row.outcome,
      details,
    };
  });
  return { records, total, page: currentPage, pageSize: safePageSize };
}

function mapReportRow(row) {
  if (!row) return null;
  let snapshot = {};
  try { snapshot = JSON.parse(row.snapshot_json || '{}'); } catch {}
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    targetType: row.target_type,
    targetKey: row.target_key,
    targetUsername: row.target_username,
    targetEmail: row.target_email,
    reporterEmail: row.reporter_email,
    reporterUsername: row.reporter_username,
    reporterRole: row.reporter_role,
    reason: row.reason,
    note: row.note,
    snapshot,
  };
}

export function createReport(report) {
  const result = db.prepare(`
    INSERT INTO reports (
      created_at, updated_at, status, target_type, target_key, target_username,
      target_email, reporter_email, reporter_username, reporter_role, reason,
      note, snapshot_json
    ) VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    report.createdAt,
    report.createdAt,
    report.targetType,
    report.targetKey,
    report.targetUsername ?? null,
    report.targetEmail ?? null,
    report.reporterEmail,
    report.reporterUsername ?? null,
    report.reporterRole ?? 'user',
    report.reason,
    report.note ?? '',
    JSON.stringify(report.snapshot ?? {}),
  );
  return Number(result.lastInsertRowid);
}

export function hasOpenReport(reporterEmail, targetType, targetKey) {
  return !!db.prepare(`
    SELECT 1 FROM reports
    WHERE reporter_email = ? AND target_type = ? AND target_key = ? AND status = 'open'
    LIMIT 1
  `).get(reporterEmail, targetType, targetKey);
}

export function getOpenReportCount() {
  return db.prepare("SELECT COUNT(*) AS count FROM reports WHERE status = 'open'").get().count;
}

export function getReportStats() {
  return db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END), 0) AS open,
      COALESCE(SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END), 0) AS resolved,
      COALESCE(SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END), 0) AS dismissed
    FROM reports
  `).get();
}

export function getReports({ page = 1, pageSize = 50, status = 'open', search = '' } = {}) {
  const conditions = [];
  const values = [];
  if (status && status !== 'all') {
    conditions.push('status = ?');
    values.push(status);
  }
  const normalizedSearch = String(search).trim().slice(0, 100);
  if (normalizedSearch) {
    const pattern = `%${normalizedSearch}%`;
    conditions.push(`(
      CAST(id AS TEXT) LIKE ? OR
      target_username LIKE ? COLLATE NOCASE OR
      target_email LIKE ? COLLATE NOCASE OR
      reporter_username LIKE ? COLLATE NOCASE OR
      reporter_email LIKE ? COLLATE NOCASE OR
      reason LIKE ? COLLATE NOCASE OR
      note LIKE ? COLLATE NOCASE OR
      snapshot_json LIKE ? COLLATE NOCASE OR
      EXISTS (
        SELECT 1 FROM report_notes rn
        WHERE rn.report_id = reports.id AND rn.note LIKE ? COLLATE NOCASE
      )
    )`);
    values.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safePageSize = Math.min(50, Math.max(1, Math.floor(Number(pageSize) || 50)));
  const total = db.prepare(`SELECT COUNT(*) AS count FROM reports ${where}`).get(...values).count;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const currentPage = Math.min(safePage, totalPages);
  const records = db.prepare(`
    SELECT id, created_at, updated_at, status, target_type, target_key,
           target_username, target_email, reporter_email, reporter_username,
           reporter_role, reason, note
    FROM reports ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...values, safePageSize, (currentPage - 1) * safePageSize).map(row => ({
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    targetType: row.target_type,
    targetKey: row.target_key,
    targetUsername: row.target_username,
    targetEmail: row.target_email,
    reporterEmail: row.reporter_email,
    reporterUsername: row.reporter_username,
    reporterRole: row.reporter_role,
    reason: row.reason,
    note: row.note,
  }));
  return { records, total, page: currentPage, pageSize: safePageSize, totalPages };
}

export function getReportById(id) {
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
  if (!row) return null;
  const report = mapReportRow(row);
  report.internalNotes = db.prepare(`
    SELECT id, occurred_at, actor_email, actor_username, actor_role, note
    FROM report_notes WHERE report_id = ? ORDER BY occurred_at ASC, id ASC
  `).all(id).map(note => ({
    id: note.id,
    occurredAt: note.occurred_at,
    actorEmail: note.actor_email,
    actorUsername: note.actor_username,
    actorRole: note.actor_role,
    note: note.note,
  }));
  return report;
}

export function addReportNote(reportId, note) {
  const occurredAt = Date.now();
  return db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO report_notes (report_id, occurred_at, actor_email, actor_username, actor_role, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(reportId, occurredAt, note.actorEmail, note.actorUsername ?? null, note.actorRole, note.note);
    db.prepare('UPDATE reports SET updated_at = ? WHERE id = ?').run(occurredAt, reportId);
    return { id: Number(result.lastInsertRowid), occurredAt };
  })();
}

export function updateReportStatus(reportId, status) {
  return db.transaction(() => {
    const current = db.prepare('SELECT status FROM reports WHERE id = ?').get(reportId);
    if (!current) return null;
    const updatedAt = Date.now();
    db.prepare('UPDATE reports SET status = ?, updated_at = ? WHERE id = ?').run(status, updatedAt, reportId);
    return { previousStatus: current.status, updatedAt };
  })();
}

export function deleteReport(reportId) {
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
    if (!row) return null;
    db.prepare('DELETE FROM report_notes WHERE report_id = ?').run(reportId);
    db.prepare('DELETE FROM reports WHERE id = ?').run(reportId);
    return mapReportRow(row);
  })();
}

export function setRole(email, role) {
  stmts.setRole.run(email, role);
}

// hidden users

export function isHidden(email) {
  return !!stmts.isHidden.get(email)
}

export function getHiddenUsers() {
  return stmts.getHiddenUsers.all().map(row => row.email.toLowerCase())
}

export function setHidden(email) {
  stmts.setHidden.run(String(email).trim().toLowerCase())
}

export function removeHidden(email) {
  stmts.removeHidden.run(String(email).trim().toLowerCase())
}

// ─── Migration from legacy files ─────────────────────────────────────────────

export async function migrateFromFiles() {
  if (getSetting("migrated_from_files") === "1") return;
  const migrated = [];

  async function tryJSON(path) {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch {
      return null;
    }
  }
  async function tryText(path) {
    try {
      return await readFile(path, "utf8");
    } catch {
      return null;
    }
  }

  if (existsSync("history.json")) {
    const data = await tryJSON("history.json");
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
            });
          } catch {}
        }
      });
      insert();
      migrated.push("history.json");
    }
  }

  if (existsSync("sessions.json")) {
    const data = await tryJSON("sessions.json");
    if (data && typeof data === "object") {
      const insert = db.transaction(() => {
        for (const [id, s] of Object.entries(data)) {
          try {
            stmts.upsertSession.run({
              id,
              email: s.email,
              guest: s.guest ? 1 : 0,
              expires: s.expires ?? null,
              ip: s.ip ?? null,
            });
          } catch {}
        }
      });
      insert();
      migrated.push("sessions.json");
    }
  }

  if (existsSync("colors.json")) {
    const data = await tryJSON("colors.json");
    if (data && typeof data === "object") {
      const insert = db.transaction(() => {
        for (const [email, color] of Object.entries(data)) {
          try {
            stmts.setColor.run(email, color);
          } catch {}
        }
      });
      insert();
      migrated.push("colors.json");
    }
  }

  if (existsSync("mutes.json")) {
    const data = await tryJSON("mutes.json");
    if (data && typeof data === "object") {
      const insert = db.transaction(() => {
        for (const [email, m] of Object.entries(data)) {
          try {
            stmts.setMute.run({
              email,
              reason: m.reason ?? null,
              until: m.until ?? null,
            });
          } catch {}
        }
      });
      insert();
      migrated.push("mutes.json");
    }
  }

  if (existsSync("strikes.json")) {
    const data = await tryJSON("strikes.json");
    if (data && typeof data === "object") {
      const insert = db.transaction(() => {
        for (const [email, count] of Object.entries(data)) {
          try {
            stmts.setStrikes.run(email, count);
          } catch {}
        }
      });
      insert();
      migrated.push("strikes.json");
    }
  }

  if (existsSync("banreasons.json")) {
    const reasons = (await tryJSON("banreasons.json")) ?? {};
    if (existsSync("bans.txt")) {
      const data = await tryText("bans.txt");
      if (data) {
        const insert = db.transaction(() => {
          for (const email of data.split("\n").filter(Boolean)) {
            try {
              stmts.addBan.run(email, reasons[email] ?? null);
            } catch {}
          }
        });
        insert();
        migrated.push("bans.txt", "banreasons.json");
      }
    }
  }

  if (existsSync("ipbans.txt")) {
    const data = await tryText("ipbans.txt");
    if (data) {
      const insert = db.transaction(() => {
        for (const ip of data.split("\n").filter(Boolean)) {
          try {
            stmts.addIpBan.run(ip);
          } catch {}
        }
      });
      insert();
      migrated.push("ipbans.txt");
    }
  }

  if (existsSync("maintenance.json")) {
    const data = await tryJSON("maintenance.json");
    if (data) {
      if (data.maintenance !== undefined)
        setSetting("maintenance", data.maintenance ? "1" : "0");
      if (data.reason !== undefined)
        setSetting("maintenance_reason", data.reason);
      migrated.push("maintenance.json");
    }
  }

  setSetting("migrated_from_files", "1");
  if (migrated.length) {
    console.log(`migrated from legacy files: ${migrated.join(", ")}`);
  }
}
