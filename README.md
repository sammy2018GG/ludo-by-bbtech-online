# LUDO BY BBTECH: online play

## Run it on your computer (family on the same Wi-Fi)
1. Install Node.js 18 or newer from nodejs.org.
2. In this folder, run: `npm install` then `npm start`
3. On the computer, open http://localhost:3000
4. On phones on the same Wi-Fi, open http://YOUR-COMPUTER-IP:3000
   (find the IP with `ipconfig` on Windows or `ifconfig` on Mac/Linux).

## Play with family anywhere (host it online)
Deploy this folder to a Node host such as Render (a render.yaml file is included, so Render sets everything up for you):
- Build command: `npm install`
- Start command: `npm start`
Then share the web address. Free plans may sleep when idle, so the first load can be slow.

## How it plays
- One person taps "Play online", chooses 2 or 4 players, and taps "Create room".
- They share the 4-digit code or the link. Others tap "Play online", type the code, and tap "Join".
- The host taps "Start game" once everyone has joined.
- The server rolls the dice and checks every move, so no phone can cheat.
- If a phone drops off, reopening the page reconnects that player to their seat.

## Not included yet
- Turn timers and skipping players who stay away.
- Accounts, friends, and ranked play.
