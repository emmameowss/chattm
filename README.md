# chat™

### an incredibly simple literally bare minimum chat app

![interface of the site](https://cdn.hackclub.com/019e7df7-00d8-78b2-a818-8952d38fd327/cleanshot_2026-05-31_at_14.16.01_2x.png)

available at: https://chat.emmameowss.gay, currently supports images and text, none of it saves so most of what you send gets thrown into the void

## Setup Instructions
1. clone the repository
2. in app/app.js, change const socket = io("wss://domainnotverified.emmameowss.gay) to your domain (good luck with this, for example: ws://randomdomain.com:3000 only add port if not reverse proxied)
3. run npm i in server
4. do npm run start or npm run dev
5. for the app part, you do know how to pull up a web server right? do that and you're mostly done

## Owner Tag instructions
1. in the .env, add "TOKEN=[random string]"
2. on the site, in your browser console, run "localStorage.setItem('token', '[TOKEN]'), with [TOKEN] being the same token you set in .env
3. refresh and u should have the tag at the start of ur messages

## CDN Instructions (required)
I'm using the HC CDN for this (it's free and kinda meant for this afaik), so this is what you'll probably need to as well.
1. Create an API key on https://cdn.hackclub.com/api_keys
2. Copy the .env.example to .env if you haven't already
3. Set CDN_API_KEY to your API key
4. Change "const res = await fetch('**https://domainnotverified.emmameowss.gay**/upload'," to your domain

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

## planned features
- ~~message history~~
- a better frontend (especially on mobile)
- ~~typing indicator~~
- maybe: sound effect for message
- normal file upload

## not fully planned but possible features
- HCA sign in