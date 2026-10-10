# DIY VR — Step 1

A cozy furnished 3D room that runs in your browser, with a bed, desk, sofa, plants, and warm lamps. Move your phone to look around, drag with your finger or mouse, or switch on a side-by-side view for a two-lens headset. Optional hand tracking uses the phone's rear camera to show your hand in the room and pinch-operated controls. Hand tracking is processed on the device; camera video is not sent to a server. The scene is rendered on the phone, not the Windows computer. Once Safari has loaded the page, local 3D library, and optional hand-tracking model, the open demo does not need a continuing internet connection. To open or reload the website, or to load the hand-tracking files for the first time during local testing, the phone does need to reach the computer's local server.

The app uses Three.js and MediaPipe Tasks Vision, downloaded once by npm and served from your own computer when testing locally. The hand landmark model and WebAssembly runtime are included in the published build and run locally in the browser. MediaPipe Tasks Vision is Apache-2.0 licensed; the hand model is provided by [MediaPipe](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task). It does not use a paid service, an external 3D API, or a PC companion app.

## What you need

- Windows 10 or 11 with [Node.js](https://nodejs.org/) installed.
- A current desktop browser, or Safari on an iPhone 7.
- Your computer and iPhone on the same Wi-Fi for local testing.
- For iPhone motion tracking, a free locally trusted HTTPS certificate. See **Enable iPhone motion tracking** below.

The iPhone 7 supports up to iOS 15.8.x. Apple requires a user gesture to request motion permission in supported Safari versions, and motion access requires a secure (HTTPS) page. On desktop or on an unsecured local-network address, you can still explore using drag/touch and desktop arrow keys.

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

The included workflow at `.github/workflows/deploy.yml` builds the app with Vite and publishes the generated `dist` folder. After the initial setup, pushing a new commit automatically updates your test site. GitHub may take a minute or two to make each update available.

### 4. Test it on your iPhone

Open the **published HTTPS GitHub Pages link** in Safari on your iPhone. Tap **Enter the demo**, try the scene, and enable **Headset view** to enter the full-screen two-eye view. Tap **Exit headset view** to get back to the controls. Because GitHub Pages uses HTTPS, tap **Enable motion** and allow Safari's permission prompt to test the phone sensors. For iPhone Safari's site settings, ensure **Motion & Orientation Access** is enabled if permission was allowed but no sensor readings appear.

To try hand tracking, keep the phone's rear camera uncovered, tap **Enable hand tracking**, and allow camera access. Hold your hand in front of the rear camera. Pinch once to reveal the **MVR** button, move your index fingertip to it, and pinch again to open the in-scene settings. Point and pinch a setting to adjust it. Tap **Stop hand tracking** when finished. Camera access requires HTTPS (or localhost); the model runs locally and camera frames are not uploaded.

Unlike the local Windows server, the published page stays available when your PC is turned off. GitHub Pages is for serving the website files; it does not add streaming, a Windows companion app, or SteamVR features.

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

### Enable iPhone motion tracking (free local HTTPS setup)

Safari restricts motion sensors and camera access to a secure HTTPS page. A plain `http://<computer-IP>:8080` address will show an explanation and keep touch controls available. To enable motion tracking and rear-camera hand tracking on your home Wi-Fi, make a **locally trusted development certificate**. This setup keeps the certificate on your devices; it does not publish your site.

1. Install the free `mkcert` tool. If Windows Package Manager (`winget`) is available, open a **second** PowerShell terminal and run:

   ```powershell
   winget install --id FiloSottile.mkcert
   ```

   Close and reopen the terminal so `mkcert` is on your PATH.
2. In VS Code's terminal, make a folder for your certificate files:

   ```powershell
   New-Item -ItemType Directory -Force certs
   ```

3. Copy the computer's local IPv4 address from the `npm.cmd start` output. Replace `192.168.1.23` below with **that exact address**, then run:

   ```powershell
   mkcert -install
   mkcert -cert-file certs/dev-cert.pem -key-file certs/dev-key.pem localhost 127.0.0.1 192.168.1.23
   ```

4. In the same terminal, print the folder containing mkcert's root certificate:

   ```powershell
   mkcert -CAROOT
   ```

   Inside that folder, the public certificate is named `rootCA.pem`. Make a copy with the `.crt` extension, which iOS recognizes as a certificate:

   ```powershell
   $root = mkcert -CAROOT
   Copy-Item (Join-Path $root 'rootCA.pem') '.\certs\rootCA.crt'
   ```

   **Only transfer `certs/rootCA.crt` to your iPhone. Never share `rootCA-key.pem` or `certs/dev-key.pem`.** Use a trusted method such as AirDrop or your own iCloud Drive. The iPhone and PC must still be on the same private Wi-Fi.
5. Install the root certificate profile on the iPhone: open the `rootCA.pem` file there, allow the profile download, then open **Settings → Profile Downloaded** (or **Settings → General → VPN & Device Management**) and install it. Then open **Settings → General → About → Certificate Trust Settings**, find the mkcert root certificate, and switch on **full trust**. The setting may appear under the root certificate authority's name.
6. Stop the HTTP server with **Ctrl+C**, then start HTTPS:

   ```powershell
   npm.cmd run start:https
   ```

7. In Safari, open `https://192.168.1.23:8080`, using your actual PC IPv4 address instead. The address must match the certificate. Leave the HTTPS server running.
8. Launch the demo, tap **Enable motion**, and **allow** Safari's motion permission if it asks. Move the phone and confirm the diagnostic changes to **MOTION ON** and its α/β/γ readings update.

mkcert installs a development root certificate on **your PC** and the separate root certificate profile installs trust on **your iPhone**. Only do this on your own devices and network; remove the profile from **Settings → General → VPN & Device Management** when you no longer need local development HTTPS. If your iPhone does not offer **Profile Downloaded**, use a trusted way to open/install the certificate profile or continue using drag controls instead.

## Test checklist

- **3D room:** The furnished room keeps its original floor and walls and adds a bed, desk and chair, sofa, reading chair, coffee table, plants, wall art, and warm lamps. Drag inside the scene to look around; arrow keys also work on a keyboard.
- **Single-screen mode:** Leave **Headset view** turned off.
- **Stereoscopic mode:** Turn **Headset view** on. The app switches to a full-screen room drawn as two adjacent half-width camera views; `LEFT EYE` and `RIGHT EYE` labels identify them. `Recenter` and `Exit headset view` remain available as floating controls. Place the phone screen horizontally in your two-lens headset and center the seam between the lenses. Adjust headset straps/spacing for comfort. Exit to return to one view and the settings.
- **Hand tracking:** On HTTPS, allow camera access and verify that the rear camera tracks a hand in the room. Pinch to show MVR, then point to the logo and pinch to open the in-view settings. Try changing sensitivity or headset view and stop tracking to confirm the camera turns off.
- **Motion tracking:** On iPhone Safari, open the trusted HTTPS address and tap **Enable motion** (this button supplies the required iOS permission gesture). Accept the permission prompt. The indicator should say **MOTION ON**, and α/β/γ should change as you rotate the phone. Use **Recenter your view** to set the current phone direction as forward.
- **Permission denied / no sensor:** Deny permission or use HTTP on the local network. The app reports why phone motion is unavailable; dragging and arrow keys continue to work.
- **Sensitivity:** Move **Look sensitivity** left/right and compare how far a drag or arrow-key press turns the view.

## Browser and headset notes

- The included Three.js version supports WebGL 1, which helps compatibility with older Safari/iOS versions such as those available on iPhone 7. A browser with WebGL disabled cannot render the scene; the app shows a fallback message.
- If the iPhone runs an older iOS release, update it to the latest release available for iPhone 7 (up to iOS 15.8.x). In Safari, also check **Settings → Safari → Motion & Orientation Access** if the site received permission but no sensor readings arrive.
- This is a browser demo, not a calibrated or certified VR headset. It provides side-by-side images and phone orientation, but no lens-distortion correction, positional tracking, controllers, or guaranteed lens alignment. Start with short sessions and stop if you feel uncomfortable.
- The app does not send motion readings to a service or request network resources outside your local server. Text uses the fonts already available on your device.
- Only **Step 1** is included. This project does not include desktop streaming, a Windows companion app, SteamVR integration, or later project stages.
