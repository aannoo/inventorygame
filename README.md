# Inventory Mayhem

A phone-first property inventory training game using a curated set of local house photos. Solo play and live multiplayer run in any modern phone browser. No account, database, build step, or third-party service is needed for a local game.

**Live game:** [inventorygame.onrender.com](https://inventorygame.onrender.com/). Open this address on every device for internet multiplayer, then create a room and share its invite link.

## Start

Install Node.js 20 or newer, then from this folder run:

```sh
npm install
npm start
```

On Android shared storage, if npm cannot create a symlink, run `npm install --no-bin-links` instead.

Open `http://localhost:3000` on the host. Use **Create live room** and show the QR code, use the phone's Share button, or copy the displayed invite link. When the host opened `localhost`, the game discovers a local IP address for the invite where available; the lobby also lets you enter the host's local IP manually. Guests must open the host's invite link before joining with the room code. The server listens on all network interfaces.

For local play, the guest phone must be able to reach the host phone. On public or bar Wi-Fi, devices are often isolated even when they use the same network name. If the invite page will not load on the guest phone, try a private network or one phone's hotspot, connect the other device to it, and create a new room using the hotspot address. Changing the room code or IP address cannot bypass isolation. If the invite page opens but joining fails, check that both phones are using the same server and that the room has not started or expired.

For play across separate networks, run this Node server on an internet-reachable host with HTTPS (directly or behind an HTTPS reverse proxy), then have everyone open that server's invite link. The game does not provide a relay service, and a room created on a local phone cannot be joined through a different server. Start once everyone has joined.

### Render free web service

1. Put this project in a GitHub repository. Include `server.js`, `questions.js`, `package.json`, `package-lock.json`, and the entire `public/` folder. The existing `.gitignore` excludes `node_modules/`.
2. In the [Render dashboard](https://dashboard.render.com/), choose **New → Web Service**, connect the GitHub repository, and select its branch.
3. Set **Language** to **Node**, **Build Command** to `npm ci`, **Start Command** to `npm start`, and **Instance Type** to **Free**. Leave **Root Directory** empty if these files are at the repository root. No custom environment variables are needed: the server already reads Render's `PORT` and listens on `0.0.0.0`.
4. Create the service and wait for the deploy to finish. Open its `https://<service-name>.onrender.com` URL, create a live room there, and share that room's invite link. Every player must open this Render URL, including the host.

The free service can sleep after 15 minutes without incoming requests and may restart. Its rooms are in memory, so a restart clears them; create a fresh room if that happens. Do not create the room on `localhost` and expect it to appear on Render.

Solo Sprint starts immediately. Classic matches have eight shuffled photo rounds, two labeled practice scenarios, two build-a-report rounds, and two random seven-second WC breaks. Tap a question photo to inspect it at full size. Build-a-report rounds ask players to choose each visible detail, such as colour, painted finish, door, handle finish, and handle type. Correct parts score points, with speed and streak bonuses for a complete report. The WC winner gets 80 points. Between rounds, everyone sees a breakdown of each player's points and correct parts, plus a live activity feed and countdown.

**Puzzle with a friend** creates a shared room with three build-a-report puzzles. The host starts after friends join. There is no timer: everyone can try combinations, gets part-by-part feedback after each attempt, and shares any correct clues they uncover with the crew. When anyone solves a puzzle, every player earns the same points and sees the completed report. Rooms support up to eight players. The results screen shows missed classic answers with the photo and explanation. **Exit** is available during play; **Restart** begins a fresh solo run or, for a multiplayer host, resets the whole room after confirmation.

## Content and limits

The 37 question photos were selected from the supplied house archive and exported as compact, metadata-stripped WebP files. Five of the newer photos cover a window handle, oven, peeling sill, floorboards and marked window reveal. Ten additional scenario prompts use those photos but explicitly supply facts that a still image cannot establish. They cover check-out tags, cleaning decisions, cupboard evidence, alarm evidence and keys. Tags are used only in labeled check-out scenarios; they do not assign tenant liability. Answer keys describe only what is visible or expressly stated. A photo cannot prove that an appliance or alarm works, or that an unseen surface is undamaged. Feedback is sarcastic, while the clerk notes stay factual.

The eight clerk portraits are crops from the supplied screenshot: Donatas, Brendan, Anno, Oliver, Romanian Rob, Ridwan, Sammer, and Rob Moriarty. The supplied source photos and contractor files are not needed after the assets have been generated.

Rooms are held in server memory and expire after six hours. Leaving removes a player immediately; a disconnected player has a one-minute reconnect window. Restarting the server clears active games. The score is for training and entertainment, not a substitute for a real inspection report.
