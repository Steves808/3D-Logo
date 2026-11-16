# Logo 3D Together (WebXR multiplayer, v4)

Two or three people put on headsets, open one web address, and build a Logo 3D sculpture together.
It runs the **real c17 `logo3d.js`** (in `public/engine/`), so everything c17 understands works here:
FOR / WHILE, functions, spaces in arithmetic, BALL, LABEL, HUE, SYMMETRY, GLOW, BG, SHEETS,
SLIDER, TIME / FRAME animation, NOTE sound, Watch / Step.

## Try it on your PC first (no headset, no certificate)

```
cd webxr
npm install
npm start
```

Then open **http://localhost:3000/?bots=2** — you get two pretend players walking around.
Add `&botsdraw=1` and they press tablet buttons too. Every extra browser tab is another real player.

Run the automated check (3 pretend players editing at once, late joiner, restart):

```
npm test
```

## Put it on the VPS (keeps the old one on port 3000 running)

```
dnf install -y git
cd /var/www
git clone -b webxr-together https://github.com/Steves808/3D-Logo.git logo3d-together
cd /var/www/logo3d-together/webxr
npm install
firewall-cmd --add-port=3001/tcp --permanent && firewall-cmd --reload
PORT=3001 pm2 start server.js --name logo3d-together
pm2 save
```

Open **https://elekah.com:3001/** on the PC and in each Quest browser.
The server finds the elekah.com Let's Encrypt certificate by itself (same files v3 used).

Update later:

```
cd /var/www/logo3d-together && git pull && pm2 restart logo3d-together
```

Check it is alive: **https://elekah.com:3001/status**

## In the headset

| What | How |
|---|---|
| Tablet | rides on your LEFT hand (ROOM tab → SWAP for right) |
| Press a button | point the RIGHT controller's laser at the tablet, pull the trigger |
| Grab the sculpture | squeeze a GRIP and move your hand |
| Stretch / shrink / turn it | squeeze BOTH grips |
| Walk | left thumbstick |
| Turn / go up-down | right thumbstick |
| See your real room | **Enter AR** instead of Enter VR (Quest 3 passthrough) |

Tablet pages: **BUILD** (each press adds one line for everyone, coloured by who added it),
**EXAMPLES** (from `examples.txt`), **WATCH** (shared step-by-step playback, speed, sliders),
**VIEW** (fit, size, height, turn), **ROOM** (who is here, ping, mic, swap hands).

The big **code wall** shows the whole shared program to everyone. Typing is easiest on a PC or
phone open to the same address — it is the same shared program.

## Rooms

Everyone who opens the plain address is in room `main`. `?room=maui` makes a separate room.
Rooms remember their program after everyone leaves and after a server restart (`rooms.json`).

## Testing tools

- `?bots=3` pretend players; `&botsdraw=1` lets them draw. Also the + / − buttons on the page.
- "Open another player (new tab)" button.
- The tablet is shown in the corner of the normal page and works with the mouse, so every headset
  action can be tried without a headset (`?tablet=0` hides it).
- `node test/bots.js 3 main draw wss://elekah.com:3001/ws` — bots from the command line.
- ROOM tab / the page's "Testing" box: frames per second, ping, program version.

## Moving to a newer Logo 3D

Replace the files in `public/engine/` with the new version's files. One small addition must stay
in `logo3d.js`: the `turtle`, `sliderInfo` and `setSlider` lines in the `window.Logo3D` hook at the
bottom (search for "Together"). Without them it still runs, but VR sliders and the exact turtle
marker are lost. Commands, Examples and Acknowledgements are read from the `.txt` files in that
folder at run time — never hardcoded.

## How it works (for the next AI or person)

- `server.js` — serves `public/` and referees rooms over one WebSocket (`/ws`). Only dependency: `ws`.
- `public/js/state.js` — the rules for every shared action (append, set, undo, clear, reseed, slider,
  view, play). Used by the server and, in solo mode, by the page.
- Players share the **program text + random seed + slider values**, not geometry. Each headset runs
  the engine itself; same seed → identical drawing. Late joiners get one small message.
- `engine.js` loads `public/engine/index.html` in a hidden frame and calls `Logo3D.runSource`.
- `render.js` — lines become one instanced batch of tubes (fewer sides as the count grows).
- `panel.js` — the tablet (one canvas). `xr.js` — controllers, laser, grab, thumbsticks, AR.
- `voice.js` — optional WebRTC voice (MIC button). Uses a public STUN server; some home routers
  will block it. Leave it off when everyone is in the same real room (echo).
- No inline scripts; three.js is vendored in `public/vendor/` (no CDN).

## Not tested on a real headset yet

Everything above was tested in desktop Chrome (two browsers + bots) and by `npm test`.
Controller code, the tablet-on-hand position, grabbing, thumbsticks and AR could not be tried
from where this was written — expect to adjust `xr.js` (tablet offset is in `_assign()`).
