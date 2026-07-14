# chat™
an incredibly simple chat app

![meow](https://pride-badges.pony.workers.dev/static/v1?label=meow&labelColor=%23555&stripeWidth=8&stripeColors=5BCEFA%2CF5A9B8%2CFFFFFF%2CF5A9B8%2C5BCEFA)
![women](https://pride-badges.pony.workers.dev/static/v1?label=women&labelColor=%23555&stripeWidth=8&stripeColors=D52D00%2CEF7627%2CFF9A56%2CFFFFFF%2CD162A4%2CB55690%2CA30262)
![Top language](https://img.shields.io/github/languages/top/emmameowss/chattm)
![License](https://img.shields.io/github/license/emmameowss/chattm)
![Last commit](https://img.shields.io/github/last-commit/emmameowss/chattm)
![Hack Club Badge](https://img.shields.io/badge/Hack%20Club-EC3750?logo=hackclub&logoColor=fff&style=flat)




![interface of the site](https://cdn.hackclub.com/019e93b3-806e-702a-b857-b302d5e2b877/cleanshot_2026-06-04_at_19.34.14_2x.png)

available at: https://chattm.app, currently supports images and text, please note that images are now permanently saved while ~~the most recent 25 text messages are saved and disappear upon server restart~~ all text messages are now stored forever

## Setup Instructions
1. clone the repository
2. add your domain to cors allowed origins in server.js
3. copy .env.example to .env
4. fill out the .env file with your HCA app details (obtain them at https://auth.hackclub.com) and preferred port. preferrably also add your email to OWNER_EMAIL if you want the tag in the chat. this one isn't required and the site will function without it.
5. create an aws s3 bucket and fill in the details for it in .env, make sure you allow public read access through bucket policy and allow your domain in CORS.
6. add a privacy.html file in /app (needs to exist otherwise eeverything crashes)
7. optionally, add a filter.txt file in /server for filtered words
8. run npm i in server
9. do npm run start or npm run dev

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
- custom emojis
- ability to suggest custom emojis
- database stuff
- channels
