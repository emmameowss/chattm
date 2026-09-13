# API

chat™ API documentation, most of this is used exclusively by the site but once again it's 5am so why not document it all, helps me as well

## Auth

there are two ways a request proves who it is, and which one a route wants depends on the route:

* **cookie** - the `session` cookie, set on `/clerk-login` and `/guest`. used by the server-rendered pages, `/me`, `/upload`, and every admin `GET`
* **body field** - a `"session"` key inside the JSON body. used by every admin `POST`

the session id is the same value either way, it's just stored in both a cookie and localstorage

## Sign-in/session

### `POST /clerk-login`
verifies a clerk JWT and starts a new session on the site that's saved to localstorage

**body:** `{ "token": "<clerk session jwt>" }`

**response:** `{ "session": "<session id>" }`

**rate limit:** 30/hour per IP

### `GET /me`
returns most basic identity possible

returns 401 if session is invalid

**response:** `{ "username": string | null, "guest": boolean }`

### `GET /guest?username=[username]`
creates a new guest session, disabled if guest logins are turned off. the username is ignored if it's invalid or already taken

**rate limit:** 10/hour per IP

### `GET /signout`
deletes your session and clears the cookie

---

## Profile/uploads

### `POST /upload?avatar=<0|1>`
uploads a file to R2

refuses banned users, and refuses muted users for everything except avatars

**response:** `{ url: "<public s3 url>" }`

**rate limit:** 50/hour per IP

---

## Emoji

emoji live in R2 under the `emojis/` prefix and are synced into the database at startup and on `/reloademojis`. there is no submission queue - emoji are added by putting them in the bucket

### `GET /admin/emoji/list`
every custom emoji currently known

**response:** `{ "emojis": [{ "shortcode": string, "url": string }] }`

**requires:** admin/owner

### `POST /admin/emoji/delete`
removes an emoji from the database and deletes the object from R2

**body:** `{ "session": string, "shortcode": string }`

**requires:** admin/owner

---

## Public Info

### `GET /maintenance`
**response:** `{ "maintenance": boolean, "reason": string, "guestsDisabled": boolean}`

### `GET /config`
**response:** `{ "port": number }`

### `GET /stats`
cached (10m) server-wide stats

**response:** `{ "users": number, "messages": number, "emoji": number, "totalSize": number, "uploads": number }`

### `GET /channels`
**response:** `{ "channels": [{ "name": string, "created_at": number }] }`

### `GET /version`
compares local git HEAD to github repo and reports how far ahead/behind it is

`?refresh=1` skips the 10 minute cache, and is ignored for anyone who isn't admin/owner

**response:** `{ "upToDate": boolean | null, "behind"?: number, "ahead"?: number, "latestCommit": string, "currentCommit": string }`

**rate limit:** 30/minute per IP

### `GET /messages`
public message dump (all channels, 5s cached)

**response:** `{ "messages": [...] }`

**rate limit:** 10/minute per IP

---

## Admin (home)

every one of these takes the session in the body and re-checks the role on each call

### `POST /admin/mutechat`
toggles chat-wide mute, persists across restarts

**body:** `{ "session": string }`

**response:** `{ "success": true, "muted": boolean }`

**requires:** owner

### `POST /admin/maintenance`
a non-empty reason turns maintenance on, an empty one turns it off

**body:** `{ "session": string, "reason": string }`

**requires:** owner

### `POST /admin/clear`
wipes the messages in one channel

**body:** `{ "session": string, "channel"?: string }` (defaults to `main`)

**requires:** admin/owner

### `POST /admin/verify` / `POST /admin/unverify`
grants or removes the blue check. verifying also promotes a plain user to mod, unverifying demotes a mod back to user

**body:** `{ "session": string, "email": string }`

**requires:** owner

### `POST /admin/redverify` / `POST /admin/unredverify`
grants or removes the red check

**body:** `{ "session": string, "email": string }`

**requires:** owner

### `POST /admin/hide` / `POST /admin/unhide`
hides or unhides someone from the user list

**body:** `{ "session": string, "email": string }`

**requires:** admin/owner

---

## Admin (users)

`ban`, `kick`, `mute` and `role` all refuse to act on a target whose role is equal to or higher than yours

### `GET /admin/user/info?email=<email>`
everything the admin panel shows about one user

**requires:** admin/owner

### `GET /admin/user/sessions?email=<email>`
that user's active clerk sessions

**requires:** admin/owner

### `GET /admin/user/clerk-status?email=<email>`
**response:** `{ "clerkBanned": boolean }`

**requires:** admin/owner

### `POST /admin/user/ban`
bans the account and the IP it was last seen on. the IP is recorded on the ban row so unbanning can reverse it

**body:** `{ "session": string, "email": string, "reason"?: string }`

**requires:** admin/owner

### `POST /admin/user/unban`
lifts the ban and the IP ban that came with it

**body:** `{ "session": string, "email": string }`

**requires:** admin/owner

### `POST /admin/user/kick`
**body:** `{ "session": string, "email": string, "reason"?: string }`

**requires:** mod/admin/owner

### `POST /admin/user/mute` / `POST /admin/user/unmute`
duration is in minutes, omit it for a permanent mute

**body:** `{ "session": string, "email": string, "duration"?: number, "reason"?: string }`

**requires:** mod/admin/owner

### `POST /admin/user/role`
writes the role locally and back to clerk `publicMetadata.role`. admins can only set `user` or `mod`, only an owner can set or remove `owner`, and nobody can change their own

**body:** `{ "session": string, "email": string, "role": "user"|"mod"|"admin"|"owner" }`

**requires:** admin/owner

### `POST /admin/user/revoke-session`
revokes one clerk session by id

**body:** `{ "session": string, "sessionId": string }`

**requires:** admin/owner

### `POST /admin/user/revoke-all-sessions`
**body:** `{ "session": string, "email": string }`

**response:** `{ "success": true, "revokedCount": number }`

**requires:** admin/owner

### `POST /admin/user/ban-clerk`
bans the clerk account itself, not just the chat account

**body:** `{ "session": string, "email": string }`

**requires:** owner

---

## Webhooks

### `POST /clerk-webhook`
verified with `CLERK_WEBHOOK_SIGNING_SECRET`. on `session.revoked`, `session.ended` or `session.removed` the matching sockets are disconnected
