# chat™
prounounced however you want to pronounce it

### an incredibly simple chat app

![interface of the site](https://cdn.hackclub.com/019e93b3-806e-702a-b857-b302d5e2b877/cleanshot_2026-06-04_at_19.34.14_2x.png)

available at: https://chat.emmameowss.gay, currently supports images and text, please note that images are now permanently saved while ~~the most recent 25 text messages are saved and disappear upon server restart~~ all text messages are now stored forever

## Setup Instructions
1. clone the repository
2. add your domain to cors allowed origins in server.js
3. copy .env.example to .env
4. fill out the .env file with your HCA app details (obtain them at https://auth.hackclub.com), your hack club CDN api key, and preferred port. preferrably also add your email to OWNER_EMAIL if you want the tag in the chat. this one isn't required and the site will function without it.
5. add a privacy.html file in /app (needs to exist otherwise eeverything crashes)
6. optionally, add a filter.txt file in /server for filtered words
7. run npm i in server
8. do npm run start or npm run dev

## current features
- usernames
- name colors
- basic text and image sending
- ~~crappy~~ a better ui
- better mobile ui
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
- guest sign in
- command autocomplete
- a user list
- zooming images
- timestamp hovering over
- pride flag name colors
- better banning people
- whois command that lets you see people's email
- guest badge in userlist and messages
- banner for dev instances
- maintenance

## planned features
- ~~message history~~
- ~~typing indicator~~
- ~~maybe: sound effect for message~~
- ~~link detection in messages~~
- ~~file size notification~~
