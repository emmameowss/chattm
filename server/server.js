import "dotenv/config";
import { Server } from "socket.io";
import { createServer } from "http";
import formidable from "formidable";
import { createClerkClient, verifyToken } from "@clerk/backend";
import fetch from "node-fetch";
import { randomBytes } from "crypto";
import { readFile, appendFile, unlink } from "fs/promises";
import { extname, isAbsolute, normalize, resolve, sep } from "path";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import {
  db,
  addActionLog,
  getActionLogs,
  createReport,
  hasOpenReport,
  getReports,
  getReportById,
  addReportNote,
  updateReportStatus,
  deleteReport,
  getHistory,
  addMessage,
  deleteMessage,
  clearMessages,
  getMessageById,
  listChannels,
  channelExists,
  createChannel,
  deleteChannel,
  getSession,
  saveSession,
  deleteSession,
  getColor,
  setColor,
  deleteColor,
  getMute,
  setMute,
  deleteMute,
  getExpiredMutes,
  deleteStrikes,
  isBanned,
  getBanReason,
  getBanIp,
  addBan,
  removeBan,
  isIpBanned,
  addIpBan,
  removeIpBan,
  getSetting,
  setSetting,
  migrateFromFiles,
  deleteAllGuestSessions,
  getLastIpByEmail,
  getStoredUsername,
  saveUsername,
  getEmailByUsername,
  isUsernameTaken,
  getAvatar,
  setAvatar,
  deleteAvatar,
  getCustomEmoji,
  addCustomEmoji,
  removeCustomEmoji,
  isVerified,
  setVerified,
  removeVerified,
  isRedVerified,
  setRedVerified,
  removeRedVerified,
  getProfileData,
  setProfileBio,
  setProfileStatus,
  setProfilePronouns,
  setLastSeen,
  getRecentUsers,
  getDbStats,
  getAllHistory,
  setRole,
  getRole,
  isHidden,
  getHiddenUsers,
  setHidden,
  removeHidden,
} from "./db.js";
import { verifyWebhook } from "@clerk/backend/webhooks"

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: [
      "http://localhost:3000",
      "https://chattm.app",
      "https://beta.chattm.app",
    ],
  },
  maxHttpBufferSize: 1e6,
  pingInterval: 10000,
  pingTimeout: 60000,
});
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Clerk handles all real-account auth. The frontend signs users in with
// clerk-js, then POSTs the resulting session JWT to /clerk-login where we
// verify it here and mint one of our own SQLite sessions.
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

// Origins allowed to present Clerk session tokens to /clerk-login. Set
// CLERK_AUTHORIZED_PARTIES to a comma-separated list of your frontend origins
// (e.g. "https://chat.emmameowss.gay,https://chattm.app") so a token minted for
// another origin can't be replayed against us. Left empty → check is skipped.
const clerkAuthorizedParties = (process.env.CLERK_AUTHORIZED_PARTIES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// migrate from legacy files on first run
await migrateFromFiles();

// Serialize library changes and storage sync so a reload cannot race an upload.
let emojiMutation = Promise.resolve();

async function withEmojiMutation(action) {
  const previous = emojiMutation;
  let release;
  emojiMutation = new Promise(resolve => { release = resolve; });
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

function syncEmojisFromS3() {
  return withEmojiMutation(syncEmojisFromS3Unlocked);
}

function emojiStorageKey(publicUrl) {
  const prefix = (process.env.AWS_S3_PUBLIC_URL || '').replace(/\/+$/, '') + '/';
  if (!publicUrl.startsWith(prefix)) throw new Error('invalid emoji storage URL');
  const key = publicUrl.slice(prefix.length).split('?')[0];
  if (!key.startsWith('emojis/')) throw new Error('invalid emoji storage key');
  return key;
}

function emojiImageType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return {mime: 'image/png', ext: '.png'};
  }
  const gif = buffer.subarray(0, 6).toString('ascii');
  if (gif === 'GIF87a' || gif === 'GIF89a') return {mime: 'image/gif', ext: '.gif'};
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return {mime: 'image/webp', ext: '.webp'};
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) {
    return {mime: 'image/jpeg', ext: '.jpg'};
  }
  return null;
}

// sync emojis from S3 emojis/ folder into DB on startup
async function syncEmojisFromS3Unlocked() {
  if (!process.env.AWS_S3_BUCKET || !process.env.AWS_S3_PUBLIC_URL) return;
  try {
    const existing = getCustomEmoji();
    const found = new Set();
    let continuationToken;
    let added = 0;
    do {
      const res = await s3.send(
        new ListObjectsV2Command({
          Bucket: process.env.AWS_S3_BUCKET,
          Prefix: "emojis/",
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of res.Contents ?? []) {
        const filename = obj.Key.split("/").pop();
        if (!filename) continue;
        const ext = extname(filename);
        const name = filename.slice(0, ext ? -ext.length : undefined);
        if (!name) continue;
        const shortcode = `:${name}:`;
        found.add(shortcode);
        if (!existing[shortcode]) {
          addCustomEmoji(
            shortcode,
            `${process.env.AWS_S3_PUBLIC_URL}/${obj.Key}`,
          );
          added++;
        }
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : null;
    } while (continuationToken);

    // remove DB entries no longer present on S3
    let removed = 0;
    for (const shortcode of Object.keys(existing)) {
      if (!found.has(shortcode)) {
        removeCustomEmoji(shortcode);
        removed++;
      }
    }

    if (added || removed) {
      console.log(`emoji sync: +${added} added, -${removed} removed`);
      io.emit("emojiUpdate", getCustomEmoji());
    }
  } catch (e) {
    console.log("emoji S3 sync failed:", e.message);
  }
}
await syncEmojisFromS3();

const msgcooldown = 1000;
const lastmessage = {};
const MAX_MESSAGE_LENGTH = 2000

const allowedMediaDomains = [
  'cdn.chattm.app',
  'chattm.app',
  'imgur.com', 'i.imgur.com',
  'youtube.com', 'youtu.be',
  'vimeo.com',
  'giphy.com', 'media.giphy.com',
  'tenor.com', 'media.tenor.com',
  'streamable.com',
  'gfycat.com',
  'twitch.tv',
  'spotify.com'
];
try {
  if (process.env.AWS_S3_PUBLIC_URL) {
    const host = new URL(process.env.AWS_S3_PUBLIC_URL).hostname.toLowerCase();
    if (host && !allowedMediaDomains.includes(host)) allowedMediaDomains.push(host);
  }
} catch (e) {
  console.log("couldn't parse AWS_S3_PUBLIC_URL for the media allowlist");
}

const mediaExtensions = /\.(jpg|jpeg|png|gif|webp|bmp|svg|mp4|mov|avi|webm|mkv|flv|wmv|m4v)(\?.*)?$/i;

function isAllowedMediaHost(hostname) {
  return allowedMediaDomains.some(
    (domain) => hostname === domain || hostname.endsWith('.' + domain),
  );
}

function containsBlockedLink(text) {
  if (!text) return false
  const urls = text.match(/(https?:\/\/[^\s]+)/gi) || []

  for (const url of urls) {
    try {
      const urlObj = new URL(url)
      if (!mediaExtensions.test(url)) continue
      if (!isAllowedMediaHost(urlObj.hostname.toLowerCase())) return true
    } catch (e) {
      continue;
    }
  }
  return false
}

function isBlockedImageUrl(image) {
  if (image === undefined || image === null || image === "") return false;
  if (typeof image !== "string") return true;
  try {
    const urlObj = new URL(image);
    if (!["http:", "https:"].includes(urlObj.protocol)) return true;
    return !isAllowedMediaHost(urlObj.hostname.toLowerCase());
  } catch (e) {
    return true;
  }
}

const rateLimits = new Map();
function checkRateLimit(ip, key, max, windowMs) {
  const now = Date.now();
  const k = `${ip}:${key}`;
  const timestamps = (rateLimits.get(k) ?? []).filter(
    (t) => now - t < windowMs,
  );
  if (timestamps.length >= max) return false;
  timestamps.push(now);
  rateLimits.set(k, timestamps);
  return true;
}
setInterval(
  () => {
    const now = Date.now();
    for (const [k, timestamps] of rateLimits) {
      const fresh = timestamps.filter((t) => now - t < 60 * 60 * 1000);
      if (fresh.length === 0) rateLimits.delete(k);
      else rateLimits.set(k, fresh);
    }
    for (const [email, t] of Object.entries(lastmessage)) {
      if (now - t > 60 * 60 * 1000) delete lastmessage[email];
    }
    for (const [sid, entry] of clerkSessionCache) {
      if (now - entry.checkedAt > CLERK_SESSION_TTL) clerkSessionCache.delete(sid);
    }
  },
  10 * 60 * 1000,
);

const STAFF_ACTIONS = {
  ban: { action: "user.ban", category: "moderation" },
  unban: { action: "user.unban", category: "moderation" },
  unbanip: { action: "user.unban_ip", category: "moderation" },
  kick: { action: "user.kick", category: "moderation" },
  mute: { action: "user.mute", category: "moderation" },
  unmute: { action: "user.unmute", category: "moderation" },
  resetstrikes: { action: "user.reset_strikes", category: "moderation" },
  noguests: { action: "guests.disable", category: "settings" },
  allowguests: { action: "guests.enable", category: "settings" },
  reloademojis: { action: "emoji.reload", category: "emoji" },
  setcolor: { action: "user.set_color", category: "moderation" },
  hide: { action: "user.hide", category: "moderation" },
  unhide: { action: "user.unhide", category: "moderation" },
  createchannel: { action: "channel.create", category: "content" },
  deletechannel: { action: "channel.delete", category: "content" },
  deletemessage: { action: "message.delete", category: "content" },
};

function recordStaffAction(socket, command, { target = null, outcome = "success", details = {} } = {}) {
  const definition = STAFF_ACTIONS[command];
  if (!definition || !socket?.userEmail) return;
  try {
    addActionLog({
      actorEmail: socket.userEmail,
      actorUsername: socket.username || getStoredUsername(socket.userEmail),
      actorRole: socket.userRole || getRole(socket.userEmail),
      action: definition.action,
      category: definition.category,
      target,
      outcome,
      details: { source: "chat command", ...details },
    });
  } catch (error) {
    console.error("failed to record staff command:", error);
  }
}

function staffCommandTarget(command, rest) {
  if (command === "unbanip") return "IP ban";
  if (["noguests", "allowguests", "reloademojis"].includes(command)) return null;
  return String(rest || "").trim().split(/\s+/, 1)[0] || null;
}

const commands = {
  "/ban": {
    minRole: "admin",
    run: async (socket, rest, data) => {
      const args = rest.split(" ");
      let target = args[0] || "";
      const banReason = args.slice(1).join(" ") || "no reason given";
      if (!target) {
        recordStaffAction(socket, "ban", { outcome: "failed", details: { reason: banReason } });
        socket.emit("commandError", "usage: /ban <username or email> [reason]", 'error');
        return;
      }
      if (!target.includes("@")) {
        target =
          findSocketByUsername(target)?.userEmail ?? getEmailByUsername(target);
        if (!target) {
          recordStaffAction(socket, "ban", { target: args[0] || null, outcome: "failed", details: { reason: banReason, failure: "target user not found" } });
          socket.emit("commandError", `no user found with username ${args[0]}`, 'error');
          return;
        }
      }
      const targetEmail = target;
      const bannedIp = banIpFor(targetEmail);
      addBan(targetEmail, banReason, bannedIp);
      addIpBan(bannedIp);
      recordStaffAction(socket, "ban", { target: targetEmail, details: { reason: banReason } });
      await appendFile(
        "bans.log",
        `${new Date().toISOString()}: ${socket.userEmail} (${socket.username}) banned ${targetEmail} - reason: ${banReason}\n`,
      );
      for (const [, s] of io.sockets.sockets) {
        if (s.userEmail === targetEmail) {
          s.emit("banned", banReason);
          s.skipLeaveMessage = true;
          s.disconnect();
        }
      }
      socket.emit("commandError", `banned ${targetEmail}`, 'success');
    },
  },
  "/unban": {
    minRole: "admin",
    run: (socket, rest) => {
      removeIpBan(getBanIp(rest));
      removeBan(rest);
      recordStaffAction(socket, "unban", { target: rest || null });
      socket.emit("commandError", `unbanned ${rest}`, 'success');
    },
  },
  "/unbanip": {
    minRole: "admin",
    run: (socket, rest) => {
      removeIpBan(rest);
      recordStaffAction(socket, "unbanip", { target: "IP ban" });
      socket.emit("commandError", `unbanned ${rest}`, 'success');
    },
  },
  "/kick": {
    minRole: "mod",
    run: async (socket, rest, data) => {
      const [targetUsername, ...reasonParts] = rest.split(" ");
      const kickReason = reasonParts.join(" ") || "kicked by server";
      if (!targetUsername) {
        recordStaffAction(socket, "kick", { outcome: "failed" });
        socket.emit("commandError", "usage: /kick <username> [reason]", 'error');
        return;
      }
      const target = findSocketByUsername(targetUsername);
      if (!target) {
        recordStaffAction(socket, "kick", { target: targetUsername, outcome: "failed", details: { reason: kickReason, failure: "target user is not online" } });
        socket.emit(
          "commandError",
          `no user found with username ${targetUsername}`,
          'error',
        );
        return;
      }
      target.emit("kicked", kickReason);
      target.skipLeaveMessage = true;
      target.disconnect();
      recordStaffAction(socket, "kick", { target: targetUsername, details: { reason: kickReason } });
      socket.emit("commandError", `kicked ${targetUsername}`, 'success');
      await appendFile(
        "kicks.log",
        `${new Date().toISOString()}: ${socket.userEmail} (${data.username}) kicked ${targetUsername} - reason: ${kickReason}\n`,
      );
    },
  },
  "/mute": {
    minRole: "mod",
    run: async (socket, rest) => {
      const args = rest.split(" ");
      const targetUsername = args[0];
      const durationStr = args[1];
      const muteReason = args.slice(2).join(" ") || "no reason given";
      const targetEmail =
        findSocketByUsername(targetUsername)?.userEmail ?? null;
      if (!targetEmail) {
        recordStaffAction(socket, "mute", { target: targetUsername || null, outcome: "failed", details: { reason: muteReason, failure: "target user is not online" } });
        socket.emit(
          "commandError",
          `no user found with username ${targetUsername}`,
          'error',
        );
        return;
      }
      const durationMs = durationStr ? parseDuration(durationStr) : null;
      if (durationStr && !durationMs) {
        recordStaffAction(socket, "mute", { target: targetEmail, outcome: "failed", details: { reason: muteReason, duration: durationStr, failure: "invalid duration format" } });
        socket.emit("commandError", "invalid duration format", 'error');
        return;
      }
      setMute(
        targetEmail,
        muteReason,
        durationMs ? Date.now() + durationMs : null,
      );
      recordStaffAction(socket, "mute", { target: targetEmail, details: { reason: muteReason, duration: durationStr || "indefinite" } });
      const m = getMute(targetEmail);
      await appendFile(
        "mutes.log",
        `${new Date().toISOString()}: ${socket.userEmail}`,
      );
      forEachUserSocket(targetEmail, (s) =>
        s.emit("muted", { reason: muteReason, until: m.until }),
      );
      socket.emit(
        "commandError",
        `muted ${targetUsername}${durationStr ? " for " + durationStr : ""}`,
        'success',
      );
    },
  },
  "/unmute": {
    minRole: "mod",
    run: (socket, rest) => {
      const targetUsername = rest;
      const targetEmail =
        findSocketByUsername(targetUsername)?.userEmail ?? null;
      if (!targetEmail || !getMute(targetEmail)) {
        recordStaffAction(socket, "unmute", { target: targetUsername || null, outcome: "failed", details: { failure: "target user is not muted or online" } });
        socket.emit("commandError", `${targetUsername} is not muted`, 'info');
        return;
      }
      deleteMute(targetEmail);
      recordStaffAction(socket, "unmute", { target: targetEmail });
      forEachUserSocket(targetEmail, (s) => s.emit("unmuted"));
      socket.emit("commandError", `unmuted ${targetUsername}`, 'success');
    },
  },
  "/resetstrikes": {
    minRole: "mod",
    run: (socket, rest) => {
      const targetUsername = rest;
      const targetEmail =
        findSocketByUsername(targetUsername)?.userEmail ?? null;
      if (!targetEmail) {
        recordStaffAction(socket, "resetstrikes", { target: targetUsername || null, outcome: "failed", details: { failure: "target user is not online" } });
        socket.emit(
          "commandError",
          `no user found with username ${targetUsername}`,
          'error',
        );
        return;
      }
      deleteStrikes(targetEmail);
      recordStaffAction(socket, "resetstrikes", { target: targetEmail });
      socket.emit("commandError", `reset strikes for ${targetUsername}`, 'success');
    },
  },
  "/noguests": {
    minRole: "owner",
    run: (socket) => {
      guestsDisabled = true;
      setSetting("guests_disabled", "1");
      deleteAllGuestSessions();
      for (const [, s] of io.sockets.sockets) {
        if (s.userEmail?.endsWith("@guest")) {
          s.emit("kicked", "guest logins have been disabled");
          s.skipLeaveMessage = true;
          s.disconnect();
        }
      }
      recordStaffAction(socket, "noguests");
      socket.emit("commandError", "guest logins have been disabled", 'success');
    },
  },
  "/allowguests": {
    minRole: "owner",
    run: (socket) => {
      guestsDisabled = false;
      setSetting("guests_disabled", "0");
      recordStaffAction(socket, "allowguests");
      socket.emit("commandError", "guest logins have been reenabled", 'success');
    },
  },
  "/reloademojis": {
    minRole: "admin",
    run: async (socket) => {
      try {
        await syncEmojisFromS3();
        recordStaffAction(socket, "reloademojis");
        socket.emit("commandError", "emoji sync complete", 'success');
      } catch (error) {
        recordStaffAction(socket, "reloademojis", { outcome: "failed" });
        throw error;
      }
    },
  },
  "/whois": {
    minRole: "owner",
    run: (socket, rest) => {
      const found = findSocketByUsername(rest);
      if (found) {
        socket.emit("commandError", `${rest}: ${found.userEmail}`, 'success');
      } else {
        socket.emit("commandError", `no user found with username "${rest}"`, 'error');
      }
    },
  },
  "/setcolor": {
    minRole: "admin",
    run: (socket, rest) => {
      const args = rest.split(" ");
      const targetUsername = args[0];
      const colorInput = args.slice(1).join(" ").toLowerCase();
      const targetEmail =
        findSocketByUsername(targetUsername)?.userEmail ?? null;
      if (!targetEmail) {
        recordStaffAction(socket, "setcolor", { target: targetUsername || null, outcome: "failed", details: { color: colorInput, failure: "target user is not online" } });
        socket.emit(
          "commandError",
          `no user found with username ${targetUsername}`,
          'error',
        );
        return;
      }
      const flagColors = {
        pride: "flag:pride",
        trans: "flag:trans",
        bi: "flag:bi",
        nb: "flag:nb",
        lesbian: "flag:lesbian",
        gay: "flag:gay",
      };
      const color = flagColors[colorInput] ?? colorInput;
      if (isBlockedColor(color)) {
        recordStaffAction(socket, "setcolor", { target: targetEmail, outcome: "failed", details: { color, failure: "color is blocked" } });
        socket.emit("commandError", "please choose another color", 'error');
        return;
      }
      setColor(targetEmail, color);
      recordStaffAction(socket, "setcolor", { target: targetEmail, details: { color } });
      forEachUserSocket(targetEmail, (s) => s.emit("colorChanged", color));
      emitAllUserLists();
      socket.emit("commandError", `set ${targetUsername}'s color to ${color}`, 'success');
    },
  },
  "/nick": {
    minRole: "user",
    run: (socket, rest) => {
      const nick = rest;
      if (!isValidUsername(nick)) {
        socket.emit("commandError", "invalid username", 'error');
        return;
      }
      if (socket.userEmail.endsWith("@guest")) {
        socket.emit("commandError", "guests cannot change their username", 'error');
        return;
      }
      if (usernameTaken(nick, socket.userEmail)) {
        socket.emit("commandError", `the username "${nick}" is already taken`, 'error');
        return;
      }
      const prevUser = socket.username;
      socket.username = nick;
      saveUsername(socket.userEmail, nick);
      if (prevUser && prevUser !== nick) {
        socket.emit("userRenamed", { from: prevUser, to: nick });
      }
      emitAllUserLists();
    },
  },
  "/color": {
    minRole: "user",
    run: (socket, rest) => {
      const colorinput = rest.toLowerCase();
      const prideFlags = {
        pride: "flag:pride",
        rainbow: "flag:pride",
        gay: "flag:gay",
        trans: "flag:trans",
        transgender: "flag:trans",
        bi: "flag:bi",
        bisexual: "flag:bi",
        lesbian: "flag:lesbian",
        nb: "flag:nb",
        nonbinary: "flag:nb",
        enby: "flag:nb",
      };
      const color = prideFlags[colorinput] ?? colorinput;
      if (isBlockedColor(color)) {
        socket.emit("commandError", "please choose a different color", 'error');
        return;
      }
      setColor(socket.userEmail, color);
      socket.cachedColor = color;
      socket.emit("colorChanged", color);
      emitAllUserLists();
    },
  },
  "/hide": {
    minRole: 'admin',
    run: (socket, rest) => {
      const targetEmail = findSocketByUsername(rest)?.userEmail ?? getEmailByUsername(rest)
      if (!targetEmail) {
        recordStaffAction(socket, "hide", { target: rest || null, outcome: "failed", details: { failure: "target user not found" } });
        socket.emit('commandError', `no user found with username ${rest}`, 'error')
        return
      }
      setHidden(targetEmail)
      recordStaffAction(socket, "hide", { target: targetEmail });
      emitAllUserLists()
      socket.emit('commandError', `hid ${rest} from user list`, 'success')
    },
  },
  "/unhide": {
    minRole: 'admin',
    run: (socket, rest) => {
      const targetEmail = findSocketByUsername(rest)?.userEmail ?? getEmailByUsername(rest)
      if (!targetEmail) {
        recordStaffAction(socket, "unhide", { target: rest || null, outcome: "failed", details: { failure: "target user not found" } });
        socket.emit('commandError', `no user found with username ${rest}`, 'error')
        return
      }
      removeHidden(targetEmail)
      recordStaffAction(socket, "unhide", { target: targetEmail });
      emitAllUserLists()
      socket.emit('commandError', `unhid ${rest} on user list`, 'success')
    },
  },
};

commands["/colour"] = commands["/color"];

let chatMuted = getSetting("chat_muted") === "1";
let guestsDisabled = getSetting("guests_disabled") === "1";
let status = "";
let maintenance = getSetting("maintenance") === "1";
let reason = getSetting("maintenance_reason") ?? "";
const PORT = process.env.PORT || 3000;
let versionCache = null;
let versionCacheTime = 0;
let statsCache = null;
let statsCacheTime = 0;
let statsFetchPromise = null;
let messagesCache = null;

const types = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function sessionCookie(id, req) {
  const secure =
    (req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
  return `session=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${
    secure ? "; Secure" : ""
  }`;
}

function clearSessionCookie() {
  return "session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// read a standalone page from ../app and substitute <!--TOKEN--> placeholders
async function renderPage(file, replacements = {}) {
  let html = await readFile(resolve(process.cwd(), "../app", file), "utf8");
  for (const [token, value] of Object.entries(replacements)) {
    html = html.split(`<!--${token}-->`).join(value);
  }
  return html;
}

function requireAdminPage(req, res) {
  const user = getRequestUser(req)
  const role = user ? getRole(user.email) : "user"
  if (!user || !["admin", "owner"].includes(role)) {
    res.writeHead(302, { Location: '/' })
    res.end()
    return null;
  }
  return { user, role }
}

function requireStaffPage(req, res) {
  const user = getRequestUser(req);
  const role = user ? getRole(user.email) : "user";
  if (!user || !["mod", "admin", "owner"].includes(role)) {
    res.writeHead(302, { Location: "/" });
    res.end();
    return null;
  }
  return { user, role };
}

function renderAdminNav(role, activePath = "") {
  const items = [
    ["/admin", "layout-dashboard", "overview"],
    ["/admin/users", "users", "users"],
    ["/admin/emoji", "mood-smile", "emoji"],
    ["/admin/logs", "list-details", "logs"],
    ["/admin/reports", "flag", "reports"],
  ];
  const visibleItems = role === "mod" ? items.filter(([href]) => href === "/admin/reports") : items;
  return visibleItems.map(([href, icon, label]) => {
    const active = href === activePath;
    return `<a href="${href}"${active ? ' class="active" aria-current="page"' : ""}><i class="ti ti-${icon}" aria-hidden="true"></i>${label}</a>`;
  }).join("");
}

async function readJsonRequest(req, maxBytes = 16 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    let tooLarge = false;
    req.on("data", chunk => {
      if (tooLarge) return;
      if (Buffer.byteLength(body) + chunk.length > maxBytes) {
        tooLarge = true;
        body = "";
        return;
      }
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (tooLarge) {
        const error = new Error("request body too large");
        error.statusCode = 413;
        rejectBody(error);
        return;
      }
      try {
        resolveBody(body ? JSON.parse(body) : {});
      } catch {
        const error = new Error("invalid JSON body");
        error.statusCode = 400;
        rejectBody(error);
      }
    });
    req.on("error", rejectBody);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function recordReportAction(user, role, action, target, outcome = "success", details = {}) {
  if (!user?.email) return;
  const actorEmail = normalizeEmail(user.email);
  try {
    addActionLog({
      actorEmail,
      actorUsername: getStoredUsername(actorEmail) || actorEmail.split("@")[0],
      actorRole: role || "user",
      action,
      category: "moderation",
      target: target || null,
      outcome,
      details,
    });
  } catch (error) {
    console.error("failed to record report action:", error);
  }
}

// resolve the cookie session, mirroring the socket middleware's guest-expiry check
function getRequestUser(req) {
  const sessionId = parseCookies(req).session;
  if (!sessionId) return null;
  const user = getSession(sessionId);
  if (!user) return null;
  if (user.guest) {
    const today = new Date().toISOString().slice(0, 10);
    if (user.expires !== today) return null;
  }
  return user;
}

function isDevRequest(req) {
  const hostname = (req.headers.host || "").split(":")[0]
  return ["localhost", "127.0.0.1", "beta.chattm.app"].includes(hostname)
}

function getClerkKey(req) {
  return (
    (isDevRequest(req) ? process.env.CLERK_PUBLISHABLE_KEY_DEV : null) ||
    process.env.CLERK_PUBLISHABLE_KEY
  )
}

function isBlockedColor(color) {
  const lower = color.toLowerCase();
  // block near-white (unreadable on light surfaces)
  if (lower === "#e8e8e8") return true;
  // block any hex color too dark to read on #0e0e0e background
  const hex = lower.replace("#", "");
  let r, g, b;
  if (/^[0-9a-f]{3}$/.test(hex)) {
    r = parseInt(hex[0], 16) * 17;
    g = parseInt(hex[1], 16) * 17;
    b = parseInt(hex[2], 16) * 17;
  } else if (/^[0-9a-f]{6}$/.test(hex)) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else {
    return false;
  }
  return r < 55 && g < 55 && b < 55;
}

console.log(`loaded ${getHistory().length} messages in history`);

async function getVersionStatus(forceRefresh = false) {
  if (
    !forceRefresh &&
    versionCache &&
    Date.now() - versionCacheTime < 10 * 60 * 1000
  ) {
    return versionCache;
  }
  let result;
  try {
    const localCommit = execSync("git rev-parse HEAD", { cwd: ".." })
      .toString()
      .trim();
    const localCommitDate = execSync("git show -s --format=%cI HEAD", {
      cwd: "..",
    })
      .toString()
      .trim();
    const res = await fetch(
      "https://api.github.com/repos/emmameowss/chattm/commits?per_page=50",
    );
    const commits = await res.json();
    const localIndex = commits.findIndex((c) => c.sha === localCommit);
    const currentCommit = localCommit.slice(0, 7);

    if (localIndex === -1) {
      const latestRemoteDate = commits[0]?.commit?.committer?.date;
      if (
        latestRemoteDate &&
        new Date(localCommitDate) > new Date(latestRemoteDate)
      ) {
        let ahead = 0;
        try {
          ahead = parseInt(
            execSync(`git rev-list --count origin/main..HEAD`, { cwd: ".." })
              .toString()
              .trim(),
          );
        } catch (e) {
          ahead = "1+";
        }
        result = {
          upToDate: false,
          ahead,
          latestCommit: commits[0]?.sha?.slice(0, 7),
          currentCommit,
        };
      } else {
        result = {
          upToDate: false,
          behind: "50+",
          latestCommit: commits[0]?.sha?.slice(0, 7),
          currentCommit,
        };
      }
    } else {
      result = {
        upToDate: localIndex === 0,
        behind: localIndex,
        latestCommit: commits[0]?.sha?.slice(0, 7),
        currentCommit,
      };
    }
  } catch (e) {
    result = { upToDate: null, behind: null, error: e.message };
  }
  versionCache = result;
  versionCacheTime = Date.now();
  return result;
}

function isMuted(email) {
  const m = getMute(email);
  if (!m) return false;
  if (m.until && Date.now() > m.until) {
    deleteMute(email);
    return false;
  }
  return true;
}

function parseDuration(str) {
  const match = str.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;
  const num = parseInt(match[1]);
  const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]];
  return num * unit;
}

function isValidUsername(name) {
  return /^[a-zA-Z0-9- ]{1,20}$/.test(name) && name.trim() === name && !name.includes("  ") && name !== "pending";
}
// Clerk accounts use the raw (normalized) email as their in-app identity, so
// every command / lookup treats them identically
function normalizeEmail(email) {
  return String(email ?? "")
    .trim()
    .toLowerCase();
}

setInterval(() => {
  const expired = getExpiredMutes(Date.now());
  for (const email of expired) {
    deleteMute(email);
    for (const [id, s] of io.sockets.sockets) {
      if (s.userEmail === email) {
        s.emit("unmuted");
      }
    }
  }
  if (expired.length) {
    for (const s of io.sockets.sockets.values()) {
      if (["admin", "owner"].includes(s.userRole)) s.emit("adminUsersChanged");
    }
  }
}, 10 * 1000);

const roomOf = (ch) => "channel:" + ch;

function onlineUserCount() {
  const onlineEmails = new Set();
  for (const socket of io.sockets.sockets.values()) {
    if (socket.username && socket.userEmail) onlineEmails.add(socket.userEmail);
  }
  return onlineEmails.size;
}

function emitOnlineUserCount() {
  io.emit("usercount", onlineUserCount());
}

function emitAllUserLists() {
  for (const c of listChannels()) emitUserList(c.name);
}

function buildUserList(channel = "main", includeHidden = false) {
  const onlineEmails = new Set();
  const onlineUsers = new Map();

  for (const [id, s] of io.sockets.sockets) {
    if (!s.username) continue;
    if (channel !== null && s.currentChannel !== channel) continue;
    if (!onlineUsers.has(s.userEmail)) {
      onlineEmails.add(s.userEmail);
      onlineUsers.set(s.userEmail, {
        username: s.username,
        email: s.userEmail,
        color: s.cachedColor ?? null,
        avatar: s.cachedAvatar ?? null,
        guest: s.userEmail.endsWith("@guest"),
        isOwner: s.userRole === "owner",
        role: s.userRole ?? "user",
        verified: s.cachedVerified ?? false,
        redVerified: s.cachedRedVerified ?? false,
        status: s.cachedStatus ?? "online",
        online: true,
      });
    }
  }

  const users = Array.from(onlineUsers.values())

  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const row of getRecentUsers(cutoff)) {
    if (onlineEmails.has(row.email)) continue;
    users.push({
      username: row.username,
      email: row.email,
      color: row.color ?? null,
      avatar: row.avatar ?? null,
      guest: false,
      isOwner: row.role === "owner",
      role: row.role ?? "user",
      verified: !!row.verified,
      redVerified: !!row.red_verified,
      status: row.status ?? "online",
      online: false,
    });
  }

  return includeHidden ? users : users.filter((u) => !isHidden(u.email));
}

let adminClerkUsersCache = { expiresAt: 0, users: null, promise: null };

async function getAllClerkUsers() {
  if (adminClerkUsersCache.users && adminClerkUsersCache.expiresAt > Date.now()) {
    return adminClerkUsersCache.users;
  }
  if (adminClerkUsersCache.promise) return adminClerkUsersCache.promise;

  adminClerkUsersCache.promise = (async () => {
    const users = [];
    let offset = 0;
    const limit = 500;

    while (true) {
      const page = await clerk.users.getUserList({ limit, offset });
      users.push(...(page.data ?? []));
      offset += page.data?.length ?? 0;
      if (!page.data?.length || offset >= page.totalCount) break;
    }

    adminClerkUsersCache = {
      users,
      expiresAt: Date.now() + 60_000,
      promise: null,
    };
    return users;
  })().catch((e) => {
    adminClerkUsersCache.promise = null;
    throw e;
  });

  return adminClerkUsersCache.promise;
}

async function getActiveClerkSessions(userId) {
  const sessions = [];
  let offset = 0;
  while (true) {
    const page = await clerk.sessions.getSessionList({ userId, status: 'active', limit: 500, offset });
    sessions.push(...page.data);
    offset += page.data.length;
    if (!page.data.length || offset >= page.totalCount) break;
  }
  return sessions;
}

async function buildAdminUserList() {
  const usersByEmail = new Map(
    buildUserList(null, true).map((user) => [user.email, user]),
  );

  for (const clerkUser of await getAllClerkUsers()) {
    const primaryEmail = clerkUser.emailAddresses.find(
      (address) => address.id === clerkUser.primaryEmailAddressId,
    )?.emailAddress;
    if (!primaryEmail) continue;

    const email = normalizeEmail(primaryEmail);
    const role = getRole(email);
    const current = usersByEmail.get(email);
    const clerkAvatar = clerkUser.hasImage ? clerkUser.imageUrl : null;
    if (clerkAvatar && getAvatar(email) !== clerkAvatar) {
      setAvatar(email, clerkAvatar);
    }
    usersByEmail.set(email, {
      username:
        current?.username ??
        getStoredUsername(email) ??
        clerkUser.username ??
        email.split("@")[0],
      email,
      color: current?.color ?? getColor(email) ?? null,
      avatar: clerkAvatar ?? current?.avatar ?? getAvatar(email) ?? null,
      guest: false,
      isOwner: role === "owner",
      role,
      verified: current?.verified ?? isVerified(email),
      redVerified: current?.redVerified ?? isRedVerified(email),
      status: current?.status ?? getProfileData(email).status ?? "offline",
      online: current?.online ?? false,
    });
  }

  for (const email of getHiddenUsers()) {
    if (!email.endsWith("@guest") || usersByEmail.has(email)) continue;
    usersByEmail.set(email, {
      username: getStoredUsername(email) ?? email.slice(0, -"@guest".length),
      email,
      color: getColor(email) ?? null,
      avatar: getAvatar(email) ?? null,
      guest: true,
      isOwner: false,
      role: "user",
      verified: false,
      redVerified: false,
      status: "offline",
      online: false,
    });
  }

  return adminModerationFlags([...usersByEmail.values()]);
}

// Only admin responses include moderation flags; public channel lists stay unchanged.
function adminModerationFlags(users) {
  return users.map((user) => {
    const mute = getMute(user.email);
    const muted = !!mute && (mute.until === null || mute.until > Date.now());
    return { ...user, banned: isBanned(user.email), muted, muteUntil: muted ? mute.until : null, hidden: isHidden(user.email) };
  });
}

function paginateAdminUsers(users, request = {}) {
  const views = new Set(["all", "online", "muted", "banned", "hidden"]);
  const roles = new Set(["user", "mod", "admin", "owner"]);
  const view = views.has(request.view) ? request.view : "all";
  const role = roles.has(request.role) ? request.role : "all";
  const type = ["guest", "registered"].includes(request.type) ? request.type : "all";
  const sort = ["online", "asc", "desc"].includes(request.sort) ? request.sort : "online";
  const query = typeof request.query === "string" ? request.query.trim().toLocaleLowerCase() : "";
  const pageSizeValue = Number(request.pageSize);
  const pageSize = Number.isFinite(pageSizeValue) ? Math.max(10, Math.min(100, Math.floor(pageSizeValue))) : 50;
  const requestedPage = Number(request.page);
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1;
  const selectedEmail = typeof request.selectedEmail === "string" ? normalizeEmail(request.selectedEmail) : null;
  const selectedUser = selectedEmail ? users.find(user => user.email === selectedEmail) ?? null : null;
  const counts = {
    all: users.length,
    online: users.filter(user => user.online).length,
    muted: users.filter(user => user.muted).length,
    banned: users.filter(user => user.banned).length,
    hidden: users.filter(user => user.hidden).length,
  };
  const visibleUsers = users.filter(user => {
    if (view === "online" && !user.online) return false;
    if (view === "muted" && !user.muted) return false;
    if (view === "banned" && !user.banned) return false;
    if (view === "hidden" && !user.hidden) return false;
    if (role !== "all" && user.role !== role) return false;
    if (type === "guest" && !user.guest) return false;
    if (type === "registered" && user.guest) return false;
    if (query && !`${user.username} ${user.email}`.toLocaleLowerCase().includes(query)) return false;
    return true;
  });
  const byName = (a, b) =>
    (a.username || a.email).localeCompare(b.username || b.email, undefined, { sensitivity: "base", numeric: true }) ||
    a.email.localeCompare(b.email);
  visibleUsers.sort((a, b) => sort === "online"
    ? Number(b.online) - Number(a.online) || byName(a, b)
    : sort === "desc" ? -byName(a, b) : byName(a, b));
  const totalPages = Math.max(1, Math.ceil(visibleUsers.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const requestId = Number.isSafeInteger(request.requestId) ? request.requestId : null;
  return {
    users: visibleUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    total: visibleUsers.length,
    totalUsers: users.length,
    page: currentPage,
    pageSize,
    totalPages,
    counts,
    requestId,
    selectedUser,
  };
}

function emitUserList(channel = "main") {
  const users = buildUserList(channel);
  const publicUsers = users.map(({ email, ...rest }) => rest);
  io.to(roomOf(channel)).emit("userlist", publicUsers);

  for (const [, s] of io.sockets.sockets) {
    if (
      ["admin", "owner"].includes(s.userRole) &&
      s.username &&
      s.currentChannel === channel
    ) {
      s.emit("adminUsersChanged");
      s.emit('uRole', getRole(s.userEmail))
    }
  }
}

// Clerk is the source of truth for session lifetime. Our SQLite session lives
// independently, so a Clerk session that expires (or is revoked) would leave
// the chat session valid forever. Reconcile by checking the Clerk session's
// status; cache results briefly so reconnect storms don't hammer the API.
const clerkSessionCache = new Map(); // sid -> { active, checkedAt }
const CLERK_SESSION_TTL = 60 * 1000;
async function isClerkSessionActive(sid) {
  const cached = clerkSessionCache.get(sid);
  if (cached && Date.now() - cached.checkedAt < CLERK_SESSION_TTL)
    return cached.active;
  let active;
  try {
    const s = await clerk.sessions.getSession(sid);
    active = s.status === "active";
  } catch (e) {
    // 404 → session no longer exists (expired/removed). Treat any hard 4xx as
    // inactive; on transient/unknown errors fail open so we don't lock users
    // out during a Clerk outage.
    if (e?.status === 404) active = false;
    else if (e?.status >= 400 && e?.status < 500) active = false;
    else {
      console.error("clerk session check failed:", e);
      active = true;
    }
  }
  clerkSessionCache.set(sid, { active, checkedAt: Date.now() });
  return active;
}

io.use(async (socket, next) => {
  const ip =
    socket.handshake.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    socket.handshake.address;
  if (!checkRateLimit(ip, "connect", 20, 60 * 1000))
    return next(new Error("rate limited"));
  const sessionId = socket.handshake.auth.session;
  const user = getSession(sessionId);
  if (!user) return next(new Error("not authenticated"));
  // a signed-in (non-guest) user whose Clerk session has expired/been revoked
  // loses the chat session too
  if (!user.guest && user.clerkSessionId) {
    if (!(await isClerkSessionActive(user.clerkSessionId))) {
      deleteSession(sessionId);
      return next(new Error("session expired"));
    }
  }
  if (isBanned(user.email)) {
    const err = new Error("banned");
    err.data = { reason: getBanReason(user.email) || "no reason given" };
    return next(err);
  }
  if (isIpBanned(ip)) return next(new Error("banned"));

  // guest expiry stuff
  if (user.guest) {
    const today = new Date().toISOString().slice(0, 10);
    if (user.expires !== today) {
      deleteSession(sessionId);
      return next(new Error("not authenticated"));
    }
  }
  socket.userEmail = user.email;
  socket.clerkId = user.clerkId ?? null;
  socket.clerkSessionId = user.clerkSessionId ?? null;
  socket.userRole = getRole(user.email);
  socket.username = null;
  if (maintenance && !["mod", "admin", "owner"].includes(socket.userRole)) {
    return next(new Error("maintenance"));
  }
  next();
});

function usernameTaken(name, email) {
  const lower = name.toLowerCase();
  for (const [, s] of io.sockets.sockets) {
    if (s.userEmail !== email && s.username?.toLowerCase() === lower) return true;
  }
  return isUsernameTaken(name, email);
}

function banIpFor(email) {
  for (const [, s] of io.sockets.sockets) {
    if (s.userEmail === email && s.userIP) return s.userIP;
  }
  return getLastIpByEmail(email);
}

function findSocketByUsername(name) {
  for (const [, s] of io.sockets.sockets) {
    if (s.username === name) return s;
  }
  return null;
}

function emitToUser(email, event, ...args) {
  for (const [, s] of io.sockets.sockets) {
    if (s.userEmail === email) s.emit(event, ...args);
  }
}

function forEachUserSocket(email, callback) {
  for (const [, s] of io.sockets.sockets) {
    if (s.userEmail === email) callback(s);
  }
}

io.on("connection", (socket) => {
  socket.userIP =
    socket.handshake.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    socket.handshake.address;
  console.log(`${socket.userEmail} connected`);
  if (!socket.userEmail.endsWith("@guest")) setLastSeen(socket.userEmail);
  emitOnlineUserCount();
  // everyone starts in the default channel
  socket.currentChannel = "main";
  socket.join(roomOf("main"));
  // send emoji map before history so shortcodes render correctly
  socket.emit("emoji", getCustomEmoji());
  socket.emit(
    "channels",
    listChannels().map((c) => c.name),
  );
  // strip ownerEmail before sending history to client
  socket.emit(
    "history",
    getHistory(socket.currentChannel).map(({ ownerEmail, ...m }) => m),
  );
  socket.emit("init", {
    isOwner: ["owner"].includes(socket.userRole),
    role: socket.userRole ?? 'user',
    chatMuted,
    currentChannel: socket.currentChannel,
    uMuted: isMuted(socket.userEmail) ? getMute(socket.userEmail) : null,
    color: getColor(socket.userEmail),
  });
  if (status) socket.emit("status", status);
  // check blocked colors on connect
  const currentColor = getColor(socket.userEmail);
  if (currentColor && isBlockedColor(currentColor)) {
    deleteColor(socket.userEmail);
  }

  if (socket.userEmail.endsWith("@guest")) {
    const saved = getStoredUsername(socket.userEmail);
    const guestUsername = saved || socket.userEmail.replace("@guest", "");
    socket.username = guestUsername;
    socket.emit("savedUsername", guestUsername);
    emitUserList(socket.currentChannel);
  } else {
    const saved = getStoredUsername(socket.userEmail);
    if (saved) socket.username = saved;
    socket.emit("savedUsername", saved);
  }
  socket.cachedAvatar = getAvatar(socket.userEmail);
  socket.cachedColor = getColor(socket.userEmail);
  socket.cachedVerified = isVerified(socket.userEmail);
  socket.cachedRedVerified = isRedVerified(socket.userEmail);
  socket.cachedStatus = getProfileData(socket.userEmail).status ?? "online";
  socket.emit("savedAvatar", socket.cachedAvatar);
  socket.emit("savedProfile", getProfileData(socket.userEmail));

  socket.on("setStatus", (status) => {
    const s = String(status ?? "").slice(0, 100);
    setProfileStatus(socket.userEmail, s);
    socket.cachedStatus = s;
    emitUserList(socket.currentChannel);
    socket.emit("savedProfile", getProfileData(socket.userEmail));
  });

  socket.on("setBio", (bio) => {
    if (socket.userEmail.endsWith("@guest")) return;
    const b = String(bio ?? "").slice(0, 300);
    setProfileBio(socket.userEmail, b);
    socket.emit("savedProfile", getProfileData(socket.userEmail));
  });

  socket.on("setPronouns", (pronouns) => {
    if (socket.userEmail.endsWith("@guest")) return;
    const p = String(pronouns ?? "").slice(0, 40);
    setProfilePronouns(socket.userEmail, p);
    socket.emit("savedProfile", getProfileData(socket.userEmail));
  });

  socket.on("getAdminUsers", async (request = {}) => {
    if (!["admin", "owner"].includes(socket.userRole ?? "user")) return;
    const filters = request && typeof request === "object" && !Array.isArray(request) ? request : {};
    let users;
    let partial = false;
    try {
      users = await buildAdminUserList();
    } catch (e) {
      console.error("failed to load admin user list:", e);
      users = adminModerationFlags(buildUserList(null, true));
      partial = true;
    }
    socket.emit("adminUserlist", { ...paginateAdminUsers(users, filters), partial });
    socket.emit('adminIdentity', { email: socket.userEmail, role: getRole(socket.userEmail) });
    socket.emit('uRole', getRole(socket.userEmail));
  });

  socket.on("getProfile", (reqUsername) => {
    if (!reqUsername || typeof reqUsername !== "string") {
      socket.emit("profileData", null);
      return;
    }
    try {
      let email = null;
      for (const [, s] of io.sockets.sockets) {
        if (s.username === reqUsername) {
          email = s.userEmail;
          break;
        }
      }
      if (!email) email = getEmailByUsername(reqUsername);
      // guests: username is "guest-xxxxx", email is "guest-xxxxx@guest"
      if (!email && /^guest-[a-f0-9]+$/.test(reqUsername))
        email = `${reqUsername}@guest`;
      if (!email) {
        socket.emit("profileData", null);
        return;
      }
      const profile = getProfileData(email);
      const role = getRole(email)
      const isOnline = [...io.sockets.sockets.values()].some(
        (s) => s.userEmail === email && s.username,
      );
      socket.emit("profileData", {
        username: reqUsername,
        bio: email.endsWith("@guest")
          ? "i'm a guest on chat™"
          : (profile.bio ?? ""),
        status: profile.status ?? "",
        pronouns: email.endsWith("@guest") ? "" : (profile.pronouns ?? ""),
        color: getColor(email),
        avatar: getAvatar(email),
        verified: isVerified(email),
        redVerified: isRedVerified(email),
        role,
        isOwner: role === "owner",
        isGuest: email.endsWith("@guest"),
        online: isOnline,
        lastSeen: isOnline ? null : (profile.lastSeen ?? null),
      });
    } catch (e) {
      console.error("getProfile error:", e);
      socket.emit("profileData", null);
    }
  });

  // Profile pictures live in Clerk. The client uploads or removes the image
  // via clerk-js, then asks us to re-sync. We read the authoritative image URL
  // straight from Clerk (never trusting a client-supplied URL) so a user can't
  // spoof someone else's picture.
  socket.on("refreshAvatar", async () => {
    if (socket.userEmail.endsWith("@guest")) return;
    try {
      // sessions minted before we stored the Clerk id fall back to an email
      // lookup (then cache it so subsequent refreshes are cheap)
      if (!socket.clerkId) {
        const list = await clerk.users.getUserList({
          emailAddress: [socket.userEmail],
          limit: 1,
        });
        socket.clerkId = list.data?.[0]?.id ?? null;
      }
      if (!socket.clerkId) return;
      const u = await clerk.users.getUser(socket.clerkId);
      const url = u.hasImage ? u.imageUrl : null;
      if (url) setAvatar(socket.userEmail, url);
      else deleteAvatar(socket.userEmail);
      socket.cachedAvatar = url;
      socket.emit("savedAvatar", url);
      emitUserList(socket.currentChannel);
    } catch (e) {
      console.error("refreshAvatar failed:", e);
    }
  });

  socket.on("setUsername", (name) => {
    if (!isValidUsername(name)) {
      if (name === 'pending') {
        socket.emit('commandError', 'you cannot set your username to "pending"', 'error')
      } else {
        socket.emit(
          "commandError",
          "invalid username, make sure it's within the character limit and uses only letters and numbers",
          'error',
        );
      }
      return;
    }
    if (usernameTaken(name, socket.userEmail)) {
      socket.emit("commandError", `the username "${name}" is already taken`, 'error');
      socket.emit("usernameTaken", name);
      return;
    }
    const prevUser = socket.username;
    socket.username = name;
    if (prevUser !== name) emitOnlineUserCount();
    if (!socket.userEmail.endsWith("@guest")) {
      saveUsername(socket.userEmail, name);
    }
    const isGuest = socket.userEmail.endsWith("@guest");
    if (prevUser && prevUser !== name && !isGuest) {
      socket.broadcast.emit("userRenamedSys", { from: prevUser, to: name });
      socket.emit("userRenamed", { from: prevUser, to: name });
    }
    emitAllUserLists();
  });

  socket.on("typing", () => {
    if (!socket.username) return;
    socket.to(roomOf(socket.currentChannel)).emit("typing", socket.username);
  });

  socket.on("stopTyping", () => {
    socket
      .to(roomOf(socket.currentChannel))
      .emit("stopTyping", socket.username);
  });

  socket.on("userActive", () => {
    if (socket.username && !socket.hasJoined) {
      socket.hasJoined = true;
    }
  });

  socket.on("disconnect", () => {
    emitOnlineUserCount();
    emitUserList(socket.currentChannel);
  });

  socket.on("deleteMessage", (messageId) => {
    const history = getHistory(socket.currentChannel);
    const msg = history.find((m) => m.id === messageId);
    if (!msg) {
      if (["mod", "admin", "owner"].includes(socket.userRole)) {
        recordStaffAction(socket, "deletemessage", {
          target: "message",
          outcome: "failed",
          details: { channel: socket.currentChannel, failure: "message not found" },
        });
      }
      return;
    }

    const isOwnerOfMsg = msg.ownerEmail === socket.userEmail;
    const isAdmin = ['mod', 'admin', 'owner'].includes(socket.userRole);

    if (!isOwnerOfMsg && !isAdmin) {
      recordStaffAction(socket, "deletemessage", {
        target: msg.ownerEmail || null,
        outcome: "denied",
        details: { channel: socket.currentChannel },
      });
      socket.emit("commandError", "you can only delete your own messages", 'error');
      return;
    }
    deleteMessage(messageId);
    if (!isOwnerOfMsg) {
      recordStaffAction(socket, "deletemessage", {
        target: msg.ownerEmail || null,
        details: { channel: socket.currentChannel, messageId },
      });
    }
    io.to(roomOf(socket.currentChannel)).emit("messageDeleted", messageId);
  });

  socket.on("switchChannel", (name) => {
    if (typeof name !== "string" || !channelExists(name)) return;
    const prev = socket.currentChannel;
    if (prev === name) return;
    socket.to(roomOf(prev)).emit("stopTyping", socket.username);
    socket.leave(roomOf(prev));
    socket.join(roomOf(name));
    socket.currentChannel = name;
    socket.emit(
      "history",
      getHistory(name).map(({ ownerEmail, ...m }) => m),
    );
    socket.emit("switchedChannel", name);
    // presence changed in both the old and the new channel
    emitUserList(prev);
    emitUserList(name);
  });

  socket.on("createChannel", (rawName) => {
    if (!['owner'].includes(socket.userRole)) {
      recordStaffAction(socket, "createchannel", { target: String(rawName ?? "").slice(0, 80), outcome: "denied" });
      return;
    }
    const name = String(rawName ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-");
    if (!/^[a-z0-9-]{1,24}$/.test(name)) {
      recordStaffAction(socket, "createchannel", { target: name || null, outcome: "failed", details: { failure: "invalid channel name" } });
      return socket.emit(
        "commandError",
        "invalid channel name (use a-z, 0-9, - ; max 24)",
        'error'
      );
    }
    if (channelExists(name)) {
      recordStaffAction(socket, "createchannel", { target: name, outcome: "failed", details: { failure: "channel already exists" } });
      return socket.emit("commandError", "channel already exists", 'error');
    }
    createChannel(name, socket.userEmail);
    recordStaffAction(socket, "createchannel", { target: name });
    io.emit(
      "channels",
      listChannels().map((c) => c.name),
    );
  });

  socket.on("deleteChannel", (rawName) => {
    if (!["owner"].includes(socket.userRole)) {
      recordStaffAction(socket, "deletechannel", { target: String(rawName ?? "").slice(0, 80), outcome: "denied" });
      return;
    }
    const name = String(rawName ?? "")
      .trim()
      .toLowerCase();
    if (name === "main") {
      recordStaffAction(socket, "deletechannel", { target: name, outcome: "failed", details: { failure: "the main channel cannot be deleted" } });
      return socket.emit("commandError", "the main channel cannot be deleted", 'error');
    }
    if (!channelExists(name)) {
      recordStaffAction(socket, "deletechannel", { target: name || null, outcome: "failed", details: { failure: "channel not found" } });
      return;
    }
    const messagesRemoved = db.prepare("SELECT COUNT(*) AS count FROM messages WHERE channel = ?").get(name).count;
    deleteChannel(name);
    recordStaffAction(socket, "deletechannel", { target: name, details: { messagesRemoved } });
    // move anyone viewing the deleted channel back to main
    for (const [, s] of io.sockets.sockets) {
      if (s.currentChannel !== name) continue;
      s.leave(roomOf(name));
      s.join(roomOf("main"));
      s.currentChannel = "main";
      s.emit(
        "history",
        getHistory("main").map(({ ownerEmail, ...m }) => m),
      );
      s.emit("switchedChannel", "main");
    }
    io.emit(
      "channels",
      listChannels().map((c) => c.name),
    );
    emitUserList("main");
  });

  socket.on("message", async (data) => {
    // check if muted
    if (
      isMuted(socket.userEmail) &&
      socket.userRole !== "owner"
    ) {
      const m = getMute(socket.userEmail);
      socket.emit(
        "commandError",
        `you are muted${m.until ? " until " + new Date(m.until).toLocaleString() : ""} - reason: ${m.reason}`,
        'error',
      );
      return;
    }

    if (typeof data.text === "string" && data.text.length > MAX_MESSAGE_LENGTH) {
      socket.emit('commandError', `message is too long (max ${MAX_MESSAGE_LENGTH} characters)`, 'error')
      return
    }

    if (containsBlockedLink(data.text) || isBlockedImageUrl(data.image)) {
      socket.emit('commandError', "media links from unapproved sites aren't allowed, please use the direct upload function or an approved site", "error")
      return;
    }

    const now = Date.now();
    // verified users (and the owner) bypass the message cooldown
    const bypassCooldown =
      socket.userRole === "mod" ||
      socket.cachedRedVerified ||
      socket.userRole === "owner" ||
      socket.userRole === "admin";
    if (
      !bypassCooldown &&
      lastmessage[socket.userEmail] &&
      now - lastmessage[socket.userEmail] < msgcooldown
    ) {
      socket.emit("commandError", "slow down", 'error');
      return;
    }
    lastmessage[socket.userEmail] = now;

    if (chatMuted && !["mod", "admin", "owner"].includes(socket.userRole)) {
      socket.emit("showE", "chat is currently muted");
      return;
    }

    const raw = data.text ?? "";
    if (raw.startsWith("/")) {
      const sp = raw.indexOf(" ");
      const name = sp === -1 ? raw : raw.slice(0, sp);
      const rest = sp === -1 ? "" : raw.slice(sp + 1).trim();
      const cmd = commands[name];
      // todo: improve this, preferrably make it fetch some kind of admin flag/metadata from clerk account
      if (cmd) {
        const roleValues = { user: 0, mod: 1, admin: 2, owner: 3 };
        if (cmd.minRole && (roleValues[socket.userRole] ?? 0) < roleValues[cmd.minRole]) {
          const auditName = name.slice(1);
          recordStaffAction(socket, auditName, {
            target: staffCommandTarget(auditName, rest),
            outcome: "denied",
          });
          socket.emit('commandError', "you don't have permission to use this command", 'error');
          return;
        }
        await cmd.run(socket, rest, data);
        return;
      }
    }

    const timestamp = new Date().toISOString();
    const logText = String(data.text || "[image]").replace(/[\r\n]+/g, " ");
    await appendFile(
      "messages.log",
      `${timestamp}: ${socket.userEmail} (${socket.username}): ${logText}\n`,
    );
    const replyTo =
      typeof data.replyTo === "string" && getMessageById(data.replyTo)
        ? data.replyTo
        : null;
    const message = {
      text: typeof data.text === "string" ? data.text : null,
      image: typeof data.image === "string" ? data.image : null,
      id: randomUUID(),
      ownerEmail: socket.userEmail,
      username: socket.username,
      time: Date.now(),
      channel: socket.currentChannel,
      isToken: ["owner"].includes(socket.userRole),
      isGuest: socket.userEmail.endsWith("@guest"),
      color: getColor(socket.userEmail) ?? null,
      avatar: getAvatar(socket.userEmail) ?? null,
      verified: isVerified(socket.userEmail),
      redVerified: isRedVerified(socket.userEmail),
      replyTo,
    };
    // only mention people currently present in this channel
    const roomIds =
      io.sockets.adapter.rooms.get(roomOf(socket.currentChannel)) ?? new Set();
    const onlineNames = [...roomIds]
      .map((id) => io.sockets.sockets.get(id)?.username)
      .filter(Boolean);
    const mentions = [
      ...new Set(
        [...(data.text || "").matchAll(/@([a-zA-Z0-9_]+)/g)]
          .map((m) => m[1])
          .filter((n) =>
            onlineNames.some((u) => u.toLowerCase() === n.toLowerCase()),
          ),
      ),
    ];
    message.mentions = mentions;
    addMessage(message);
    const stored = getMessageById(message.id);
    const { ownerEmail, ...publicMessage } = stored;
    io.to(roomOf(socket.currentChannel)).emit("message", publicMessage);
  });
});

const HTTP_ACTIONS = {
  "/admin/emoji/add": { action: "emoji.add", category: "emoji", targetField: "shortcode", detailFields: ["shortcode"] },
  "/admin/emoji/replace": { action: "emoji.replace", category: "emoji", targetField: "shortcode", detailFields: ["shortcode"] },
  "/admin/emoji/delete": { action: "emoji.delete", category: "emoji", targetField: "shortcode", detailFields: ["shortcode"] },
  "/admin/mutechat": {
    action: payload => typeof payload.muted === "boolean"
      ? payload.muted ? "chat.mute" : "chat.unmute"
      : "chat.mute_change",
    category: "settings", target: "chat", detailFields: ["muted"],
  },
  "/admin/maintenance": {
    action: payload => typeof payload.reason === "string"
      ? payload.reason ? "maintenance.enable" : "maintenance.disable"
      : "maintenance.change",
    category: "settings", target: "maintenance", detailFields: ["reason"],
  },
  "/admin/clear": { action: "channel.clear", category: "content", targetField: "channel", detailFields: ["channel"] },
  "/admin/verify": { action: "user.verify", category: "verification", targetField: "email" },
  "/admin/unverify": { action: "user.unverify", category: "verification", targetField: "email" },
  "/admin/redverify": { action: "user.red_verify", category: "verification", targetField: "email" },
  "/admin/unredverify": { action: "user.red_unverify", category: "verification", targetField: "email" },
  "/admin/hide": { action: "user.hide", category: "moderation", targetField: "email" },
  "/admin/unhide": { action: "user.unhide", category: "moderation", targetField: "email" },
  "/admin/user/ban": { action: "user.ban", category: "moderation", targetField: "email", detailFields: ["reason"] },
  "/admin/user/unban": { action: "user.unban", category: "moderation", targetField: "email" },
  "/admin/user/kick": { action: "user.kick", category: "moderation", targetField: "email", detailFields: ["reason"] },
  "/admin/user/mute": { action: "user.mute", category: "moderation", targetField: "email", detailFields: ["reason", "duration"] },
  "/admin/user/unmute": { action: "user.unmute", category: "moderation", targetField: "email" },
  "/admin/user/role": { action: "user.role_change", category: "accounts", targetField: "email", detailFields: ["role"] },
  "/admin/user/revoke-session": { action: "user.session_revoke", category: "accounts", target: "account session", targetField: "email" },
  "/admin/user/revoke-all-sessions": { action: "user.sessions_revoke_all", category: "accounts", targetField: "email" },
  "/admin/user/ban-clerk": { action: "user.clerk_ban", category: "accounts", targetField: "email" },
};

function parseActionResponse(responseBody) {
  try {
    const body = Buffer.isBuffer(responseBody) ? responseBody.toString("utf8") : responseBody;
    return typeof body === "string" ? JSON.parse(body) : null;
  } catch {
    return null;
  }
}

function actionDetailsFromRequest(definition, payload, req, statusCode, response) {
  const details = { source: "admin API", ...(req.actionAuditDetails || {}) };
  for (const field of definition.detailFields || []) {
    const value = payload?.[field];
    if (typeof value === "string" && value.trim()) details[field] = value.trim().slice(0, 1000);
    else if (typeof value === "number" && Number.isFinite(value)) details[field] = value;
    else if (typeof value === "boolean") details[field] = value;
  }
  if (typeof statusCode === "number" && (statusCode < 200 || statusCode >= 300)) {
    details.httpStatus = statusCode;
  }
  if (typeof response?.error === "string") {
    details.failure = response.error.slice(0, 300);
  } else if (response?.kicked === false) {
    details.failure = "target was not online";
  }
  return details;
}

function attachActionAudit(req, res, url) {
  if (req.method !== "POST") return;
  const definition = HTTP_ACTIONS[url.pathname];
  if (!definition) return;

  // Keep only a small, short-lived request buffer so JSON action fields can be
  // extracted without ever persisting session tokens or arbitrary request data.
  let requestBody = "";
  let bodyTooLarge = false;
  req.on("data", chunk => {
    if (bodyTooLarge) return;
    if (Buffer.byteLength(requestBody) + chunk.length > 16 * 1024) {
      requestBody = "";
      bodyTooLarge = true;
      return;
    }
    requestBody += chunk.toString("utf8");
  });

  const originalEnd = res.end;
  let recorded = false;
  res.end = function (...args) {
    if (!recorded) {
      recorded = true;
      try {
        let payload = req.actionAuditPayload || {};
        if (!bodyTooLarge && !req.actionAuditPayload) {
          try { payload = JSON.parse(requestBody || "{}"); } catch {}
        }
        let actorSession = null;
        if (typeof payload?.session === "string") actorSession = getSession(payload.session);
        if (!actorSession) {
          try { actorSession = getRequestUser(req); } catch {}
        }
        if (actorSession && !actorSession.guest) {
          const role = getRole(actorSession.email);
          const statusCode = res.statusCode || 200;
          const response = parseActionResponse(args[0]);
          const completed = statusCode >= 200 && statusCode < 300 && response?.success !== false && response?.kicked !== false && typeof response?.error !== "string";
          const outcome = completed
            ? "success"
            : [401, 403].includes(statusCode) ? "denied" : "failed";
          let action = typeof definition.action === "function"
            ? definition.action(payload)
            : definition.action;
          let target = req.actionAuditTarget || definition.target || payload?.[definition.targetField] || null;
          if (url.pathname === "/admin/user/revoke-session") {
            const targetSession = payload?.sessionId;
            if (typeof targetSession === "string") {
              target = db.prepare("SELECT email FROM sessions WHERE clerk_session_id = ? LIMIT 1").get(targetSession)?.email || "account session";
            }
          }
          addActionLog({
            actorEmail: actorSession.email,
            actorUsername: getStoredUsername(actorSession.email),
            actorRole: role,
            action,
            category: definition.category,
            target,
            outcome,
            details: actionDetailsFromRequest(definition, payload, req, statusCode, response),
          });
        }
      } catch (error) {
        console.error("failed to record admin action:", error);
      }
    }
    return originalEnd.apply(this, args);
  };
}

httpServer.on("request", async (req, res) => {
  if (req.url.includes("socket.io")) return;

  const url = new URL(
    req.url,
    `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`,
  );
  attachActionAudit(req, res, url);

  // Clerk sign-in: the client signs in with clerk-js and POSTs the resulting
  // session JWT here. We verify it, resolve the user's primary email, and mint
  // one of our own SQLite sessions (same shape the app already expects).
  if (url.pathname === "/clerk-login" && req.method === "POST") {
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.socket.remoteAddress;
    if (!checkRateLimit(ip, "clerk-login", 30, 60 * 60 * 1000)) {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "too many attempts, try again later" }));
      return;
    }
    let body = "";
    req.on("data", (d) => {
      body += d;
    });
    req.on("end", async () => {
      const fail = (code, error) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify({ error }));
      };
      try {
        const token = JSON.parse(body).token;
        if (!token) return fail(400, "missing token");

        // Verify the session JWT against Clerk's JWKS using our secret key.
        // We intentionally do NOT pass authorizedParties here: native (mobile)
        // session tokens have no `azp` claim, and @clerk/backend rejects a
        // missing azp when authorizedParties is set. We re-apply the CSRF
        // check ourselves below, but only for tokens that actually carry an
        // azp (i.e. browser origins) so native clients can still sign in.
        const claims = await verifyToken(token, {
          secretKey: process.env.CLERK_SECRET_KEY,
        });
        if (
          claims.azp &&
          clerkAuthorizedParties.length &&
          !clerkAuthorizedParties.includes(claims.azp)
        ) {
          return fail(401, "unauthorized origin");
        }

        // session tokens don't carry the email, so look the user up
        const user = await clerk.users.getUser(claims.sub);
        const primaryEmail = user.emailAddresses.find(
          (e) => e.id === user.primaryEmailAddressId,
        )?.emailAddress;
        if (!primaryEmail) return fail(400, "no email on Clerk account");

        const email = normalizeEmail(primaryEmail);
        const role = user.publicMetadata?.role ?? "user"
        setRole(email, role)

        // Clerk is the source of truth for profile pictures. Reconcile the
        // in-app avatar with the user's Clerk image on every sign-in.
        let clerkUser = user;
        try {
          const existingAvatar = getAvatar(email);
          const s3base = process.env.AWS_S3_PUBLIC_URL;
          // one-time migration: the user set a custom (S3) avatar before we
          // moved to Clerk and has no Clerk image yet → push it up to Clerk
          // once. Users with only the default avatar are never synced.
          if (
            !clerkUser.hasImage &&
            existingAvatar &&
            s3base &&
            existingAvatar.startsWith(`${s3base}/avatars/`)
          ) {
            const imgRes = await fetch(existingAvatar);
            if (imgRes.ok) {
              // Clerk uses the blob's content-type as the upload image type and
              // rejects anything non-image (S3 can hand back text/plain or an
              // empty type). Force a real image type from the file extension.
              const ext = new URL(existingAvatar).pathname
                .split(".")
                .pop()
                .toLowerCase();
              const mime =
                {
                  jpg: "image/jpeg",
                  jpeg: "image/jpeg",
                  png: "image/png",
                  gif: "image/gif",
                  webp: "image/webp",
                }[ext] || "image/jpeg";
              const bytes = await imgRes.arrayBuffer();
              const blob = new Blob([bytes], { type: mime });
              await clerk.users.updateUserProfileImage(clerkUser.id, {
                file: blob,
              });
              clerkUser = await clerk.users.getUser(clerkUser.id);
            }
          }
          // Clerk image → in-app avatar. If migration failed we keep the
          // existing avatar rather than dropping the user's picture.
          if (clerkUser.hasImage) setAvatar(email, clerkUser.imageUrl);
        } catch (e) {
          console.error("clerk avatar sync failed:", e);
        }

        await appendFile(
          "login.log",
          `${new Date().toISOString()}: ${email} signed in from ${ip}\n`,
        );
        const sessionid = randomBytes(32).toString("hex");
        saveSession(sessionid, {
          email,
          ip,
          clerkId: clerkUser.id,
          clerkSessionId: claims.sid ?? null,
          role,
        });
        res.writeHead(200, {
          "content-type": "application/json",
          "Set-Cookie": sessionCookie(sessionid, req),
        });
        res.end(JSON.stringify({ session: sessionid }));
      } catch (e) {
        console.error("clerk-login failed:", e);
        fail(401, "invalid or expired sign-in");
      }
    });
    return;
  }

  if (url.pathname === "/me") {
    const sessionId = parseCookies(req).session;
    const s = getSession(sessionId);
    if (!s) {
      res.writeHead(401);
      res.end("{}");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        username: getStoredUsername(s.email) ?? null,
        guest: !!s.guest,
      }),
    );
    return;
  }

  if (url.pathname === "/signout") {
    const sessionId = parseCookies(req).session;
    if (sessionId) {
      deleteSession(sessionId);
    }
    // ?signedout=1 tells the login page to also end the Clerk session so the
    // user isn't silently re-signed-in on the next visit
    res.writeHead(302, {
      Location: "/?signedout=1",
      "Set-Cookie": clearSessionCookie(),
    });
    res.end();
    return;
  }

  if (url.pathname === "/upload") {
    const allowedOrigins = [
      "http://localhost:3000",
      "https://chattm.app",
      "https://beta.chattm.app",
    ];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    const uploadIp =
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.socket.remoteAddress;
    if (!checkRateLimit(uploadIp, "upload", 50, 60 * 60 * 1000)) {
      res.writeHead(429);
      res.end(JSON.stringify({ error: "too many uploads, try again later" }));
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405);
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const uploadSessionId = parseCookies(req).session;
    const uploadSession = uploadSessionId ? getSession(uploadSessionId) : null;
    if (!uploadSession) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    if (isBanned(uploadSession.email)) {
      res.writeHead(403);
      res.end(JSON.stringify({ error: "banned" }));
      return;
    }
    if (
      url.searchParams.get("avatar") !== "1" &&
      isMuted(uploadSession.email)
    ) {
      res.writeHead(403);
      res.end(JSON.stringify({ error: "you are muted" }));
      return;
    }

    const form = formidable({ maxFileSize: 50 * 1024 * 1024 });
    form.parse(req, async (err, fields, files) => {
      if (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
      try {
        if (!files.file || !files.file[0]) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "No file uploaded" }));
          return;
        }

        const file = files.file[0];
        const isAvatar = url.searchParams.get("avatar") === "1";
        const imageTypes = [
          "image/jpeg",
          "image/png",
          "image/gif",
          "image/webp",
        ];
        const allowedTypes = isAvatar
          ? imageTypes
          : [
            ...imageTypes,
            "video/mp4",
            "video/quicktime",
            "audio/mpeg",
            "audio/ogg",
            "audio/wav",
            "application/pdf",
            "text/plain",
            "text/markdown",
            "application/zip",
            "application/x-rar-compressed",
            "application/x-7z-compressed",
            "application/x-tar",
            "application/gzip",
            "application/json",
            "text/csv",
            "image/vnd.adobe.photoshop",
            "application/figma",
          ];
        if (!allowedTypes.includes(file.mimetype)) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "file type not allowed" }));
          return;
        }

        const fileBuffer = await readFile(file.filepath);
        const ext = extname(file.originalFilename || "")
          .toLowerCase()
          .replace(/[^a-z0-9.]/g, "")
          .slice(0, 10);
        const folder = isAvatar ? "avatars" : "uploads";
        const key = `${folder}/${Date.now()}-${randomBytes(6).toString("hex")}${ext}`;

        await s3.send(
          new PutObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: key,
            Body: fileBuffer,
            ContentType: file.mimetype,
            ACL: "public-read",
          }),
        );

        const publicUrl = `${process.env.AWS_S3_PUBLIC_URL}/${key}`;

        const userEmail = uploadSession.email;
        const uUsername = fields.username?.[0] || "unknown";
        await appendFile(
          "uploads.log",
          `${new Date().toISOString()}: ${userEmail} (${uUsername}): ${publicUrl}\n`,
        );

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ url: publicUrl }));
      } catch (e) {
        console.error("Upload error:", e);
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url.pathname === "/guest") {
    if (guestsDisabled) {
      res.writeHead(302, { Location: "/?error=guests_disabled" });
      res.end();
      return;
    }
    const guestIp =
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.socket.remoteAddress;
    if (!checkRateLimit(guestIp, "guest", 10, 60 * 60 * 1000)) {
      res.writeHead(302, { Location: "/?error=rate_limited" });
      res.end();
      return;
    }
    const guestId = randomBytes(3).toString("hex");
    const guestEmail = `guest-${guestId}@guest`;
    const today = new Date().toISOString().slice(0, 10);
    const sessionid = randomBytes(32).toString("hex");
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.socket.remoteAddress;
    await appendFile(
      "login.log",
      `${new Date().toISOString()}: guest-${guestId} signed in from ${ip}\n`,
    );
    saveSession(sessionid, {
      email: guestEmail,
      guest: true,
      expires: today,
      ip,
    });
    const rawUsername = url.searchParams.get("username");
    if (
      rawUsername &&
      isValidUsername(rawUsername) &&
      !usernameTaken(rawUsername, guestEmail)
    )
      saveUsername(guestEmail, rawUsername);
    const redirectUrl = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}/#session=${sessionid}`;
    res.writeHead(302, {
      Location: redirectUrl,
      "Set-Cookie": sessionCookie(sessionid, req),
    });
    res.end();
    return;
  }

  if (url.pathname === "/maintenance") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        maintenance: maintenance,
        reason: reason,
        guestsDisabled: guestsDisabled,
      }),
    );
    return;
  }

  if (url.pathname === "/config") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ port: PORT }));
    return;
  }

  if (url.pathname === "/stats") {
    const statsUser = getRequestUser(req);
    const statsRole = statsUser ? getRole(statsUser.email) : "user";
    if (!statsUser || !["admin", "owner"].includes(statsRole)) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "forbidden" }));
      return;
    }
    const forceRefresh = url.searchParams.get("refresh") === "1";
    if (forceRefresh) {
      if (!checkRateLimit(statsUser.email, "admin-stats-refresh", 6, 60 * 1000)) {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "rate limited" }));
        return;
      }
      statsCacheTime = 0;
    }
    if (!statsCache || Date.now() - statsCacheTime > 10 * 60 * 1000) {
      // share a single in-flight promise among concurrent cold-cache requests
      if (!statsFetchPromise) {
        statsFetchPromise = (async () => {
          const db = getDbStats();
          let totalSize = 0,
            uploads = 0;
          let token;
          do {
            const r = await s3.send(
              new ListObjectsV2Command({
                Bucket: process.env.AWS_S3_BUCKET,
                ContinuationToken: token,
              }),
            );
            for (const obj of r.Contents ?? []) {
              totalSize += obj.Size;
              if (obj.Key.startsWith("uploads/")) uploads++;
            }
            token = r.IsTruncated ? r.NextContinuationToken : null;
          } while (token);
          // only cache on full success
          statsCache = {
            users: db.users,
            messages: db.messages,
            emoji: db.emoji,
            totalSize,
            uploads,
            updatedAt: new Date().toISOString(),
          };
          statsCacheTime = Date.now();
          return statsCache;
        })()
          .catch((e) => {
            console.error("stats fetch failed:", e.message);
            return statsCache; // return stale cache or null on first failure
          })
          .finally(() => {
            statsFetchPromise = null;
          });
      }
      await statsFetchPromise;
    }
    if (!statsCache) {
      res.writeHead(503);
      res.end(JSON.stringify({ error: "stats unavailable" }));
      return;
    }
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(statsCache));
    return;
  }

  if (url.pathname === "/version") {
    const versionIp =
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.socket.remoteAddress;
    if (!checkRateLimit(versionIp, "version", 30, 60 * 1000)) {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "rate limited" }));
      return;
    }
    const versionUser = getRequestUser(req);
    const versionRole = versionUser ? getRole(versionUser.email) : "user";
    const forceRefresh =
      url.searchParams.get("refresh") === "1" &&
      ["admin", "owner"].includes(versionRole);
    const vStatus = await getVersionStatus(forceRefresh);
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(vStatus));
    return;
  }

  if (url.pathname === "/channels") {
    res.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    });
    const channels = listChannels()
    res.end(JSON.stringify({channels}))
    return;
  }
  if (url.pathname === "/reports" && req.method === "POST") {
    const user = getRequestUser(req);
    if (!user) {
      sendJson(res, 401, { error: "sign in to submit a report" });
      return;
    }

    try {
      const payload = await readJsonRequest(req, 12 * 1024);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        sendJson(res, 400, { error: "invalid report request" });
        return;
      }
      const allowedReasons = new Set(["spam", "harassment", "hateful_abusive", "inappropriate", "threats", "other"]);
      const reason = typeof payload.reason === "string" ? payload.reason : "";
      const note = typeof payload.note === "string" ? payload.note.trim() : "";
      if (!allowedReasons.has(reason)) {
        sendJson(res, 400, { error: "choose a valid report reason" });
        return;
      }
      if (payload.note !== undefined && typeof payload.note !== "string") {
        sendJson(res, 400, { error: "report note must be text" });
        return;
      }
      if (note.length > 500) {
        sendJson(res, 400, { error: "report note must be 500 characters or fewer" });
        return;
      }

      const reporterEmail = normalizeEmail(user.email);
      let reporterUsername = getStoredUsername(reporterEmail);
      if (!reporterUsername) {
        reporterUsername = [...io.sockets.sockets.values()].find(socket => normalizeEmail(socket.userEmail) === reporterEmail)?.username || reporterEmail.split("@")[0];
      }
      const targetType = typeof payload.messageId === "string" ? "message" : typeof payload.targetUsername === "string" ? "account" : null;
      if (!targetType || (targetType === "message" && payload.targetUsername !== undefined) || (targetType === "account" && payload.messageId !== undefined)) {
        sendJson(res, 400, { error: "report exactly one message or account" });
        return;
      }

      let targetKey;
      let targetEmail = null;
      let targetUsername = null;
      let snapshot;
      if (targetType === "message") {
        const messageId = payload.messageId.trim();
        if (!messageId || messageId.length > 80) {
          sendJson(res, 400, { error: "invalid message" });
          return;
        }
        const message = getMessageById(messageId);
        if (!message || message.system || !message.ownerEmail) {
          sendJson(res, 404, { error: "message not found" });
          return;
        }
        targetEmail = normalizeEmail(message.ownerEmail);
        if (targetEmail === reporterEmail) {
          sendJson(res, 400, { error: "you cannot report your own message" });
          return;
        }
        targetKey = message.id;
        targetUsername = message.username || getStoredUsername(targetEmail) || targetEmail.split("@")[0];
        snapshot = {
          messageId: message.id,
          authorUsername: targetUsername,
          authorEmail: targetEmail,
          text: message.text,
          image: message.image,
          channel: message.channel || "main",
          time: message.time,
        };
      } else {
        const requestedUsername = payload.targetUsername.trim();
        if (!isValidUsername(requestedUsername)) {
          sendJson(res, 400, { error: "invalid account" });
          return;
        }
        for (const socket of io.sockets.sockets.values()) {
          if (socket.username?.toLowerCase() === requestedUsername.toLowerCase()) {
            targetEmail = normalizeEmail(socket.userEmail);
            targetUsername = socket.username;
            break;
          }
        }
        if (!targetEmail) targetEmail = getEmailByUsername(requestedUsername);
        if (!targetEmail && /^guest-[a-f0-9]+$/i.test(requestedUsername)) {
          const candidateEmail = `${requestedUsername}@guest`.toLowerCase();
          const storedName = getStoredUsername(candidateEmail);
          if (storedName?.toLowerCase() === requestedUsername.toLowerCase()) targetEmail = candidateEmail;
          else if (db.prepare("SELECT 1 FROM sessions WHERE email = ? LIMIT 1").get(candidateEmail)) targetEmail = candidateEmail;
        }
        targetEmail = normalizeEmail(targetEmail);
        if (!targetEmail) {
          sendJson(res, 404, { error: "account not found" });
          return;
        }
        if (targetEmail === reporterEmail) {
          sendJson(res, 400, { error: "you cannot report your own account" });
          return;
        }
        targetUsername = targetUsername || getStoredUsername(targetEmail) || requestedUsername;
        targetKey = targetEmail;
        snapshot = { username: targetUsername, email: targetEmail };
      }

      const clientIp = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
      if (!checkRateLimit(reporterEmail, "report-submit-user", 5, 10 * 60 * 1000) ||
          !checkRateLimit(clientIp, "report-submit-ip", 20, 10 * 60 * 1000)) {
        sendJson(res, 429, { error: "too many reports, try again later" });
        return;
      }
      if (hasOpenReport(reporterEmail, targetType, targetKey)) {
        sendJson(res, 409, { error: "you already have an open report for this target" });
        return;
      }

      const reportId = createReport({
        createdAt: Date.now(),
        targetType,
        targetKey,
        targetUsername,
        targetEmail,
        reporterEmail,
        reporterUsername,
        reporterRole: getRole(reporterEmail),
        reason,
        note,
        snapshot,
      });
      sendJson(res, 201, { success: true, reportId });
    } catch (error) {
      if (error?.code === "SQLITE_CONSTRAINT_UNIQUE") {
        sendJson(res, 409, { error: "you already have an open report for this target" });
      } else {
        sendJson(res, error.statusCode || 500, { error: error.statusCode ? error.message : "could not submit report" });
        if (!error.statusCode) console.error("report submission failed:", error);
      }
    }
    return;
  }

  if (url.pathname === "/admin/reports/data" && req.method === "GET") {
    const user = getRequestUser(req);
    const role = user ? getRole(user.email) : "user";
    if (!user || !["mod", "admin", "owner"].includes(role)) {
      sendJson(res, 403, { error: "forbidden" });
      return;
    }
    const status = url.searchParams.get("status") || "open";
    if (!["open", "resolved", "dismissed", "all"].includes(status)) {
      sendJson(res, 400, { error: "invalid report status" });
      return;
    }
    const pageValue = Number(url.searchParams.get("page") || 1);
    if (!Number.isSafeInteger(pageValue) || pageValue < 1) {
      sendJson(res, 400, { error: "invalid page" });
      return;
    }
    const result = getReports({
      page: Math.min(1_000_000, pageValue),
      pageSize: 50,
      status,
      search: url.searchParams.get("search") || "",
    });
    sendJson(res, 200, result);
    return;
  }

  const reportActionMatch = url.pathname.match(/^\/admin\/reports\/(\d+)(?:\/(note|status))?$/);
  if (reportActionMatch) {
    const user = getRequestUser(req);
    const role = user ? getRole(user.email) : "user";
    const reportId = Number(reportActionMatch[1]);
    const action = reportActionMatch[2];
    const mutationAction = req.method === "DELETE" && !action ? "report.delete"
      : req.method === "POST" && action === "note" ? "report.note"
        : req.method === "POST" && action === "status" ? "report.status_change" : null;
    if (!user || !["mod", "admin", "owner"].includes(role)) {
      if (user && mutationAction) recordReportAction(user, role, mutationAction, `report #${reportId}`, "denied", { reportId, failure: "forbidden" });
      sendJson(res, 403, { error: "forbidden" });
      return;
    }
    if (!Number.isSafeInteger(reportId) || reportId < 1) {
      if (mutationAction) recordReportAction(user, role, mutationAction, `report #${reportId}`, "failed", { failure: "invalid report ID" });
      sendJson(res, 400, { error: "invalid report ID" });
      return;
    }

    if (req.method === "GET" && !action) {
      const report = getReportById(reportId);
      if (!report) sendJson(res, 404, { error: "report not found" });
      else sendJson(res, 200, { report });
      return;
    }

    if (req.method === "POST" && action === "note") {
      try {
        const payload = await readJsonRequest(req, 8 * 1024);
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          recordReportAction(user, role, "report.note", `report #${reportId}`, "failed", { reportId, failure: "invalid note request" });
          sendJson(res, 400, { error: "invalid note request" });
          return;
        }
        const note = typeof payload.note === "string" ? payload.note.trim() : "";
        if (!note || note.length > 1000) {
          recordReportAction(user, role, "report.note", `report #${reportId}`, "failed", { reportId, failure: "invalid note length" });
          sendJson(res, 400, { error: "internal note must be between 1 and 1000 characters" });
          return;
        }
        const report = getReportById(reportId);
        if (!report) {
          recordReportAction(user, role, "report.note", `report #${reportId}`, "failed", { reportId, failure: "report not found" });
          sendJson(res, 404, { error: "report not found" });
          return;
        }
        const actorEmail = normalizeEmail(user.email);
        const actorUsername = getStoredUsername(actorEmail) || actorEmail.split("@")[0];
        const added = addReportNote(reportId, {
          actorEmail,
          actorUsername,
          actorRole: role,
          note,
        });
        recordReportAction(user, role, "report.note", report.targetUsername || report.targetEmail || `report #${reportId}`, "success", { reportId, noteId: added.id });
        sendJson(res, 201, { success: true, report: getReportById(reportId) });
      } catch (error) {
        recordReportAction(user, role, "report.note", `report #${reportId}`, "failed", { reportId, failure: error.message || "could not save internal note" });
        sendJson(res, error.statusCode || 500, { error: error.statusCode ? error.message : "could not save internal note" });
        if (!error.statusCode) console.error("report note failed:", error);
      }
      return;
    }

    if (req.method === "POST" && action === "status") {
      try {
        const payload = await readJsonRequest(req, 8 * 1024);
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          recordReportAction(user, role, "report.status_change", `report #${reportId}`, "failed", { reportId, failure: "invalid status request" });
          sendJson(res, 400, { error: "invalid status request" });
          return;
        }
        if (!["open", "resolved", "dismissed"].includes(payload.status)) {
          recordReportAction(user, role, "report.status_change", `report #${reportId}`, "failed", { reportId, failure: "invalid report status" });
          sendJson(res, 400, { error: "invalid report status" });
          return;
        }
        const report = getReportById(reportId);
        if (!report) {
          recordReportAction(user, role, "report.status_change", `report #${reportId}`, "failed", { reportId, status: payload.status, failure: "report not found" });
          sendJson(res, 404, { error: "report not found" });
          return;
        }
        if (report.status === payload.status) {
          sendJson(res, 200, { success: true, report });
          return;
        }
        const updated = updateReportStatus(reportId, payload.status);
        const actionName = payload.status === "open" ? "report.reopen"
          : payload.status === "resolved" ? "report.resolve" : "report.dismiss";
        recordReportAction(user, role, actionName, report.targetUsername || report.targetEmail || `report #${reportId}`, "success", { reportId, previousStatus: updated.previousStatus, status: payload.status });
        sendJson(res, 200, { success: true, report: getReportById(reportId) });
      } catch (error) {
        if (error?.code === "SQLITE_CONSTRAINT_UNIQUE") {
          recordReportAction(user, role, "report.status_change", `report #${reportId}`, "failed", { reportId, failure: "another open report exists for this reporter and target" });
          sendJson(res, 409, { error: "another open report already exists for this reporter and target" });
        } else {
          recordReportAction(user, role, "report.status_change", `report #${reportId}`, "failed", { reportId, failure: error.message || "could not update report" });
          sendJson(res, error.statusCode || 500, { error: error.statusCode ? error.message : "could not update report" });
          if (!error.statusCode) console.error("report status update failed:", error);
        }
      }
      return;
    }

    if (req.method === "DELETE" && !action) {
      if (!["admin", "owner"].includes(role)) {
        recordReportAction(user, role, "report.delete", `report #${reportId}`, "denied", { reportId, failure: "only admins and owners can delete reports" });
        sendJson(res, 403, { error: "only admins and owners can permanently delete reports" });
        return;
      }
      const report = deleteReport(reportId);
      if (!report) {
        recordReportAction(user, role, "report.delete", `report #${reportId}`, "failed", { reportId, failure: "report not found" });
        sendJson(res, 404, { error: "report not found" });
        return;
      }
      recordReportAction(user, role, "report.delete", report.targetUsername || report.targetEmail || `report #${reportId}`, "success", { reportId, targetType: report.targetType, previousStatus: report.status });
      sendJson(res, 200, { success: true });
      return;
    }

    sendJson(res, 405, { error: "method not allowed" });
    return;
  }

  if (url.pathname === "/admin/logs/data" && req.method === "GET") {
    const user = getRequestUser(req);
    const role = user ? getRole(user.email) : "user";
    if (!user || !["admin", "owner"].includes(role)) {
      res.writeHead(403, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "forbidden" }));
      return;
    }

    const categories = new Set(["accounts", "content", "emoji", "moderation", "settings", "verification"]);
    const rawCategory = url.searchParams.get("category") || "";
    if (rawCategory && !categories.has(rawCategory)) {
      res.writeHead(400, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "invalid category" }));
      return;
    }
    const parseBound = value => {
      if (value === null || value === "") return null;
      const number = Number(value);
      return Number.isSafeInteger(number) && number >= 0 ? number : NaN;
    };
    const from = parseBound(url.searchParams.get("from"));
    const to = parseBound(url.searchParams.get("to"));
    if (Number.isNaN(from) || Number.isNaN(to) || (from !== null && to !== null && to < from)) {
      res.writeHead(400, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "invalid date range" }));
      return;
    }
    const page = Math.min(1_000_000, Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1));
    const result = getActionLogs({
      page,
      pageSize: 50,
      search: url.searchParams.get("search") || "",
      category: rawCategory,
      from,
      to,
    });
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ ...result, totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)) }));
    return;
  }

  if (url.pathname === "/admin/emoji/list" && req.method === "GET") {
    if (!requireAdminPage(req, res)) return

    const emojis = getCustomEmoji()
    const emojiList = Object.entries(emojis)
      .map(([shortcode, url]) => ({shortcode, url}))
      .sort((a,b) => a.shortcode.localeCompare(b.shortcode))

    res.writeHead(200, {'content-type': 'application/json'})
    res.end(JSON.stringify({emojis: emojiList}))
    return
  }

  if (["/admin/emoji/add", "/admin/emoji/replace"].includes(url.pathname) && req.method === "POST") {
    const user = getRequestUser(req);
    const send = (status, data) => {
      res.writeHead(status, {"content-type": "application/json"});
      res.end(JSON.stringify(data));
    };
    if (!user || !["admin", "owner"].includes(getRole(user.email))) {
      send(403, {success: false, error: "forbidden"});
      return;
    }
    if (!process.env.AWS_S3_BUCKET || !process.env.AWS_S3_PUBLIC_URL) {
      send(503, {success: false, error: "emoji storage is not configured"});
      return;
    }
    if (!checkRateLimit(user.email, "admin-emoji-upload", 30, 60 * 60 * 1000)) {
      send(429, {success: false, error: "too many emoji uploads, try again later"});
      return;
    }
    const replacing = url.pathname === "/admin/emoji/replace";
    const maxFileSize = 2 * 1024 * 1024;
    const form = formidable({maxFiles: 1, maxFileSize, maxTotalFileSize: maxFileSize,
      maxFields: 1, maxFieldsSize: 1024, allowEmptyFiles: false, minFileSize: 1});
    const tempFiles = new Set();
    form.on("fileBegin", (_name, file) => tempFiles.add(file.filepath));
    form.parse(req, async (err, fields, files) => {
      try {
        if (err) {
          send(400, {success: false, error: "upload one image up to 2 MB"});
          return;
        }
        const file = files.file?.[0];
        const input = fields.shortcode?.[0];
        req.actionAuditPayload = {
          shortcode: typeof input === "string" ? input.trim().slice(0, 80) : "",
        };
        if (!file || Object.values(files).flat().length !== 1 || typeof input !== "string") {
          send(400, {success: false, error: "an image and shortcode are required"});
          return;
        }
        const name = replacing ? input : input.trim().toLowerCase();
        const shortcode = ":" + name + ":";
        if (!replacing && !/^[a-z0-9_]{1,32}$/.test(name)) {
          send(400, {success: false, error: "use 1–32 lowercase letters, numbers, or underscores"});
          return;
        }
        const body = await readFile(file.filepath);
        const type = emojiImageType(body);
        if (!type || body.length > maxFileSize || file.mimetype !== type.mime) {
          send(400, {success: false, error: "upload a PNG, GIF, WebP, or JPEG image up to 2 MB"});
          return;
        }
        await withEmojiMutation(async () => {
          // Check again after upload parsing and while holding the mutation queue.
          const currentUser = getRequestUser(req);
          if (!currentUser || !["admin", "owner"].includes(getRole(currentUser.email))) {
            send(403, {success: false, error: "forbidden"});
            return;
          }
          const existing = getCustomEmoji();
          const currentUrl = Object.hasOwn(existing, shortcode) ? existing[shortcode] : null;
          if (replacing ? !currentUrl : !!currentUrl) {
            send(replacing ? 404 : 409, {success: false,
              error: replacing ? "emoji not found" : "that shortcode is already in use"});
            return;
          }
          const key = replacing ? emojiStorageKey(currentUrl) : "emojis/" + name + type.ext;
          await s3.send(new PutObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET, Key: key, Body: body,
            ContentType: type.mime, CacheControl: "no-cache",
          }));
          const publicUrl = process.env.AWS_S3_PUBLIC_URL.replace(/\/+$/, "") + "/" + key + "?v=" + randomUUID();
          addCustomEmoji(shortcode, publicUrl);
          io.emit("emojiUpdate", getCustomEmoji());
          send(200, {success: true, emoji: {shortcode, url: publicUrl}});
        });
      } catch (e) {
        console.error("emoji upload failed:", e);
        if (!res.writableEnded) send(500, {success: false, error: "failed to save emoji"});
      } finally {
        await Promise.allSettled([...tempFiles].map(path => unlink(path)));
      }
    });
    return;
  }

  if (url.pathname === "/admin/emoji/delete" && req.method === "POST") {
    const send = (status, data) => {
      res.writeHead(status, {"content-type": "application/json"});
      res.end(JSON.stringify(data));
    };
    let body = "";
    let tooLarge = false;
    req.on("data", chunk => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body) > 4096) {
        tooLarge = true;
        send(413, {success: false, error: "request too large"});
      }
    });
    req.on("end", async () => {
      if (tooLarge) return;
      let payload;
      try { payload = JSON.parse(body); }
      catch { send(400, {success: false, error: "invalid request"}); return; }
      try {
        await withEmojiMutation(async () => {
          const sess = typeof payload?.session === "string" ? getSession(payload.session) : null;
          if (!sess || !["admin", "owner"].includes(getRole(sess.email))) {
            send(403, {success: false, error: "forbidden"});
            return;
          }
          const shortcode = payload.shortcode;
          const existing = getCustomEmoji();
          if (typeof shortcode !== "string" || !Object.hasOwn(existing, shortcode)) {
            send(404, {success: false, error: "emoji not found"});
            return;
          }
          if (!process.env.AWS_S3_BUCKET || !process.env.AWS_S3_PUBLIC_URL) {
            send(503, {success: false, error: "emoji storage is not configured"});
            return;
          }
          await s3.send(new DeleteObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET, Key: emojiStorageKey(existing[shortcode]),
          }));
          removeCustomEmoji(shortcode);
          io.emit("emojiUpdate", getCustomEmoji());
          send(200, {success: true});
        });
      } catch (e) {
        console.error("error deleting emoji:", e);
        send(500, {success: false, error: "failed to delete emoji; try again"});
      }
    });
    return;
  }

  if (url.pathname === "/admin/mutechat" && req.method === "POST") {
    let body = ""
    req.on('data', (d) => { body += d })
    req.on('end', async () => {
      try {
        const { session: sessionId, muted: requestedMuted } = JSON.parse(body)
        const sess = sessionId ? getSession(sessionId) : null
        const sessRole = sess ? getRole(sess.email) : "user"
        if (!sess || sessRole !== "owner") {
          res.writeHead(403, { "content-type": "application/json" })
          res.end(JSON.stringify({ error: "forbidden" }))
          return
        }

        if (typeof requestedMuted !== "boolean") {
          res.writeHead(400, { "content-type": "application/json" })
          res.end(JSON.stringify({ error: "muted state required" }))
          return
        }

        req.actionAuditDetails = { previousMuted: chatMuted };
        chatMuted = requestedMuted
        setSetting("chat_muted", chatMuted ? "1" : "0")
        if (chatMuted) {
          io.emit('mutechat', 'chat has been muted')
        } else {
          io.emit('unmutechat')
        }

        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ success: true, muted: chatMuted }))
      } catch (e) {
        res.writeHead(400, { "content-type": 'application/json' })
        res.end(JSON.stringify({ error: "invalid request" }))
      }
    })
    return
  }

  if (url.pathname === "/admin/maintenance" && req.method === "POST") {
    let body = ""
    req.on("data", (d) => { body += d })
    req.on('end', async () => {
      try {
        const { session: sessionId, reason: newReason } = JSON.parse(body)
        const sess = sessionId ? getSession(sessionId) : null
        const sessRole = sess ? getRole(sess.email) : 'user'
        if (!sess || sessRole !== "owner") {
          res.writeHead(403, { 'content-type': "application/json" })
          res.end(JSON.stringify({ error: 'forbidden' }))
          return
        }

        req.actionAuditDetails = { previouslyEnabled: maintenance, previousReason: reason || null };
        const reasonText = newReason || ''
        if (reasonText) {
          maintenance = true
          reason = reasonText
          setSetting('maintenance', '1')
          setSetting('maintenance_reason', reason)
          io.emit('status', `maintenance mode: ${reason}`)
        } else {
          maintenance = false
          reason = ""
          setSetting('maintenance', '0')
          setSetting('maintenance_reason', "")
          io.emit('status', "")
        }

        res.writeHead(200, { "content-type": 'application/json' })
        res.end(JSON.stringify({ success: true, maintenance, reason }))
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: 'invalid request' }))
      }
    })
    return
  }

  if (url.pathname === "/admin/clear" && req.method === "POST") {
    let body = ""
    req.on("data", (d) => { body += d })
    req.on('end', async () => {
      try {
        const { session: sessionId, channel } = JSON.parse(body)
        const sess = sessionId ? getSession(sessionId) : null
        const sessRole = sess ? getRole(sess.email) : 'user'
        if (!sess || !['owner', 'admin'].includes(sessRole)) {
          res.writeHead(403, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'forbidden' }))
          return
        }

        const targetChannel = channel || 'main'
        if (typeof targetChannel !== 'string' || !channelExists(targetChannel)) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'invalid channel' }))
          return
        }
        req.actionAuditTarget = targetChannel;
        req.actionAuditDetails = {
          messagesRemoved: db.prepare("SELECT COUNT(*) AS count FROM messages WHERE channel = ?").get(targetChannel).count,
        };
        clearMessages(targetChannel)
        io.to(roomOf(targetChannel)).emit('clear')

        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      } catch (e) {
        res.writeHead(400, { 'content-type': "application/json" })
        res.end(JSON.stringify({ error: 'invalid request' }))
      }
    })
    return
  }

  if (["/admin/verify", "/admin/unverify", "/admin/redverify", "/admin/unredverify"].includes(url.pathname) && req.method === "POST") {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid request' }));
        return;
      }
      const sess = payload?.session ? getSession(payload.session) : null;
      if (!sess || getRole(sess.email) !== 'owner') {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'forbidden' }));
        return;
      }
      if (typeof payload.email !== 'string' || !payload.email.trim()) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'email required' }));
        return;
      }
      const targetEmail = normalizeEmail(payload.email);
      const regular = ['/admin/verify', '/admin/unverify'].includes(url.pathname);
      if (regular && targetEmail.endsWith('@guest')) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'guests cannot have moderator roles' }));
        return;
      }
      const currentRole = getRole(targetEmail);
      req.actionAuditDetails = {
        previousRole: currentRole,
        previouslyVerified: isVerified(targetEmail),
        previouslyRedVerified: isRedVerified(targetEmail),
      };
      const newRole = url.pathname === '/admin/verify' && currentRole === 'user' ? 'mod'
        : url.pathname === '/admin/unverify' && currentRole === 'mod' ? 'user' : currentRole;
      req.actionAuditDetails.newRole = newRole;
      try {
        // Clerk remains the source of truth when verification changes a role.
        // Sync it first so a failed request cannot leave a local promotion behind.
        if (newRole !== currentRole) {
          const list = await clerk.users.getUserList({ emailAddress: [targetEmail], limit: 1 });
          const clerkUser = list.data?.[0];
          if (!clerkUser) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'no Clerk account found' }));
            return;
          }
          await clerk.users.updateUserMetadata(clerkUser.id, { publicMetadata: { role: newRole } });
          setRole(targetEmail, newRole);
        }
        if (url.pathname === '/admin/verify') setVerified(targetEmail);
        if (url.pathname === '/admin/unverify') removeVerified(targetEmail);
        if (url.pathname === '/admin/redverify') setRedVerified(targetEmail);
        if (url.pathname === '/admin/unredverify') removeRedVerified(targetEmail);

        const verified = isVerified(targetEmail);
        const redVerified = isRedVerified(targetEmail);
        forEachUserSocket(targetEmail, socket => {
          socket.userRole = newRole;
          socket.cachedVerified = verified;
          socket.cachedRedVerified = redVerified;
          socket.emit('uRole', newRole);
        });
        for (const socket of io.sockets.sockets.values()) {
          if (['admin', 'owner'].includes(socket.userRole)) socket.emit('userVerificationChanged', targetEmail);
        }
        emitAllUserLists();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true, role: newRole, verified, redVerified }));
      } catch (error) {
        console.error('verification update failed:', error);
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'could not update verification. try again.' }));
      }
    });
    return;
  }

  if (url.pathname === "/admin/hide" && req.method === "POST") {
    let body = ""
    req.on('data', (d) => { body += d });
    req.on('end', async () => {
      try {
        const { session: sessionId, email: targetEmail } = JSON.parse(body);
        const sess = sessionId ? getSession(sessionId) : null;
        const sessRole = sess ? getRole(sess.email) : 'user';
        if (!sess || !['owner', 'admin'].includes(sessRole)) {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: "forbidden" }));
          return
        }

        if (typeof targetEmail !== 'string' || !targetEmail.trim()) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'email required' }));
          return
        }

        setHidden(normalizeEmail(targetEmail))
        emitAllUserLists()

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid request' }));
      }
    })
    return
  }

  if (url.pathname === "/admin/unhide" && req.method === "POST") {
    let body = ""
    req.on('data', (d) => { body += d });
    req.on('end', async () => {
      try {
        const { session: sessionId, email: targetEmail } = JSON.parse(body);
        const sess = sessionId ? getSession(sessionId) : null;
        const sessRole = sess ? getRole(sess.email) : 'user';
        if (!sess || !['owner', 'admin'].includes(sessRole)) {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: "forbidden" }));
          return
        }

        if (typeof targetEmail !== 'string' || !targetEmail.trim()) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'email required' }));
          return
        }

        removeHidden(normalizeEmail(targetEmail))
        emitAllUserLists()

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid request' }));
      }
    })
    return
  }

  if (url.pathname === '/admin/user/info' && req.method === "GET") {
    try {
      const sessionId = parseCookies(req).session;
      const targetEmail = url.searchParams.get('email')

      const sess = sessionId ? getSession(sessionId) : null
      const sessRole = sess ? getRole(sess.email) : 'user'

      if (!sess || !["admin", 'owner'].includes(sessRole)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'forbidden' }));
        return
      }

      if (!targetEmail) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'email required' }));
        return
      }

      const role = getRole(targetEmail)
      const verified = isVerified(targetEmail)
      const redVerified = isRedVerified(targetEmail)
      const banned = isBanned(targetEmail)
      const banReason = banned ? getBanReason(targetEmail) : null
      const muteData = getMute(targetEmail)
      const muted = !!muteData && (muteData.until === null || muteData.until > Date.now())
      const muteReason = muteData?.reason || null
      const muteUntil = muteData?.until || null

      let username = null
      for (const [, s] of io.sockets.sockets) {
        if (s.userEmail === targetEmail && s.username) {
          username = s.username
          break
        }
      }
      if (!username) {
        username = getStoredUsername(targetEmail) || null;
      }

      const online = [...io.sockets.sockets.values()].some(
        s => s.userEmail === targetEmail && s.username
      );

      const messageCount = db.prepare(
        "SELECT COUNT(*) as count FROM messages WHERE owner_email = ?"
      ).get(targetEmail)?.count || 0;

      const profileData = getProfileData(targetEmail)
      let createdAt = profileData?.lastSeen || Date.now()

      const firstMessage = db.prepare(
        "SELECT MIN(time) as first FROM messages WHERE owner_email = ?"
      ).get(targetEmail)
      if (firstMessage?.first && firstMessage.first < createdAt) {
        createdAt = firstMessage.first
      }

      let clerkId = null
      let lastSignInAt = null
      let activeSessions = null;
      let clerkBanned = targetEmail.endsWith('@guest') ? false : null;
      let clerkUsername = null;

      if (!targetEmail.endsWith("@guest")) {
        try {
          const sessionRow = db.prepare(
            "SELECT clerk_id FROM sessions WHERE email = ? AND clerk_id IS NOT NULL LIMIT 1"
          ).get(targetEmail)
          clerkId = sessionRow?.clerk_id || null

          if (!clerkId) {
            const list = await clerk.users.getUserList({
              emailAddress: [targetEmail],
              limit: 1
            })
            clerkId = list.data?.[0]?.id || null
          }

          if (clerkId) {
            const clerkUser = await clerk.users.getUser(clerkId);
            clerkBanned = !!clerkUser.banned;
            clerkUsername =
              clerkUser.username ||
              [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
              null;
            lastSignInAt = clerkUser.lastSignInAt || null

            try {
              const sessionList = await clerk.sessions.getSessionList({
                userId: clerkId,
                status: 'active'
              });
              activeSessions = sessionList.totalCount ?? sessionList.data?.length ?? 0;
            } catch (e) {
              console.error('failed to fetch sessions:', e);
              activeSessions = null;
            }

            if (clerkUser.createdAt && clerkUser.createdAt < createdAt) {
              createdAt = clerkUser.createdAt
            }
          }
        } catch (e) {
          console.error('failed to fetch clerk data: ', e)
        }
      }

      username = username || clerkUsername || targetEmail.split("@")[0];

      const result = {
        email: targetEmail,
        username,
        role,
        hidden: isHidden(normalizeEmail(targetEmail)),
        verified,
        redVerified,
        guest: targetEmail.endsWith("@guest"),
        online,
        avatar: getAvatar(targetEmail),
        profile: {
          bio: targetEmail.endsWith('@guest') ? "i'm a guest on chat™" : (profileData.bio || ''),
          pronouns: targetEmail.endsWith('@guest') ? '' : (profileData.pronouns || ''),
          status: profileData.status || '',
          lastSeen: online ? null : profileData.lastSeen,
        },
        clerkId,
        createdAt,
        lastSignInAt,
        messageCount,
        activeSessions,
        clerkBanned,
        banned,
        banReason,
        muted,
        muteReason,
        muteUntil
      };

      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(result));
    } catch (e) {
      console.error('Error in /admin/user/info:', e);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal server error' }));
    }
    return
  }

  if (url.pathname === "/admin/user/sessions" && req.method === "GET") {
    try {
      const sessionId = parseCookies(req).session;
      const targetEmail = url.searchParams.get('email')

      const sess = sessionId ? getSession(sessionId) : null
      const sessRole = sess ? getRole(sess.email) : 'user'

      if (!sess || !['admin', 'owner'].includes(sessRole)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'forbidden' }));
        return
      }

      if (!targetEmail) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'email required' }));
        return
      }

      if (targetEmail.endsWith('@guest')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ sessions: [] }));
        return
      }

      let clerkId = null
      const sessionRow = db.prepare(
        "SELECT clerk_id FROM sessions WHERE email = ? AND clerk_id IS NOT NULL LIMIT 1"
      ).get(targetEmail)
      clerkId = sessionRow?.clerk_id || null

      if (!clerkId) {
        try {
          const list = await clerk.users.getUserList({
            emailAddress: [targetEmail],
            limit: 1
          })
          clerkId = list.data?.[0]?.id || null
        } catch (e) {
          console.error('failed to fetch clerk id: ', e)
         }
      }

      if (!clerkId) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ sessions: [] }));
        return
      }

      try {
        const sessions = (await getActiveClerkSessions(clerkId)).map(s => ({
          id: s.id,
          status: s.status,
          lastActiveAt: s.lastActiveAt,
          createdAt: s.createdAt,
          clientType: s.latestActivity?.deviceType || 'unknown'
        }))

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ sessions }));
      } catch (e) {
        console.error('failed to fetch sessions', e)
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to fetch sessions' }));
      }
    } catch (e) {
      console.error('endpoint error: ', e)
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal server error' }));
    }
    return
  }

  if (url.pathname === "/admin/user/ban" && req.method === "POST") {
    let body = ''
    req.on('data', (d) => { body += d });
    req.on('end', async () => {
      try {
        const { session: sessionId, email: targetEmail, reason } = JSON.parse(body);
        const sess = sessionId ? getSession(sessionId) : null
        const sessRole = sess ? getRole(sess.email) : 'user'

        if (!sess || !["admin", 'owner'].includes(sessRole)) {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'forbidden' }));
          return
        }

        if (!targetEmail) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'email required' }));
          return
        }

        if (targetEmail === sess.email) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'cannot ban urself' }));
          return
        }

        const targetRole = getRole(targetEmail)
        const roleValues = { user: 0, mod: 1, admin: 2, owner: 3 };
        const sessRoleValue = roleValues[sessRole] || 0
        const targetRoleValue = roleValues[targetRole] || 0

        if (targetRoleValue >= sessRoleValue) {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "cannot ban user with equal or higher role" }));
          return;
        }

        const banReason = reason || 'no reason given'
        req.actionAuditDetails = { reason: banReason };

        const bannedIp = banIpFor(targetEmail)
        addBan(targetEmail, banReason, bannedIp)
        addIpBan(bannedIp)

        for (const [, s] of io.sockets.sockets) {
          if (s.userEmail === targetEmail) {
            s.emit('banned', banReason)
            s.skipLeaveMessage = true
            s.disconnect()
          }
        }

        // Emit to admin users for auto-refresh
        for (const [, s] of io.sockets.sockets) {
          if (['admin', 'owner'].includes(s.userRole)) {
            s.emit('userBanned', targetEmail);
          }
        }

        emitAllUserLists()
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        console.error('ban endpoint error: ', e)
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid request' }));
      }
    })
    return
  }

  if (url.pathname === "/admin/user/kick" && req.method === "POST") {
    let body = ''
    req.on('data', (d) => { body += d });
    req.on('end', async () => {
      try {
        const { session: sessionId, email: targetEmail, reason } = JSON.parse(body);
        const sess = sessionId ? getSession(sessionId) : null
        const sessRole = sess ? getRole(sess.email) : 'user'

        if (!sess || !['mod', "admin", 'owner'].includes(sessRole)) {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'forbidden' }));
          return
        }

        if (!targetEmail) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'email required' }));
          return
        }

        if (targetEmail === sess.email) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'cannot kick urself' }));
          return
        }

        const targetRole = getRole(targetEmail)
        const roleValues = { user: 0, mod: 1, admin: 2, owner: 3 };
        const sessRoleValue = roleValues[sessRole] || 0
        const targetRoleValue = roleValues[targetRole] || 0

        if (targetRoleValue >= sessRoleValue) {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "cannot kick user with equal or higher role" }));
          return;
        }

        const kickReason = reason || 'no reason given'
        req.actionAuditDetails = { reason: kickReason };

        let kicked = false
        for (const [, s] of io.sockets.sockets) {
          if (s.userEmail === targetEmail) {
            s.emit('kicked', kickReason)
            s.skipLeaveMessage = true
            s.disconnect()
            kicked = true;
          }
        }

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true, kicked }));
      } catch (e) {
        console.error('kick endpoint error: ', e)
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid request' }));
      }
    })
    return
  }

  if (url.pathname === "/admin/user/mute" && req.method === "POST") {
    let body = ''
    req.on('data', (d) => { body += d });
    req.on('end', async () => {
      try {
        const { session: sessionId, email: targetEmail, duration, reason } = JSON.parse(body);
        const sess = sessionId ? getSession(sessionId) : null
        const sessRole = sess ? getRole(sess.email) : 'user'

        if (!sess || !['mod', "admin", 'owner'].includes(sessRole)) {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'forbidden' }));
          return
        }

        if (!targetEmail) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'email required' }));
          return
        }

        if (targetEmail === sess.email) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'cannot mute urself' }));
          return
        }

        const targetRole = getRole(targetEmail)
        const roleValues = { user: 0, mod: 1, admin: 2, owner: 3 };
        const sessRoleValue = roleValues[sessRole] || 0
        const targetRoleValue = roleValues[targetRole] || 0

        if (targetRoleValue >= sessRoleValue) {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "cannot mute user with equal or higher role" }));
          return;
        }

        const muteReason = reason || 'no reason given'
        req.actionAuditDetails = { reason: muteReason, duration: duration ?? "indefinite" };

        let until = null
        if (duration !== null && duration !== undefined) {
          const durationNum = parseInt(duration)
          if (isNaN(durationNum) || durationNum < 0) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid duration' }));
            return
          }
          until = Date.now() + (durationNum * 60 * 1000)
        }

        setMute(targetEmail, muteReason, until);

        forEachUserSocket(targetEmail, (s) => {
          s.emit('muted', { reason: muteReason, until });
        });

        // Emit to admin users for auto-refresh
        for (const [, s] of io.sockets.sockets) {
          if (['admin', 'owner'].includes(s.userRole)) {
            s.emit('userMuted', targetEmail);
          }
        }

        emitAllUserLists()

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true, muteReason, until }));
      } catch (e) {
        console.error('mute endpoint error: ', e)
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid request' }));
      }
    })
    return
  }

  if (url.pathname === "/admin/user/unmute" && req.method === "POST") {
    let body = ''
    req.on('data', (d) => { body += d });
    req.on('end', async () => {
      try {
        const { session: sessionId, email: targetEmail } = JSON.parse(body);
        const sess = sessionId ? getSession(sessionId) : null
        const sessRole = sess ? getRole(sess.email) : 'user'

        if (!sess || !['mod', "admin", 'owner'].includes(sessRole)) {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'forbidden' }));
          return
        }

        if (!targetEmail) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'email required' }));
          return
        }

        deleteMute(targetEmail)

        forEachUserSocket(targetEmail, (s) => {
          s.emit('unmuted')
        });

        // Emit to admin users for auto-refresh
        for (const [, s] of io.sockets.sockets) {
          if (['admin', 'owner'].includes(s.userRole)) {
            s.emit('userUnmuted', targetEmail);
          }
        }

        emitAllUserLists()

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        console.error('unmute endpoint error: ', e)
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid request' }));
      }
    })
    return
  }

  if (url.pathname === "/admin/user/role" && req.method === "POST") {
    let body = ''
    req.on('data', (d) => { body += d });
    req.on('end', async () => {
      try {
        const { session: sessionId, email: targetEmail, role: newRole } = JSON.parse(body);
        const sess = sessionId ? getSession(sessionId) : null
        const sessRole = sess ? getRole(sess.email) : 'user'

        if (!sess || !["admin", 'owner'].includes(sessRole)) {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ 'error': 'forbidden' }));
          return
        }

        if (!targetEmail || !newRole) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'email and role required' }));
          return
        }

        const validRoles = ['user', 'mod', 'admin', 'owner'];
        if (!validRoles.includes(newRole)) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid role' }));
          return
        }

        if (targetEmail === sess.email) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: "can't change your own role" }));
          return
        }

        if (sessRole === "admin" && !["user", "mod"].includes(newRole)) {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'admins can only promote to mod' }));
          return
        }

        const currentRole = getRole(targetEmail)
        req.actionAuditDetails = { previousRole: currentRole };
        if (currentRole === 'owner' && sessRole !== 'owner') {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'only owner can set/remove owner role' }));
          return
        }

        if (targetEmail.endsWith('@guest')) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'guests cannot have roles' }));
          return
        }

        setRole(targetEmail, newRole)

        try {
          const list = await clerk.users.getUserList({
            emailAddress: [targetEmail],
            limit: 1
          })
          const clerkUser = list.data?.[0]

          if (clerkUser) {
            await clerk.users.updateUserMetadata(clerkUser.id, {
              publicMetadata: { role: newRole }
            });
          }
        } catch (e) {
          console.error('failed to update clerk metadata', e);
        }
        forEachUserSocket(targetEmail, (s) => {
          s.userRole = newRole;
        })

        if (["mod", 'admin', 'owner'].includes(newRole)) {
          setVerified(targetEmail)
          forEachUserSocket(targetEmail, (s) => {
            s.cachedVerified = true
          });
        } else if (newRole === 'user') {
          if (currentRole === "mod") {
            removeVerified(targetEmail)
            forEachUserSocket(targetEmail, (s) => {
              s.cachedVerified = false
            })
          }
        }

        // Emit to admin users for auto-refresh
        for (const [, s] of io.sockets.sockets) {
          if (['admin', 'owner'].includes(s.userRole)) {
            s.emit('userRoleChanged', targetEmail);
          }
        }

        emitAllUserLists()

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        console.error('role endpoint error: ', e)
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid request' }));
      }
    })
    return
  }

  if (url.pathname === "/admin/user/revoke-session" && req.method === "POST") {
    let body = ''
    req.on('data', (d) => { body += d });
    req.on('end', async () => {
      try {
        const { session: sessionId, sessionId: targetSessionId } = JSON.parse(body)
        const sess = sessionId ? getSession(sessionId) : null
        const sessRole = sess ? getRole(sess.email) : "user"

        if (!sess || !['admin', 'owner'].includes(sessRole)) {
          res.writeHead(403, { "content-type": 'application/json' });
          res.end(JSON.stringify({ error: 'forbidden' }));
          return
        }

        if (!targetSessionId) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'sessionId required' }));
          return
        }

        try {
          await clerk.sessions.revokeSession(targetSessionId)

          clerkSessionCache.set(targetSessionId, {
            active: false,
            checkedAt: Date.now()
          });

          for (const [, s] of io.sockets.sockets) {
            if (s.clerkSessionId === targetSessionId) {
              s.emit('kicked', 'session revoked by admin')
              s.skipLeaveMessage = true
              s.disconnect()
            }
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          console.error('failed to revoke session: ', e);
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'failed to revoke session' }));
        }
      } catch (e) {
        console.error('revoke-session error: ', e);
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid request' }));
      }
    })
    return
  }

  if (url.pathname === "/admin/user/revoke-all-sessions" && req.method === "POST") {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on('end', async () => {
      try {
        const { session: sessionId, email: targetEmail } = JSON.parse(body);
        const sess = sessionId ? getSession(sessionId) : null
        const sessRole = sess ? getRole(sess.email) : 'user'

        if (!sess || !["admin", 'owner'].includes(sessRole)) {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'forbidden' }));
          return
        }

        if (!targetEmail) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'email required' }));
          return;
        }

        if (targetEmail === sess.email) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'cannot revoke your own sessions' }));
          return
        }

        if (targetEmail.endsWith('@guest')) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'guest users do not have clerk sessions' }));
          return
        }

        let clerkId = null
        const sessionRow = db.prepare(
          "SELECT clerk_id FROM sessions WHERE email = ? AND clerk_id IS NOT NULL LIMIT 1"
        ).get(targetEmail)
        clerkId = sessionRow?.clerk_id || null

        if (!clerkId) {
          try {
            const list = await clerk.users.getUserList({
              emailAddress: [targetEmail],
              limit: 1
            })
            clerkId = list.data?.[0]?.id || null;
          } catch (e) {
            console.error('failed to fetch clerk id: ', e);
          }
        }
        if (!clerkId) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, revokedCount: 0 }));
          return
        }

        try {
          const activeSessions = await getActiveClerkSessions(clerkId);
          let revokedCount = 0;
          let failedCount = 0;

          for (const sess of activeSessions) {
            if (sess.status === "active") {
              try {
                await clerk.sessions.revokeSession(sess.id);
                clerkSessionCache.set(sess.id, {
                  active: false,
                  checkedAt: Date.now()
                })
                revokedCount++;
              } catch (e) {
                failedCount++;
                console.error(`failed to revoke session ${sess.id}: `, e)
              }
            }
          }

          forEachUserSocket(targetEmail, (s) => {
            s.emit('kicked', 'session revoked by admin')
            s.skipLeaveMessage = true
            s.disconnect()
          })

          res.writeHead(failedCount ? 500 : 200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(failedCount
            ? { error: `failed to revoke ${failedCount} session(s); ${revokedCount} revoked`, revokedCount, failedCount }
            : { success: true, revokedCount }));
        } catch (e) {
          console.error("Failed to revoke sessions:", e);
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "failed to revoke sessions" }));
        }
      } catch (e) {
        console.error("/admin/user/revoke-all-sessions error:", e);
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid request" }));
      }
    })
    return
  }

  if (url.pathname === "/admin/user/ban-clerk" && req.method === "POST") {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on('end', async () => {
      try {
        const { session: sessionId, email: targetEmail } = JSON.parse(body);
        const sess = sessionId ? getSession(sessionId) : null;
        const sessRole = sess ? getRole(sess.email) : "user";

        if (!sess || sessRole !== "owner") {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "owner only" }));
          return;
        }

        if (!targetEmail) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "email required" }));
          return;
        }

        if (targetEmail === sess.email) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "cannot ban yourself" }));
          return;
        }

        if (targetEmail.endsWith("@guest")) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "cannot Clerk-ban guest users" }));
          return;
        }
        let clerkId = null;
        const sessionRow = db.prepare(
          "SELECT clerk_id FROM sessions WHERE email = ? AND clerk_id IS NOT NULL LIMIT 1"
        ).get(targetEmail);
        clerkId = sessionRow?.clerk_id || null;

        if (!clerkId) {
          try {
            const list = await clerk.users.getUserList({
              emailAddress: [targetEmail],
              limit: 1
            });
            clerkId = list.data?.[0]?.id || null;
          } catch (e) {
            console.error("failed to find clerk id: ", e);
          }
        }

        if (!clerkId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "no clerk account found" }));
          return;
        }
        try {
          await clerk.users.banUser(clerkId)

          addBan(targetEmail, 'clerk account banned')

          forEachUserSocket(targetEmail, (s) => {
            s.emit('banned', 'clerk account banned')
            s.skipLeaveMessage = true
            s.disconnect()
          })

          emitAllUserLists()

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          console.error('failed to clerk ban: ', e);
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'failed to ban' }));
        }
      } catch (e) {
        console.error('clerk ban endpoint error: ', e);
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid request' }));
      }
    })
    return
  }

  if (url.pathname === "/admin/user/unban" && req.method === "POST") {
    let body = ''
    req.on('data', (d) => {body += d})
    req.on('end', async () => {
      try {
        const { session: sessionId, email: targetEmail } = JSON.parse(body)
        const sess = sessionId ? getSession(sessionId) : null
        const sessRole = sess ? getRole(sess.email) : 'user'

        if (!sess || !['admin', 'owner'].includes(sessRole)) {
          res.writeHead(403, {'content-type': 'application/json'})
          res.end(JSON.stringify({error: 'forbidden'}))
          return
        }

        if (!targetEmail) {
          res.writeHead(400, {'content-type': 'application/json'})
          res.end(JSON.stringify({error: 'email required'}))
          return
        }

        removeIpBan(getBanIp(targetEmail))
        removeBan(targetEmail)

        for (const [,s] of io.sockets.sockets) {
          if (['admin', 'owner'].includes(s.userRole)) {
            s.emit('userUnbanned', targetEmail)
          }
        }

        emitAllUserLists()

        res.writeHead(200, {'content-type': 'application/json'})
        res.end(JSON.stringify({success: true}))
      } catch (e) {
        console.error('unban endpoint error:', e);
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal server error' }));
      }
    })
    return
  }

  if (url.pathname === "/admin/user/clerk-status" && req.method === "GET") {
    try {
      const sessionId = parseCookies(req).session;
      const targetEmail = url.searchParams.get('email')

      const sess = sessionId ? getSession(sessionId) : null
      const sessRole = sess ? getRole(sess.email) : 'user'

      if (!sess || !['admin', 'owner'].includes(sessRole)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'forbidden' }));
        return;
      }

      if (!targetEmail) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'email required' }));
        return;
      }

      if (targetEmail.endsWith('@guest')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ clerkBanned: false }));
        return;
      }

      try {
        const list = await clerk.users.getUserList({
          emailAddress: [targetEmail],
          limit: 1
        });
        const clerkUser = list.data?.[0];

        if (!clerkUser) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ clerkBanned: false }));
          return;
        }

        const clerkBanned = clerkUser.banned || false;

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ clerkBanned }));
      } catch (e) {
        console.error('failed to check clerk ban status:', e);
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to check clerk ban status' }));
      }
    } catch (e) {
      console.error('clerk status error:', e);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'failed to check clerk ban status' }));
    }
    return
  }

  if (url.pathname === "/messages") {
    const messagesIp =
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.socket.remoteAddress;
    if (!checkRateLimit(messagesIp, "messages", 10, 60 * 1000)) {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "rate limited" }));
      return;
    }
    const now2 = Date.now();
    if (!messagesCache || now2 - messagesCache.at > 5000) {
      const all = getAllHistory()
        .filter((m) => !m.system)
        .map(
          ({
            ownerEmail,
            isToken,
            isGuest,
            system,
            mentions,
            verified,
            ...m
          }) => m,
        );
      messagesCache = { at: now2, body: JSON.stringify({ messages: all }) };
    }
    res.writeHead(200, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    });
    res.end(messagesCache.body);
    return;
  }

  if (url.pathname === "/privacy") {
    const content = await readFile("../app/privacy.html"); // privacy.html is not included in this repo or project in general as it's mostly ai generated so it's not fair to include it in both this project or time stats
    res.writeHead(200, { "content-type": "text/html" });
    res.end(content);
    return;
  }

  if (url.pathname === "/terms") {
    const content = await readFile("../app/terms.html");
    res.writeHead(200, { "content-type": "text/html" });
    res.end(content);
    return;
  }

  // kicked landing page: clears the session (and cookie) and shows the reason
  if (url.pathname === "/kicked") {
    const sessionId = parseCookies(req).session;
    if (sessionId) deleteSession(sessionId);
    const kickReason = url.searchParams.get("reason") || "no reason given";
    const html = await renderPage("kicked.html", {
      REASON: escapeHtml(kickReason),
    });
    res.writeHead(200, {
      "content-type": "text/html",
      "Set-Cookie": clearSessionCookie(),
    });
    res.end(html);
    return;
  }

  if (url.pathname === "/clerk-webhook" && req.method === "POST") {
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", async () => {
      try {
        const rawBody = Buffer.concat(chunks);

        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
        const fetchRequest = new Request(`http://internal${req.url}`, {
          method: "POST",
          headers,
          body: rawBody,
        });

        const event = await verifyWebhook(fetchRequest, {
          signingSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET,
        });

        if (
          event.type === "session.revoked" ||
          event.type === "session.ended" ||
          event.type === "session.removed"
        ) {
          const clerkSessionId = event.data.id;
          for (const [, s] of io.sockets.sockets) {
            if (s.clerkSessionId === clerkSessionId) {
              s.emit("kicked", "your session was ended");
              s.skipLeaveMessage = true;
              s.disconnect();
            }
          }
          clerkSessionCache.set(clerkSessionId, { active: false, checkedAt: Date.now() });
        }

        res.writeHead(200);
        res.end("ok");
      } catch (e) {
        console.error("clerk webhook error:", e);
        res.writeHead(400);
        res.end("invalid signature");
      }
    });
    return;
  }

  if (url.pathname === "/admin/reports" && req.method === "GET") {
    const staff = requireStaffPage(req, res);
    if (!staff) return;
    const html = await renderPage("reports.html", {
      ADMIN_NAV_LINKS: renderAdminNav(staff.role, "/admin/reports"),
      STAFF_ROLE: escapeHtml(staff.role),
    });
    res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
    res.end(html);
    return;
  }

  if (url.pathname === "/admin" && req.method === "GET") {
    if (!requireAdminPage(req, res)) return
    const html = await renderPage("admin.html", {})
    res.writeHead(200, { "content-type": "text/html" })
    res.end(html)
    return
  }

  if (url.pathname === "/admin/users" && req.method === "GET") {
    if (!requireAdminPage(req, res)) return
    const html = await renderPage("users.html", {})
    res.writeHead(200, { "content-type": "text/html" })
    res.end(html)
    return
  }

  if (url.pathname === "/admin/emoji" && req.method === "GET") {
    if (!requireAdminPage(req, res)) return
    const html = await renderPage("emoji.html", {})
    res.writeHead(200, { "content-type": "text/html" })
    res.end(html)
    return
  }

  if (url.pathname === "/admin/logs" && req.method === "GET") {
    if (!requireAdminPage(req, res)) return
    const html = await renderPage("logs.html", {})
    res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" })
    res.end(html)
    return
  }

  // server-side routing for the root page: pick login / ban / maintenance / chat
  // based on the cookie session, mirroring the socket auth middleware
  if (req.method === "GET" && url.pathname === "/") {
    const user = getRequestUser(req);
    const isOwner = user && getRole(user.email) === "owner";

    if (maintenance && !isOwner) {
      const html = await renderPage("maintenance.html", {
        REASON: reason ? `<p>${escapeHtml(reason)}</p>` : "",
      });
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      res.end(html);
      return;
    }

    if (user && isBanned(user.email)) {
      const html = await renderPage("ban.html", {
        REASON: escapeHtml(getBanReason(user.email) || "no reason given"),
      });
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      res.end(html);
      return;
    }

    if (!user) {
      const err = url.searchParams.get("error");
      const messages = [];
      if (guestsDisabled)
        messages.push(
          '<p style="color: var(--muted)">guest logins are currently disabled</p>',
        );
      if (err === "rate_limited" || err === "guests_disabled")
        messages.push(
          '<p style="color: var(--muted)">you\'re doing that too much, try again later</p>',
        );
      const guestSection = guestsDisabled
        ? '<button disabled style="opacity:0.6;cursor:not-allowed"><i class="ti ti-user"></i> continue as guest</button>'
        : '<button id="guest-btn"><i class="ti ti-user"></i> continue as guest</button><div id="guest-name-form" style="display:none;flex-direction:column;gap:8px;margin-top:4px"><input id="guest-name-input" type="text" placeholder="choose a username" maxlength="20" autocomplete="new-password"><p id="guest-name-error" style="display:none;color:var(--pink);margin:0;font-size:0.85em"></p><div style="display:flex;gap:8px"><button id="guest-name-cancel" type="button" style="flex:1">cancel</button><button id="guest-name-submit" style="flex:2">enter chat</button></div></div>';
      const html = await renderPage("login.html", {
        GUEST_SECTION: guestSection,
        MESSAGES: messages.join("\n        "),
        CLERK_KEY: getClerkKey(req)
      });
      const headers = { "content-type": "text/html", "cache-control": "no-store" };
      // drop a stale cookie whose session no longer resolves
      if (parseCookies(req).session) headers["Set-Cookie"] = clearSessionCookie();
      res.writeHead(200, headers);
      res.end(html);
      return;
    }
    // authenticated, not banned, not in maintenance → fall through to index.html
    const html = await renderPage("index.html", { CLERK_KEY: getClerkKey(req) });
    res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
    res.end(html);
    return;
  }

  if (req.method === "GET") {
    let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    try {
      const appDir = resolve(process.cwd(), "../app");
      const resolvedPath = resolve(appDir, `.${normalize(filePath)}`);
      if (
        resolvedPath !== appDir &&
        !resolvedPath.startsWith(`${appDir}${sep}`)
      ) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      const data = await readFile(resolvedPath);
      const ext = extname(filePath);
      res.writeHead(200, { "content-type": types[ext] || "text/plain" });
      res.end(data);
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(404);
        res.end("not found");
      }
    }
    return;
  }
});

httpServer.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
