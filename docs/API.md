# API

chat™ API documentation, most of this is used exclusively by the site but once again it's 5am so why not document it all, helps me as well

## Auth
most routes/endpoints take a ?session= query, that's the only way to authenticate

## Sign-in/session

### `POST /clerk-login`
verifies a clerk JWT and starts a new session on the site that's saved to localstorage

**body:** `{ "token": "<clerk session jwt>" }`

**response:** `{ "session": "<session id>" }`

**rate limit:** 30/hour per IP

### `GET /me?session=<id>`
returns most basic identity possible

returns 401 if session is invalid

**response:** `{ "username": string | null, "guest:" boolean }`

### `GET /guest?username=[username]`
creates a new guest session, disabled if guest logins are turned off

**rate limit:** 10/hour per IP

### `GET /signout?session=<id>`
deletes your session and clears it from localstorage

---

## Profile/uploads

### `POST /upload?session=<id>&avatar=<0|1>`
uploads a file to R2

**response:** `{ url: "<public s3 url>" }`

**rate limit:** 50/hour per IP

---

## Emoji

### `POST /suggest-emoji?session=<id>`
emoji submission, submissions from owner/admin account are automatically approved

**fields:** `shortcode`, `file`, `notes` (optional), `username`

**response:** `{ "ok": true, "autoApproved": boolean }`

**rate limit:** 5/hour per IP

**requires:** non-guest session

### `GET /my-pending-emojis?session=<id>`
lists logged in user's submitted emojis and their review status

### `GET /pending-emojis?session=<id>`
lists all pending or reviewed emoji submissions

**requires:** admin/owner user role

### `POST /admin/emoji/accept`
approves a pending emoji and makes it available for use in the chat

**body:** `{ "id": string, "session": string, "reason"?: string }`

**requires:** admin/owner user role

### `POST /admin/emoji/deny`
rejects a pending emoji submission

**body:** `{ "id": string, "session": string, "reason"?: string }`

**requires:** admin/owner user role

---

## Public Info

### `GET /maintenance`
**response:** `{ "maintenance": boolean, "reason": string, "guestsDisabled": boolean}`

### `GET /config`
**response:** `{ "port": number }`

### `GET /stats`
cached (10m) server-wide stats

**response:** `{ "users": number, "messages": number, "emoji": number, "totalSize": number, "uploads": number }`

### `GET /version`
compares local git HEAD to github repo and reports how far ahead/behind it is

**response:** `{ "upToDate": boolean | null, "behind"?: number, "ahead"?: number, "latestCommit": string, "currentCommit": string }`

### `GET /messages`
public message dump (all channels, 5s cached)

**response:** `{ "messages": [...] }`

**rate limit:** 10/minute per IP
