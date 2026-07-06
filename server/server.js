import "dotenv/config";
import { Server } from "socket.io";
import { createServer } from "http";
import formidable from "formidable";
import fetch from "node-fetch";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { readFile, appendFile } from "fs/promises";
import { extname, normalize, resolve, sep } from "path";
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
  getCredential,
  createCredential,
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
  addBan,
  removeBan,
  isIpBanned,
  addIpBan,
  removeIpBan,
  getFilterWords,
  addFilterWord,
  removeFilterWord,
  getSetting,
  setSetting,
  migrateFromFiles,
  deleteAllGuestSessions,
  getStoredUsername,
  saveUsername,
  getEmailByUsername,
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
  addPendingEmoji,
  getPendingEmojis,
  getPendingEmojisByEmail,
  getPendingEmojiById,
  getPendingEmojiByShortcode,
  updatePendingEmoji,
} from "./db.js";

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
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// migrate from legacy files on first run
await migrateFromFiles();

// sync emojis from S3 emojis/ folder into DB on startup
async function syncEmojisFromS3() {
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
  },
  10 * 60 * 1000,
);
/*
const ownercmds = [
  "/ban", +
  "/removefilter", +
  "/addfilter", +
  "/reloadfilter", +
  "/unban", +
  "/mute", +
  "/setcolor", +
  "/unmute", +
  "/resetstrikes", +
  "/clear", +
  "/mutechat", +
  "/unmutechat", +
  "/maintenance", +
  "/unbanip", +
  "/whois", +
  "/kick", +
  "/noguests", +
  "/allowguests", +
  "/addemoji", (removed/replaced)
  "/removeemoji", (removed/replaced)
  "/reloademojis", +
  "/verify", +
  "/unverify", +
  "/redverify", +
  "/unredverify", +
];
*/

const commands = {
  "/ban": {
    ownerOnly: true,
    run: async (socket, rest, data) => {
      const args = rest.split(" ");
      let target = args[0];
      const banReason = args.slice(1).join(" ") || "no reason given";
      if (!target.includes("@")) {
        target =
          findSocketByUsername(target)?.userEmail ?? getEmailByUsername(target);
        if (!target) {
          socket.emit("commandError", `no user found with username ${args[0]}`);
          return;
        }
      }
      const targetEmail = target;
      addBan(targetEmail, banReason);
      await appendFile(
        "bans.log",
        `${new Date().toISOString()}: ${socket.userEmail} (${data.username}) banned ${targetEmail} - reason: ${banReason}\n`,
      );
      for (const [, s] of io.sockets.sockets) {
        if (s.userEmail === targetEmail) {
          addIpBan(s.userIP);
          s.emit("banned", banReason);
          s.skipLeaveMessage = true;
          s.disconnect();
        }
      }
      socket.emit("commandError", `banned ${targetEmail}`);
    },
  },
  "/unban": {
    ownerOnly: true,
    run: (socket, rest) => {
      removeBan(rest);
      socket.emit("commandError", `unbanned ${rest}`);
    },
  },
  "/unbanip": {
    ownerOnly: true,
    run: (socket, rest) => {
      removeIpBan(rest);
      socket.emit("commandError", `unbanned ${rest}`);
    },
  },
  "/kick": {
    ownerOnly: true,
    run: async (socket, rest, data) => {
      const [targetUsername, ...reasonParts] = rest.split(" ");
      const kickReason = reasonParts.join(" ") || "kicked by server";
      if (!targetUsername) {
        socket.emit("commandError", "usage: /kick <username> [reason]");
        return;
      }
      const target = findSocketByUsername(targetUsername);
      if (!target) {
        socket.emit(
          "commandError",
          `no user found with username ${targetUsername}`,
        );
        return;
      }
      target.emit("kicked", kickReason);
      target.skipLeaveMessage = true;
      target.disconnect();
      socket.emit("commandError", `kicked ${targetUsername}`);
      await appendFile(
        "kicks.log",
        `${new Date().toISOString()}: ${socket.userEmail} (${data.username}) kicked ${targetUsername} - reason: ${kickReason}\n`,
      );
    },
  },
  "/mute": {
    ownerOnly: true,
    run: async (socket, rest) => {
      const args = rest.split(" ");
      const targetUsername = args[0];
      const durationStr = args[1];
      const muteReason = args.slice(2).join(" ") || "no reason given";
      const targetEmail =
        findSocketByUsername(targetUsername)?.userEmail ?? null;
      if (!targetEmail) {
        socket.emit(
          "commandError",
          `no user found with username ${targetUsername}`,
        );
        return;
      }
      const durationMs = durationStr ? parseDuration(durationStr) : null;
      if (durationStr && !durationMs) {
        socket.emit("commandError", "invalid duration format");
        return;
      }
      setMute(
        targetEmail,
        muteReason,
        durationMs ? Date.now() + durationMs : null,
      );
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
      );
    },
  },
  "/unmute": {
    ownerOnly: true,
    run: (socket, rest) => {
      const targetUsername = rest;
      const targetEmail =
        findSocketByUsername(targetUsername)?.userEmail ?? null;
      if (!targetEmail || !getMute(targetEmail)) {
        socket.emit("commandError", `${targetUsername} is not muted`);
        return;
      }
      deleteMute(targetEmail);
      forEachUserSocket(targetEmail, (s) => s.emit("unmuted"));
      socket.emit("commandError", `unmuted ${targetUsername}`);
    },
  },
  "/clear": {
    ownerOnly: true,
    run: (socket) => {
      clearMessages(socket.currentChannel);
      io.to(roomOf(socket.currentChannel).emit("clear"));
    },
  },
  "/mutechat": {
    ownerOnly: true,
    run: () => {
      chatMuted = true;
      io.emit("mutechat", "chat has been muted");
    },
  },
  "/unmutechat": {
    ownerOnly: true,
    run: () => {
      chatMuted = false;
      io.emit("unmutechat", "chat has been unmuted");
    },
  },
  "/status": {
    ownerOnly: true,
    run: (socket, rest) => {
      status = rest;
      socket.emit("status", status);
    },
  },
  "/reloadfilter": {
    ownerOnly: true,
    run: (socket) => {
      loadFilterWordsIntoMemory();
      socket.emit("commandError", `${filteredwords.length} loaded`);
    },
  },
  "/resetstrikes": {
    ownerOnly: true,
    run: (socket, rest) => {
      const targetUsername = rest;
      const targetEmail =
        findSocketByUsername(targetUsername)?.userEmail ?? null;
      if (!targetEmail) {
        socket.emit(
          "commandError",
          `no user found with username ${targetUsername}`,
        );
        return;
      }
      deleteStrikes(targetEmail);
      socket.emit("commandError", `reset strikes for ${targetUsername}`);
    },
  },
  "/noguests": {
    ownerOnly: true,
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
      socket.emit("commandError", "guest logins have been disabled");
    },
  },
  "/allowguests": {
    ownerOnly: true,
    run: (socket) => {
      guestsDisabled = false;
      setSetting("guests_disabled", "0");
      socket.emit("commandError", "guest logins have been reenabled");
    },
  },
  "/reloademojis": {
    ownerOnly: true,
    run: async (socket) => {
      await syncEmojisFromS3();
      socket.emit("commandError", "emoji sync complete");
    },
  },
  "/whois": {
    ownerOnly: true,
    run: (socket, rest) => {
      const found = findSocketByUsername(rest);
      if (found) {
        socket.emit("commandError", `${rest}: ${found.userEmail}`);
      } else {
        socket.emit("commandError", `no user found with username "${rest}"`);
      }
    },
  },
  "/removefilter": {
    ownerOnly: true,
    run: (socket, rest) => {
      const word = rest.toLowerCase();
      if (!filteredwords.includes(word)) {
        socket.emit("commandError", `${word} is not in the filter`);
        return;
      }
      removeFilterWord(word);
      loadFilterWordsIntoMemory();
      socket.emit("commandError", `removed ${word} from the filter`);
    },
  },
  "/addfilter": {
    ownerOnly: true,
    run: (socket, rest) => {
      const word = rest.toLowerCase();
      if (!word) {
        socket.emit("commandError", "you need to specify a word");
        return;
      }
      addFilterWord(word);
      loadFilterWordsIntoMemory();
      socket.emit("commandError", `added ${word} into the filter`);
    },
  },
  "/setcolor": {
    ownerOnly: true,
    run: (socket, rest) => {
      const args = rest.split(" ");
      const targetUsername = args[0];
      const colorInput = args.slice(1).join(" ").toLowerCase();
      const targetEmail =
        findSocketByUsername(targetUsername)?.userEmail ?? null;
      if (!targetEmail) {
        socket.emit(
          "commandError",
          `no user found with username ${targetUsername}`,
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
        socket.emit("commandError", "please choose another color");
        return;
      }
      setColor(targetEmail, color);
      forEachUserSocket(targetEmail, (s) => s.emit("colorChanged", color));
      emitAllUserLists();
      socket.emit("commandError", `set ${targetUsername}'s color to ${color}`);
    },
  },
  "/maintenance": {
    ownerOnly: true,
    run: (socket, rest) => {
      maintenance = !maintenance;
      reason = maintenance ? rest : "";
      setSetting("maintenance", maintenance ? "1" : "0");
      setSetting("maintenance_reason", reason);
      for (const [, s] of io.sockets.sockets) {
        if (s.userEmail !== process.env.OWNER_EMAIL) {
          s.emit("maintenance", maintenance, reason);
          if (maintenance) s.disconnect();
        }
      }
      socket.emit(
        "commandError",
        maintenance ? "maintenance enabled" : "maintenance disabled",
      );
    },
  },
  "/verify": {
    ownerOnly: true,
    run: (socket, rest) => {
      setVerified(rest);
      forEachUserSocket(rest, (s) => {
        s.cachedVerified = true;
      });
      emitAllUserLists();
      socket.emit("commandError", `verified ${rest}`);
    },
  },
  "/unverify": {
    ownerOnly: true,
    run: (socket, rest) => {
      removeVerified(rest);
      forEachUserSocket(rest, (s) => {
        s.cachedVerified = false;
      });
      emitAllUserLists();
      socket.emit("commandError", `unverified ${rest}`);
    },
  },
  "/redverify": {
    ownerOnly: true,
    run: (socket, rest) => {
      setRedVerified(rest);
      forEachUserSocket(rest, (s) => {
        s.cachedRedVerified = true;
      });
      emitAllUserLists();
      socket.emit("commandError", `red verified ${rest}`);
    },
  },
  "/unredverify": {
    ownerOnly: true,
    run: (socket, rest) => {
      removeRedVerified(rest);
      forEachUserSocket(rest, (s) => {
        s.cachedRedVerified = false;
      });
      emitAllUserLists();
      socket.emit("commandError", `removed red verification from ${rest}`);
    },
  },
  "/nick": {
    ownerOnly: false,
    run: (socket, rest) => {
      const nick = rest;
      if (!isValidUsername(nick)) {
        socket.emit("commandError", "invalid username");
        return;
      }
      if (socket.userEmail.endsWith("@guest")) {
        socket.emit("commandError", "guests cannot change their username");
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
    ownerOnly: false,
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
        socket.emit("commandError", "please choose a different color");
        return;
      }
      setColor(socket.userEmail, color);
      socket.cachedColor = color;
      socket.emit("colorChanged", color);
      emitAllUserLists();
    },
  },
};

commands["/colour"] = commands["/color"];

let chatMuted = false;
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

function loadFilterWordsIntoMemory() {
  filteredwords.length = 0;
  getFilterWords().forEach((w) => filteredwords.push(w));
  console.log(`loaded ${filteredwords.length} filter words`);
}

const filteredwords = [];
loadFilterWordsIntoMemory();

function containsFilteredWord(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  return (
    filteredwords.find((w) =>
      new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(
        lower,
      ),
    ) || null
  );
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
  return /^[a-zA-Z0-9-]{1,20}$/.test(name);
}

// email/password accounts use the raw email as their identity, exactly like an
// OAuth account, so every command / lookup treats them identically (a password
// account for OWNER_EMAIL is the owner). guest emails (*@guest) can't be
// registered because isValidEmail requires a dot after the @.
function normalizeEmail(email) {
  return String(email ?? "")
    .trim()
    .toLowerCase();
}

function isValidEmail(email) {
  return email.length <= 100 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hashPassword(pw) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(pw, salt, 64).toString("hex")}`;
}

function verifyPassword(pw, stored) {
  const [scheme, salt, hash] = String(stored).split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const a = Buffer.from(hash, "hex");
  const b = scryptSync(pw, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
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
}, 10 * 1000);

const roomOf = (ch) => "channel:" + ch;

function emitAllUserLists() {
  for (const c of listChannels()) emitUserList(c.name);
}

function emitUserList(channel = "main") {
  const onlineEmails = new Set();
  const users = [];

  // online users: use data already cached on the socket - zero DB reads
  for (const [id, s] of io.sockets.sockets) {
    if (!s.username) continue;
    if (s.currentChannel !== channel) continue;
    onlineEmails.add(s.userEmail);
    users.push({
      username: s.username,
      email: s.userEmail,
      color: s.cachedColor ?? null,
      avatar: s.cachedAvatar ?? null,
      guest: s.userEmail.endsWith("@guest"),
      isOwner: s.userEmail === process.env.OWNER_EMAIL,
      verified: s.cachedVerified ?? false,
      redVerified: s.cachedRedVerified ?? false,
      status: s.cachedStatus ?? "online",
      online: true,
    });
  }

  // offline users: single JOIN query - all fields in one SELECT
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const row of getRecentUsers(cutoff)) {
    if (onlineEmails.has(row.email)) continue;
    users.push({
      username: row.username,
      email: row.email,
      color: row.color ?? null,
      avatar: row.avatar ?? null,
      guest: false,
      isOwner: row.email === process.env.OWNER_EMAIL,
      verified: !!row.verified,
      redVerified: !!row.red_verified,
      status: row.status ?? "online",
      online: false,
    });
  }

  // strip emails before broadcasting to this channel's clients
  const publicUsers = users.map(({ email, ...rest }) => rest);
  io.to(roomOf(channel)).emit("userlist", publicUsers);

  // send full data (with emails) only to owners viewing this channel
  for (const [, s] of io.sockets.sockets) {
    if (
      s.userEmail === process.env.OWNER_EMAIL &&
      s.username &&
      s.currentChannel === channel
    ) {
      s.emit("adminUserlist", users);
    }
  }
}

io.use((socket, next) => {
  const ip =
    socket.handshake.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    socket.handshake.address;
  if (!checkRateLimit(ip, "connect", 20, 60 * 1000))
    return next(new Error("rate limited"));
  const sessionId = socket.handshake.auth.session;
  const user = getSession(sessionId);
  if (!user) return next(new Error("not authenticated"));
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
  socket.username = null;
  if (maintenance && socket.userEmail !== process.env.OWNER_EMAIL) {
    return next(new Error("maintenance"));
  }
  next();
});

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

io.on("connection", (socket) => {
  socket.userIP =
    socket.handshake.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    socket.handshake.address;
  console.log(`${socket.userEmail} connected`);
  if (!socket.userEmail.endsWith("@guest")) setLastSeen(socket.userEmail);
  io.emit("usercount", io.engine.clientsCount);
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
    isOwner: socket.userEmail === process.env.OWNER_EMAIL,
    chatMuted,
    currentChannel: socket.currentChannel,
    uMuted: isMuted(socket.userEmail) ? getMute(socket.userEmail) : null,
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
        isOwner: email === process.env.OWNER_EMAIL,
        isGuest: email.endsWith("@guest"),
        online: isOnline,
        lastSeen: isOnline ? null : (profile.lastSeen ?? null),
      });
    } catch (e) {
      console.error("getProfile error:", e);
      socket.emit("profileData", null);
    }
  });

  socket.on("setAvatar", (url) => {
    if (socket.userEmail.endsWith("@guest")) return;
    const avatarBase = process.env.AWS_S3_PUBLIC_URL;
    if (
      !avatarBase ||
      typeof url !== "string" ||
      !url.startsWith(`${avatarBase}/avatars/`)
    )
      return;
    setAvatar(socket.userEmail, url);
    socket.cachedAvatar = url;
    socket.emit("savedAvatar", url);
    emitUserList(socket.currentChannel);
  });

  socket.on("deleteAvatar", () => {
    deleteAvatar(socket.userEmail);
    socket.cachedAvatar = null;
    socket.emit("savedAvatar", null);
    emitUserList(socket.currentChannel);
  });

  socket.on("setUsername", (name) => {
    if (!isValidUsername(name)) {
      socket.emit(
        "commandError",
        "invalid username, make sure it's within the character limit and uses only letters and numbers",
      );
      return;
    }
    const prevUser = socket.username;
    socket.username = name;
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
    io.emit("usercount", io.engine.clientsCount);
    emitUserList(socket.currentChannel);
  });

  socket.on("deleteMessage", (messageId) => {
    const history = getHistory(socket.currentChannel);
    const msg = history.find((m) => m.id === messageId);
    if (!msg) return;

    const isOwnerOfMsg = msg.ownerEmail === socket.userEmail;
    const isAdmin = socket.userEmail === process.env.OWNER_EMAIL;

    if (!isOwnerOfMsg && !isAdmin) {
      socket.emit("commandError", "you can only delete your own messages");
      return;
    }
    deleteMessage(messageId);
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
    if (socket.userEmail !== process.env.OWNER_EMAIL) return;
    const name = String(rawName ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-");
    if (!/^[a-z0-9-]{1,24}$/.test(name))
      return socket.emit(
        "commandError",
        "invalid channel name (use a-z, 0-9, - ; max 24)",
      );
    if (channelExists(name))
      return socket.emit("commandError", "channel already exists");
    createChannel(name, socket.userEmail);
    io.emit(
      "channels",
      listChannels().map((c) => c.name),
    );
  });

  socket.on("deleteChannel", (rawName) => {
    if (socket.userEmail !== process.env.OWNER_EMAIL) return;
    const name = String(rawName ?? "")
      .trim()
      .toLowerCase();
    if (name === "main")
      return socket.emit("commandError", "the main channel cannot be deleted");
    if (!channelExists(name)) return;
    deleteChannel(name);
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
      socket.userEmail !== process.env.OWNER_EMAIL
    ) {
      const m = getMute(socket.userEmail);
      socket.emit(
        "commandError",
        `you are muted${m.until ? " until " + new Date(m.until).toLocaleString() : ""} - reason: ${m.reason}`,
      );
      return;
    }

    const now = Date.now();
    // verified users (and the owner) bypass the message cooldown
    const bypassCooldown =
      socket.cachedVerified ||
      socket.cachedRedVerified ||
      socket.userEmail === process.env.OWNER_EMAIL;
    if (
      !bypassCooldown &&
      lastmessage[socket.userEmail] &&
      now - lastmessage[socket.userEmail] < msgcooldown
    ) {
      socket.emit("commandError", "slow down");
      return;
    }
    lastmessage[socket.userEmail] = now;

    if (chatMuted && socket.userEmail !== process.env.OWNER_EMAIL) {
      socket.emit("commandError", "chat is currently muted");
      return;
    }

    const raw = data.text ?? "";
    if (raw.startsWith("/")) {
      const sp = raw.indexOf(" ");
      const name = sp === -1 ? raw : raw.slice(0, sp);
      const rest = sp === -1 ? "" : raw.slice(sp + 1).trim();
      const cmd = commands[name];
      if (cmd) {
        if (cmd.ownerOnly && socket.userEmail !== process.env.OWNER_EMAIL) {
          socket.emit(
            "commandError",
            "you don't have permission to use this command",
          );
          return;
        }
        await cmd.run(socket, rest, data);
        return;
      }
    }

    const timestamp = new Date().toISOString();
    await appendFile(
      "messages.log",
      `${timestamp}: ${socket.userEmail} (${data.username}): ${data.text || "[image]"}\n`,
    );
    const replyTo =
      typeof data.replyTo === "string" && getMessageById(data.replyTo)
        ? data.replyTo
        : null;
    const message = {
      ...data,
      id: randomUUID(),
      ownerEmail: socket.userEmail,
      username: socket.username,
      time: Date.now(),
      channel: socket.currentChannel,
      isToken: socket.userEmail === process.env.OWNER_EMAIL,
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

httpServer.on("request", async (req, res) => {
  if (req.url.includes("socket.io")) return;

  const url = new URL(
    req.url,
    `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`,
  );

  if (url.pathname === "/login") {
    const authUrl = `https://auth.hackclub.com/oauth/authorize?client_id=${process.env.HCA_CLIENT_ID}&redirect_uri=${process.env.HCA_REDIRECT_URI}&response_type=code&scope=email`;
    res.writeHead(302, { location: authUrl });
    res.end();
    return;
  }

  if (url.pathname === "/callback") {
    const cbIp =
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.socket.remoteAddress;
    if (!checkRateLimit(cbIp, "callback", 30, 60 * 60 * 1000)) {
      res.writeHead(302, { Location: "/?error=rate_limited" });
      res.end();
      return;
    }
    const code = url.searchParams.get("code");
    const tokenRes = await fetch("https://auth.hackclub.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.HCA_CLIENT_ID,
        client_secret: process.env.HCA_CLIENT_SECRET,
        redirect_uri: process.env.HCA_REDIRECT_URI,
        code,
        grant_type: "authorization_code",
      }),
    });
    const tokenJson = await tokenRes.json();
    const { access_token } = tokenJson;
    const userRes = await fetch("https://auth.hackclub.com/api/v1/me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const user = await userRes.json();
    if (!user.identity?.primary_email) {
      res.writeHead(302, { Location: "/?error=auth_denied" });
      res.end();
      return;
    }
    const { primary_email } = user.identity;
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.socket.remoteAddress;
    await appendFile(
      "login.log",
      `${new Date().toISOString()}: ${primary_email} signed in from ${ip}\n`,
    );
    const sessionid = randomBytes(32).toString("hex");
    saveSession(sessionid, { email: primary_email, ip });
    const redirectUrl = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}/#session=${sessionid}`;
    res.writeHead(302, {
      Location: redirectUrl,
      "Set-Cookie": sessionCookie(sessionid, req),
    });
    res.end();
    return;
  }

  if (url.pathname === "/me") {
    const sessionId = url.searchParams.get("session");
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
    const sessionId =
      url.searchParams.get("session") || parseCookies(req).session;
    if (sessionId) {
      deleteSession(sessionId);
    }
    res.writeHead(302, { Location: "/", "Set-Cookie": clearSessionCookie() });
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

    const uploadSessionId = url.searchParams.get("session");
    const uploadSession = uploadSessionId ? getSession(uploadSessionId) : null;
    if (!uploadSession) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: "Unauthorized" }));
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
          "image/svg+xml",
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
        const ext = extname(file.originalFilename || "");
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
    if (rawUsername && isValidUsername(rawUsername))
      saveUsername(guestEmail, rawUsername);
    const redirectUrl = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}/#session=${sessionid}`;
    res.writeHead(302, {
      Location: redirectUrl,
      "Set-Cookie": sessionCookie(sessionid, req),
    });
    res.end();
    return;
  }

  // email/password signup → creates an account keyed by the raw email + session
  if (url.pathname === "/signup" && req.method === "POST") {
    const signupIp =
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.socket.remoteAddress;
    if (!checkRateLimit(signupIp, "signup", 5, 60 * 60 * 1000)) {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "too many signups, try again later" }));
      return;
    }
    let body = "";
    req.on("data", (d) => {
      body += d;
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        const email = normalizeEmail(parsed.email);
        const username = String(parsed.username ?? "").trim();
        const password = String(parsed.password ?? "");
        const fail = (code, error) => {
          res.writeHead(code, { "content-type": "application/json" });
          res.end(JSON.stringify({ error }));
        };
        if (!isValidEmail(email))
          return fail(400, "enter a valid email address");
        if (password.length < 8 || password.length > 200)
          return fail(400, "password must be 8-200 characters");
        if (!isValidUsername(username))
          return fail(
            400,
            "username can only contain letters, numbers, and hyphens (max 20 chars)",
          );
        if (getCredential(email))
          return fail(409, "an account with that email already exists");
        if (getEmailByUsername(username))
          return fail(409, "that username is taken");

        const identity = email;
        createCredential(email, username, hashPassword(password));
        saveUsername(identity, username);
        const sessionid = randomBytes(32).toString("hex");
        saveSession(sessionid, { email: identity, ip: signupIp });
        res.writeHead(200, {
          "content-type": "application/json",
          "Set-Cookie": sessionCookie(sessionid, req),
        });
        res.end(JSON.stringify({ session: sessionid }));
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad request" }));
      }
    });
    return;
  }

  // email/password login
  if (url.pathname === "/pwlogin" && req.method === "POST") {
    const loginIp =
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.socket.remoteAddress;
    if (!checkRateLimit(loginIp, "pwlogin", 10, 15 * 60 * 1000)) {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "too many attempts, try again later" }));
      return;
    }
    let body = "";
    req.on("data", (d) => {
      body += d;
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        const email = normalizeEmail(parsed.email);
        const password = String(parsed.password ?? "");
        const cred = getCredential(email);
        // same message whether the email or the password is wrong
        if (!cred || !verifyPassword(password, cred.password_hash)) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "invalid email or password" }));
          return;
        }
        const identity = email;
        const sessionid = randomBytes(32).toString("hex");
        saveSession(sessionid, { email: identity, ip: loginIp });
        res.writeHead(200, {
          "content-type": "application/json",
          "Set-Cookie": sessionCookie(sessionid, req),
        });
        res.end(JSON.stringify({ session: sessionid }));
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad request" }));
      }
    });
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
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const vStatus = await getVersionStatus(forceRefresh);
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(vStatus));
    return;
  }

  if (url.pathname === "/suggest-emoji") {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }
    const suggestSessionId = url.searchParams.get("session");
    const suggestSession = suggestSessionId
      ? getSession(suggestSessionId)
      : null;
    if (!suggestSession || suggestSession.guest) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "must be logged in to suggest emojis" }));
      return;
    }
    const suggestIp =
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.socket.remoteAddress;
    if (!checkRateLimit(suggestIp, "suggest-emoji", 5, 60 * 60 * 1000)) {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ error: "rate limited - max 5 suggestions per hour" }),
      );
      return;
    }
    const form = formidable({ maxFileSize: 2 * 1024 * 1024 });
    form.parse(req, async (err, fields, files) => {
      if (err) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
      try {
        const shortcode = (fields.shortcode?.[0] ?? "").trim();
        const notes = (fields.notes?.[0] ?? "").trim().slice(0, 200);
        const submitterUsername = (fields.username?.[0] ?? "").trim();
        if (!/^:[a-z0-9_-]+:$/.test(shortcode)) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error:
                "invalid shortcode - use format :name: with lowercase letters, numbers, - or _",
            }),
          );
          return;
        }
        const existing = getCustomEmoji();
        if (existing[shortcode] || getPendingEmojiByShortcode(shortcode)) {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(
            JSON.stringify({ error: "that shortcode is already in use" }),
          );
          return;
        }
        if (!files.file?.[0]) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "no file uploaded" }));
          return;
        }
        const file = files.file[0];
        const imageTypes = [
          "image/png",
          "image/gif",
          "image/webp",
          "image/jpeg",
          "image/svg+xml",
        ];
        if (!imageTypes.includes(file.mimetype)) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: "only image files are allowed (PNG, GIF, WebP, JPEG, SVG)",
            }),
          );
          return;
        }
        const fileBuffer = await readFile(file.filepath);
        const ext = extname(file.originalFilename || "") || ".png";
        const isOwnerSubmit = suggestSession.email === process.env.OWNER_EMAIL;
        const s3Key = isOwnerSubmit
          ? `emojis/${shortcode.replace(/:/g, "")}${ext}`
          : `pending_emojis/${Date.now()}-${randomBytes(6).toString("hex")}${ext}`;
        await s3.send(
          new PutObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: s3Key,
            Body: fileBuffer,
            ContentType: file.mimetype,
            ACL: "public-read",
          }),
        );
        const publicUrl = `${process.env.AWS_S3_PUBLIC_URL}/${s3Key}`;
        const id = randomUUID();
        const now = Date.now();
        const pendingRow = {
          id,
          shortcode,
          s3_key: s3Key,
          url: publicUrl,
          submitter_email: suggestSession.email,
          submitter_username: submitterUsername || null,
          notes: notes || null,
          submitted_at: now,
        };
        if (isOwnerSubmit) {
          addCustomEmoji(shortcode, publicUrl);
          addPendingEmoji({
            ...pendingRow,
            status: "accepted",
            review_reason: "auto-approved",
          });
          io.emit("emojiUpdate", getCustomEmoji());
        } else {
          addPendingEmoji(pendingRow);
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, autoApproved: isOwnerSubmit }));
      } catch (e) {
        console.error("suggest-emoji error:", e);
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url.pathname === "/my-pending-emojis") {
    const mpeSessionId = url.searchParams.get("session");
    const mpeSession = mpeSessionId ? getSession(mpeSessionId) : null;
    if (!mpeSession) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const base = process.env.AWS_S3_PUBLIC_URL;
    const mpeItems = getPendingEmojisByEmail(mpeSession.email).map((r) => ({
      ...r,
      url: base ? `${base}/${r.s3_key}` : r.url,
    }));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(mpeItems));
    return;
  }

  if (url.pathname === "/pending-emojis") {
    const peSessionId = url.searchParams.get("session");
    const peSession = peSessionId ? getSession(peSessionId) : null;
    if (!peSession || peSession.email !== process.env.OWNER_EMAIL) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "forbidden" }));
      return;
    }
    const base = process.env.AWS_S3_PUBLIC_URL;
    const peItems = getPendingEmojis().map((r) => ({
      ...r,
      url: base ? `${base}/${r.s3_key}` : r.url,
    }));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(peItems));
    return;
  }

  if (url.pathname === "/admin/emoji/accept") {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }
    let body = "";
    req.on("data", (d) => {
      body += d;
    });
    req.on("end", async () => {
      try {
        const {
          id,
          session: bodySession,
          reason: acceptReason,
        } = JSON.parse(body);
        const sessionId = bodySession || url.searchParams.get("session");
        const sess = sessionId ? getSession(sessionId) : null;
        if (!sess || sess.email !== process.env.OWNER_EMAIL) {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "forbidden" }));
          return;
        }
        const pending = getPendingEmojiById(id);
        if (!pending) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "not found" }));
          return;
        }
        const ext = extname(pending.s3_key);
        const destKey = `emojis/${pending.shortcode.replace(/:/g, "")}${ext}`;
        await s3.send(
          new CopyObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            CopySource: `${process.env.AWS_S3_BUCKET}/${pending.s3_key}`,
            Key: destKey,
            ACL: "public-read",
          }),
        );
        await s3.send(
          new DeleteObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: pending.s3_key,
          }),
        );
        const newUrl = `${process.env.AWS_S3_PUBLIC_URL}/${destKey}`;
        addCustomEmoji(pending.shortcode, newUrl);
        updatePendingEmoji(
          id,
          "accepted",
          destKey,
          newUrl,
          acceptReason || null,
        );
        io.emit("emojiUpdate", getCustomEmoji());
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        console.error("emoji accept error:", e);
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url.pathname === "/admin/emoji/deny") {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }
    let body = "";
    req.on("data", (d) => {
      body += d;
    });
    req.on("end", async () => {
      try {
        const {
          id,
          session: bodySession,
          reason: denyReason,
        } = JSON.parse(body);
        const sessionId = bodySession || url.searchParams.get("session");
        const sess = sessionId ? getSession(sessionId) : null;
        if (!sess || sess.email !== process.env.OWNER_EMAIL) {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "forbidden" }));
          return;
        }
        const pending = getPendingEmojiById(id);
        if (!pending) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "not found" }));
          return;
        }
        const filename = pending.s3_key.split("/").pop();
        const deniedKey = `denied_emojis/${filename}`;
        await s3.send(
          new CopyObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            CopySource: `${process.env.AWS_S3_BUCKET}/${pending.s3_key}`,
            Key: deniedKey,
            ACL: "public-read",
          }),
        );
        await s3.send(
          new DeleteObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: pending.s3_key,
          }),
        );
        const deniedUrl = `${process.env.AWS_S3_PUBLIC_URL}/${deniedKey}`;
        updatePendingEmoji(
          id,
          "denied",
          deniedKey,
          deniedUrl,
          denyReason || null,
        );
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        console.error("emoji deny error:", e);
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
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

  // server-side routing for the root page: pick login / ban / maintenance / chat
  // based on the cookie session, mirroring the socket auth middleware
  if (req.method === "GET" && url.pathname === "/") {
    const user = getRequestUser(req);
    const isOwner = user && user.email === process.env.OWNER_EMAIL;

    if (maintenance && !isOwner) {
      const html = await renderPage("maintenance.html", {
        REASON: reason ? `<p>${escapeHtml(reason)}</p>` : "",
      });
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html);
      return;
    }

    if (user && isBanned(user.email)) {
      const html = await renderPage("ban.html", {
        REASON: escapeHtml(getBanReason(user.email) || "no reason given"),
      });
      res.writeHead(200, { "content-type": "text/html" });
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
      if (err === "auth_denied")
        messages.push(
          '<p style="color: var(--pink)">login was cancelled or denied</p>',
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
      });
      const headers = { "content-type": "text/html" };
      // drop a stale cookie whose session no longer resolves
      if (parseCookies(req).session) headers["Set-Cookie"] = clearSessionCookie();
      res.writeHead(200, headers);
      res.end(html);
      return;
    }
    // authenticated, not banned, not in maintenance → fall through to index.html
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
