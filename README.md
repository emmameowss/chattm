# chat™

### an incredibly simple literally bare minimum chat app

![interface of the site](https://cdn.hackclub.com/019e8027-6599-7668-bd82-ab9c84d20e58/CleanShot%202026-06-01%20at%2000.28.33@2x.png)

available at: https://chat.emmameowss.gay, currently supports images and text, please note that images are now permanently saved while ~~the most recent 25 text messages are saved and disappear upon server restart~~ all text messages are now stored forever

## Setup Instructions
1. clone the repository
2. in app/app.js, change const socket = io("wss://domainnotverified.emmameowss.gay) to your domain (good luck with this, for example: ws://randomdomain.com:3000 only add port if not reverse proxied)
3. in app/app.js, "change const res = await fetch('**https://chat.emmameowss.gay/upload**', {" to your domain
4. in server/server.js, add your domain to the cors allowed origins
5. in server/server.js, change "const url = new URL(req.url, '**https://chat.emmameowss.gay**')" to your domain
6. copy .env.example to .env
7. fill out the .env file with your HCA app details (obtain them at https://auth.hackclub.com) and your hack club CDN api key, preferrably also add your email to OWNER_EMAIL if you want the tag in the chat. this one isn't required and the site will function without it.
8. run npm i in server
9. do npm run start or npm run dev

## current features
- usernames
- name colors
- basic text and image sending
- crappy ui
- timestamps in messages
- an active user counter
- an unread message counter in the title of the tab
- an owner/crown tag
- a typing indicator
- 25 most recent messages are saved for everyone
- image storing and hosting with hack club cdn (this is allowed, right?)
- link detection in messages
- better status for uploading images instead of nothing
- file size error
- message sound effect
- HCA sign in

## planned features
- ~~message history~~
- ~~typing indicator~~
- ~~maybe: sound effect for message~~
- ~~link detection in messages~~
- ~~file size notification~~
