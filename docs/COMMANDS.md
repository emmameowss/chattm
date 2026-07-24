# Commands

this is a list of all chat™ commands and what they do

written at 5am because I was bored

### Public
* `/nick [name]` - an easier way to change your username
* `/color [color (hex, rgb)|pride|trans|bi|lesbian|nb|gay]` - changes your name color

---

### Moderation
* `/ban [username/email] [reason]` - bans a user from logging into the chat, this includes their IP
* `/unban [email]` - unbans a user from the chat
* `/unbanip [ip]` - unbans a users ip from the chat, typically should be paired with also unbanning their account
* `/mute [username] [time] [reason]` - removes someone's ability to talk in the chat permanently or for a specified amount of time
* `/unmute [username]` - unmutes a user from the chat
* `/kick [username] [reason]` - disconnects someone from the chat but letting them rejoin
* `/whois [username]` - looks up a user's email by their name
* `/resetstrikes [username]` (deprecated) - resets a user's chat filter strikes

---

### Verification
* `/verify [email]` - "verifies" a user, this gives the a verified badge and basic moderation permissions
* `/unverify [email]` - removes a user's verification and moderation permissions
* `/redverify [email]` - cosmetic, no functional purpose, gives you a cool gradient name you can't usually get and a special badge
* `/unredverify [email]` - removes red verification (idk how else to call it)

---

### Admin
* `/clear` - clears the chat in the channel it's sent in
* `/mutechat` - mutes the current channel
* `/unmutechat` - unmutes the current channel
* `/status [text]` shows a "status" above the message input field globally
* `/maintenance [reason (optional)]` - toggles maintenance mode globally (no reason turns it off)
* `/noguests` - disables signing in as a guest and expires all currently active guest sessions
* `/allowguests` - reenables guest signins
* `/setcolor [username] [color|pride|trans|bi|lesbian|nb|gay]` - changes another user's name color

---

### Misc
* `/reloademojis` - fetches emojis from R2 and adds new ones to the database
