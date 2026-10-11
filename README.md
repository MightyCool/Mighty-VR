# DIY VR — Step 1

A cozy furnished 3D room that runs in your browser, with a bed, desk, sofa, plants, and warm lamps. Move your phone to look around, drag with your finger or mouse, or switch on a side-by-side view for a two-lens headset. Optional hand tracking uses the phone's rear camera to show both hands and interact with a world-anchored app dock and settings window. Hand tracking is processed on the device; camera video is not sent to a server. The scene is rendered on the phone, not the Windows computer. Once Safari has loaded the page, local 3D library, and optional hand-tracking model, the open demo does not need a continuing internet connection. To open or reload the website, or to load the hand-tracking files for the first time during local testing, the phone does need to reach the computer's local server.

The app uses Three.js and MediaPipe Tasks Vision, downloaded once by npm and served from your own computer when testing locally. The hand landmark model and WebAssembly runtime are included in the published build and run locally in the browser. MediaPipe Tasks Vision is Apache-2.0 licensed; the hand model is provided by [MediaPipe](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task). It does not use a paid service, an external 3D API, or a PC companion app.

## What you need

- Windows 10 or 11 with [Node.js](https://nodejs.org/) installed.
- A current browser on Windows 11, or Safari on an iPhone 7 running iOS 15.8.x.
- Your computer and iPhone on the same Wi-Fi for local testing.
- For iPhone motion tracking on the published site, no certificate setup is needed; GitHub Pages uses HTTPS. Local-network testing still needs the optional HTTPS setup below for camera and motion access.

The iPhone 7 supports up to iOS 15.8.x. Apple requires a user gesture to request motion permission in supported Safari versions, and motion access requires a secure (HTTPS) page. On desktop or on an unsecured local-network address, you can still explore using drag/touch and desktop arrow keys.

The browser interface is kept compatible with iOS 15 Safari; newer optional browser APIs are not required to build or open the room.

## Run on Windows

1. Open the `Mighty VR` folder in VS Code.
2. Open **Terminal → New Terminal**.
3. Check Node.js with `node --version`. If the command is not recognized, install the current LTS release from [nodejs.org](https://nodejs.org/) and restart VS Code.
4. Download the app dependencies by running this command once:

   ```powershell
   npm.cmd install
   ```

   `npm.cmd` works even on Windows setups that block the PowerShell `npm` script.

5. Start the local web server:

   ```powershell
   npm.cmd start
   ```

6. Open the `http://localhost:8080` address printed in the terminal on your computer. Keep this terminal and server running while using the app.
7. Click **Enter the demo**, drag the scene, try the arrow keys, adjust the sensitivity, and enable **Headset view** to see the left- and right-eye images side by side. Use **Phone orientation** if motion needs portrait or landscape adjustment, and **Full screen** to expand the demo.
8. Click **Home** to return to the first screen. Press **Ctrl+C** in the terminal when you are finished.

There is no separate compile or build command.

## Publish a test version on GitHub Pages

GitHub Pages is a free website host. This project includes a GitHub Actions workflow that builds the app and publishes it automatically whenever you push to GitHub. The first publish needs an internet connection; the built demo then runs from the GitHub Pages website.

### 1. Make a GitHub account and install GitHub Desktop

If you do not already have an account, create one at [github.com](https://github.com/). Install the free [GitHub Desktop](https://desktop.github.com/) app and sign in. It provides a visual way to publish your project; you do not need to type Git commands.

This folder already contains the app files, but is **not yet connected to GitHub**. In GitHub Desktop, choose **File → Add Local Repository…**, select this project folder, and choose the option to create a repository there if GitHub Desktop says the folder is not a Git repository yet. You can also choose **File → New Repository…** and set **Local Path** to the existing `Mighty VR` folder. Do not select **Initialize this repository with a README**; the project already has one.

### 2. Publish this folder as a repository

In GitHub Desktop, review the changes, enter a summary such as `Create DIY VR demo`, and click **Commit to main**. Then click **Publish repository**. Leave **Keep this code private** unchecked if you want a public site on the free GitHub plan. The repository can be public without making your local development certificate available: the `certs` folder is excluded from Git.

### 3. Turn on GitHub Pages

1. Open the new repository on GitHub.com.
2. Go to **Settings → Pages**.
3. Under **Build and deployment → Source**, select **GitHub Actions**. Do not select **Deploy from a branch**.
4. Return to GitHub Desktop. If the Pages workflow was not included in the first commit, commit the remaining project files, then click **Push origin**.
5. On GitHub.com, open the repository's **Actions** tab. Wait for the **Deploy DIY VR to GitHub Pages** workflow to finish successfully.
6. Return to **Settings → Pages** and open the published link. Its address will look like `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`.

The included workflow at `.github/workflows/deploy.yml` deploys the pairing Worker, builds the app with Vite, and publishes the generated `dist` folder. After the Cloudflare setup, pushing a new commit automatically updates both. GitHub may take a minute or two to make each update available.

GitHub Pages hosts the VR website. A Cloudflare Worker provides the small live pairing/signaling API that static hosting cannot run; GitHub Actions deploys it and builds the site with its URL. Screen video is sent directly between the PC and iPhone using WebRTC, not through Cloudflare. A public STUN service helps browsers find a direct route; no TURN relay is configured, so some networks may prevent a connection.

### One-time Cloudflare setup for PC streaming

1. Create a free Cloudflare account and enable the account's `workers.dev` subdomain in **Workers & Pages**.
2. In Cloudflare, create an API token with **Account → Workers Scripts → Edit** permission for this account. Copy the token; do not put it in project files.
3. On GitHub, open this repository's **Settings → Secrets and variables → Actions**. Add repository secrets named `CLOUDFLARE_API_TOKEN` (the token) and `CLOUDFLARE_ACCOUNT_ID` (from the Cloudflare account overview).
4. Push to the `main` branch, or run **Deploy DIY VR to GitHub Pages** from **Actions → Run workflow**. The workflow deploys the Worker, builds the Pages site with its Worker URL, and then publishes the site. Wait for the workflow to finish successfully.
5. Open the GitHub Pages address on both the PC and iPhone. You do not need to run `npm.cmd start`, create local certificates, or keep a local web server running for streaming.

Cloudflare's free Durable Objects/Workers usage limits apply. The four-digit pairing API is public and intended for short-lived pairing only; separate host and viewer tokens protect signaling after pairing, and codes expire after ten minutes of inactivity.

### 4. Test it on your iPhone

Open the **published HTTPS GitHub Pages link** in Safari on your iPhone. Tap **Enter the demo**, try the scene, and enable **Headset view** to enter the full-screen two-eye view. Tap **Exit headset view** to get back to the controls. Because GitHub Pages uses HTTPS, tap **Enable motion** and allow Safari's permission prompt to test the phone sensors. For iPhone Safari's site settings, ensure **Motion & Orientation Access** is enabled if permission was allowed but no sensor readings appear.

To try hand tracking, keep the phone's rear camera uncovered, tap **Enable hand tracking**, and allow camera access. The tracker can show both hands as articulated 3D skeletons, with palm depth oriented toward the camera. Curl the four fingers while leaving your thumb out to open the floating app dock. A fist only opens the dock; it does not close it. Touch or pinch **Settings** to open its smaller window; tap the size control in the upper-right to cycle through 1×, 1.5×, and 2×. The app dock remains just below an open app. Pinch and drag the **PINCH & DRAG** grip at the bottom of the dock to move the app and dock together around the room, including closer or farther away. Choose **Close Menu** at the right end of the dock to close it. The **Browser** app displays websites inside its in-world window, with an on-screen keyboard, back/forward controls for pages launched from the app, and Google, YouTube, and Wikipedia shortcuts. Type a search or URL and choose **Go / Search**; the webpage expands to fill the app window. Choose **Search** in the browser toolbar to return to the keyboard. Use direct screen touch or a mouse to interact with a loaded webpage. Some sites block display inside embedded frames. In headset view, the webpage is centered in the view. The dock stays at its opening position in the room instead of following your view. Its **Passthrough** button shows live rear-camera video behind the hand skeleton and 3D controls, while the room furniture is hidden; tap the button again to return to the 3D room. Touch or pinch an on-screen control to activate it. Hand and window depth is estimated from the camera image, so controls respond when a fingertip reaches the window surface. Tracking uses a background worker and SIMD-accelerated runtime where supported, while measured inference time adapts the camera-frame size and update rate. The current tracking FPS, inference time, and skipped camera frames are shown in the hand-tracking card. The room's rendering resolution is unchanged. Tap **Stop hand tracking** when finished. Camera access requires HTTPS (or localhost); the model runs locally and camera frames are not uploaded.

The published page stays available when your PC is turned off, but the PC must be on and sharing its screen during a stream. The Worker handles only pairing; it does not capture, store, or relay screen video. This project does not include a Windows companion app or SteamVR integration.

### Test the production build on your PC first

Run these commands in the project folder:

```powershell
npm.cmd install
npm.cmd run build
npm.cmd run preview
```

Open `http://localhost:4173` in your PC browser. The output in `dist` is generated for deployment; do not edit it or upload it manually.

## Open the app on your iPhone 7

### Just look around (no motion permissions)

1. Connect the iPhone and Windows computer to the same Wi-Fi network.
2. Run `npm.cmd start` in the project folder if the server is not already running.
3. Find the `On your local network: http://...:8080` address printed in the terminal. If more than one address is listed, try the one belonging to your Wi-Fi adapter.
4. Type that exact address into Safari on your iPhone. **Do not use `localhost` on your iPhone**—that would refer to the phone, not the computer.
5. Tap **Enter the demo**. Drag inside the room to look around, adjust sensitivity, or turn on **Headset view**.

If the page will not load, check that both devices are on the same Wi-Fi network, the server is still running, you used the printed computer address, and Windows Firewall allows Node.js on your **private** network.

### Enable iPhone motion tracking (automatic local HTTPS setup)

When testing from the local-network server, Safari requires HTTPS for hand camera/motion access and local PC-to-VR streaming. The published GitHub Pages site already uses HTTPS and needs no local certificates. For local testing, the launcher below automatically installs `mkcert` with Windows Package Manager if needed, trusts its local certificate on the PC, and creates a certificate for the PC's current local IP addresses. No manual certificate commands or Wi-Fi adapter changes are needed.

1. Connect the PC and iPhone to the same private Wi-Fi network.
2. Stop any existing server with **Ctrl+C**. In the project folder, run:

   ```powershell
   npm.cmd run start:https
   ```

   The first run may ask Windows Package Manager (`winget`) to install `mkcert`; approve that installation. It can take a moment. The script does **not** reset or modify the network adapter.
3. On the iPhone, open the `http://<PC-LAN-IP>:8081/` **iPhone first-time setup** address printed in the terminal. Tap **Download iPhone certificate**.
4. On the iPhone, open **Settings → Profile Downloaded** and install the profile. Then go to **Settings → General → About → Certificate Trust Settings**, and turn on full trust for the mkcert certificate.
5. In Safari, open the `https://<PC-LAN-IP>:8080` address printed by the server. Allow camera/motion permissions when prompted.

The setup page only serves the public root certificate over your private network. The signing key and server certificate remain on the PC in the git-ignored `certs` folder. Install the root certificate only on your own devices; remove it later from **Settings → General → VPN & Device Management** if you no longer need it. If your router assigns a new local IP after you reconnect Wi-Fi, stop the server and run `npm.cmd run start:https` again to generate a certificate for the new address.

### Stream the PC screen into VR

1. Complete the **One-time Cloudflare setup for PC streaming** above and wait for a successful GitHub Pages deployment.
2. Open the published GitHub Pages HTTPS address on both the PC and iPhone. Keep both devices connected to the internet; they do not need to be on the same Wi-Fi.
3. On the PC, open the demo page, click **Start a Stream PC**, select **Entire Screen** in the browser's picker, and approve sharing. Keep that browser tab open; it shows a four-digit pairing code.
4. On the iPhone, open the demo and enable hand tracking. Curl four fingers to show the dock, select **Stream**, enter the four digits, and tap **Join stream**.
5. The captured PC screen appears on a 3D panel in VR. Use **Stop** in the Stream app or **Stop sharing** on the PC to end it. Unpaired codes and inactive sessions expire after ten minutes.

The Cloudflare Worker relays only temporary WebRTC signaling data. Screen video is sent directly between the two browsers, not through the Worker. A public STUN service helps browsers establish a direct connection; no TURN relay is configured, so some networks may prevent a connection. The browser asks for permission and the person at the PC must choose which screen to share.

## Test checklist

- **3D room:** The furnished room keeps its original floor and walls and adds a bed, desk and chair, sofa, reading chair, coffee table, plants, wall art, and warm lamps. Drag inside the scene to look around; arrow keys also work on a keyboard.
- **Single-screen mode:** Leave **Headset view** turned off.
- **Stereoscopic mode:** Turn **Headset view** on. The app switches to a full-screen room drawn as two adjacent half-width camera views; `LEFT EYE` and `RIGHT EYE` labels identify them. `Recenter` and `Exit headset view` remain available as floating controls. Place the phone screen horizontally in your two-lens headset and center the seam between the lenses. Adjust headset straps/spacing for comfort. Exit to return to one view and the settings.
- **Hand tracking:** On HTTPS, allow camera access and verify that both rear-camera hand skeletons appear. Curl four fingers with the thumb out to open the floating dock. Touch or pinch Settings to open the in-world settings window; verify the dock stays below it, drag its lower grip to reposition both panels, and choose Close Menu to dismiss them. Passthrough shows the live camera view behind the hand skeletons and UI, and toggling it off restores the furnished room.
- **In-world browser:** Open Browser from the dock, enter a URL or search, and tap **Go / Search**. The page expands to fill the floating browser window; choose **Search** in its toolbar to return to the on-screen keyboard. Webpage controls accept regular screen touch or mouse input; websites that prohibit iframe embedding may refuse to load.
- **PC screen stream:** After configuring Cloudflare and publishing the Pages site, open that HTTPS site on both devices. On the computer click **Start a Stream PC** and choose **Entire Screen** in the browser's screen-share prompt. Enter the displayed four-digit code in the VR app dock's **Stream** app. The Worker relays signaling only; WebRTC sends the video directly, and some networks may still prevent a direct connection. Codes expire after ten minutes. Stop sharing on the PC or tap **Stop** in VR to end the session.
- **Motion tracking:** On iPhone Safari, open the trusted HTTPS address and tap **Enable motion** (this button supplies the required iOS permission gesture). Accept the permission prompt. The indicator should say **MOTION ON**, and α/β/γ should change as you rotate the phone. Use **Recenter your view** to set the current phone direction as forward.
- **Permission denied / no sensor:** Deny permission or use HTTP on the local network. The app reports why phone motion is unavailable; dragging and arrow keys continue to work.
- **Sensitivity:** Move **Look sensitivity** left/right and compare how far a drag or arrow-key press turns the view.

## Browser and headset notes

- The included Three.js version supports WebGL 1, which helps compatibility with older Safari/iOS versions such as those available on iPhone 7. A browser with WebGL disabled cannot render the scene; the app shows a fallback message.
- If the iPhone runs an older iOS release, update it to the latest release available for iPhone 7 (up to iOS 15.8.x). In Safari, also check **Settings → Safari → Motion & Orientation Access** if the site received permission but no sensor readings arrive.
- This is a browser demo, not a calibrated or certified VR headset. It provides side-by-side images and phone orientation, but no lens-distortion correction, positional tracking, controllers, or guaranteed lens alignment. Start with short sessions and stop if you feel uncomfortable.
- Motion readings and hand-camera frames stay on the device. The in-world Browser intentionally loads the websites selected by the user, which can receive ordinary website requests and may apply their own embedding restrictions. PC screen video is sent directly browser-to-browser; the Cloudflare Worker (or local Node server during local development) relays temporary signaling data, and a public STUN server helps establish a direct network route. Text uses the fonts already available on your device.
- Only **Step 1** is included. This project does not include a Windows companion app, SteamVR integration, or later project stages.
