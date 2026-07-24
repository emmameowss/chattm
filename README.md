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
4. fill out the .env file with your clerk details (https://clerk.com) and preferred port. for 99% of admin privileges you will need to put 
```json
{
  "role": "owner"
}
```
into your account's public metadata. please also make sure to replace the publishable key in index.html and login.html

5. create a cloudflare r2 and fill in the details for it in .env, make sure you allow your domain through cors policy and enable public access
6. optionally, add a filter.txt file in /server for filtered words, you can remove this after first launch as filter words get pulled into the database
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
- custom emojis
- ability to suggest custom emojis
- database stuff
- channels
