import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { networkInterfaces } from "node:os";
import { randomBytes, randomInt } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.env.PORT || 8080);
const setupPort = Number(process.env.SETUP_PORT || port + 1);
const wantsHttps = process.argv.includes("--https");
const publicFiles = new Set([
  "index.html",
  "styles.css",
  "src/main.js",
  "src/pc-stream.js",
  "src/hand-tracking-worker.js",
  "assets/hand_landmarker.task",
  "node_modules/three/build/three.module.js",
  "node_modules/three/examples/jsm/renderers/CSS3DRenderer.js",
  "node_modules/@mediapipe/tasks-vision/vision_bundle.mjs",
  "node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js",
  "node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm",
  "node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.js",
  "node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.wasm",
]);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};
const streamSessions = new Map();
const failedStreamJoins = new Map();
const STREAM_SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_SIGNAL_MESSAGES = 128;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_STREAM_SESSIONS = 64;

function pruneStreamSessions(now = Date.now()) {
  for (const [code, session] of streamSessions) {
    if (session.expiresAt <= now) streamSessions.delete(code);
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > MAX_REQUEST_BYTES) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
  }
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error("Request body must be a JSON object.");
    error.statusCode = 400;
    throw error;
  }
  return value;
}

function getStreamSession(code) {
  pruneStreamSessions();
  const session = streamSessions.get(code);
  return session && session.expiresAt > Date.now() ? session : undefined;
}

async function handleStreamApi(request, response, url) {
  if (request.method === "POST" && url.pathname === "/api/stream/session") {
    pruneStreamSessions();
    if (streamSessions.size >= MAX_STREAM_SESSIONS) {
      sendJson(response, 503, { error: "Too many active screen-sharing sessions. Try again shortly." });
      return true;
    }
    let code;
    do {
      code = String(randomInt(1000, 10000));
    } while (streamSessions.has(code));
    const token = randomBytes(24).toString("hex");
    streamSessions.set(code, {
      token,
      expiresAt: Date.now() + STREAM_SESSION_TTL_MS,
      viewerJoined: false,
      messages: [],
      nextMessageId: 1,
    });
    sendJson(response, 201, { code, token, expiresInSeconds: STREAM_SESSION_TTL_MS / 1000 });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/stream/join") {
    const { code } = await readJson(request);
    if (typeof code !== "string" || !/^\d{4}$/.test(code)) {
      sendJson(response, 400, { error: "Enter the four-digit stream code." });
      return true;
    }
    const session = getStreamSession(code);
    if (!session) {
      const ip = request.socket.remoteAddress || "unknown";
      const attempt = failedStreamJoins.get(ip) || { count: 0, resetAt: Date.now() + 60_000 };
      if (attempt.resetAt <= Date.now()) {
        attempt.count = 0;
        attempt.resetAt = Date.now() + 60_000;
      }
      attempt.count += 1;
      failedStreamJoins.set(ip, attempt);
      sendJson(response, attempt.count > 20 ? 429 : 404, {
        error: attempt.count > 20 ? "Too many code attempts. Wait one minute and try again." : "That stream code is invalid or expired.",
      });
      return true;
    }
    if (session.viewerJoined) {
      sendJson(response, 409, { error: "This stream code is already connected to a VR device." });
      return true;
    }
    failedStreamJoins.delete(request.socket.remoteAddress || "unknown");
    session.viewerJoined = true;
    session.viewerToken = randomBytes(24).toString("hex");
    session.expiresAt = Date.now() + STREAM_SESSION_TTL_MS;
    sendJson(response, 200, { joined: true, token: session.viewerToken });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/stream/signal") {
    const { code, role, token, message } = await readJson(request);
    const session = typeof code === "string" ? getStreamSession(code) : undefined;
    if (!session || (role !== "host" && role !== "viewer")) {
      sendJson(response, 404, { error: "Stream session not found." });
      return true;
    }
    if (
      (role === "host" && token !== session.token) ||
      (role === "viewer" && (!session.viewerJoined || token !== session.viewerToken))
    ) {
      sendJson(response, 403, { error: "This device is not paired with the stream." });
      return true;
    }
    if (
      !message ||
      typeof message !== "object" ||
      !["offer", "answer", "candidate", "ended"].includes(message.type)
    ) {
      sendJson(response, 400, { error: "Unsupported stream signaling message." });
      return true;
    }
    const serialized = JSON.stringify(message);
    if (serialized.length > 48 * 1024) {
      sendJson(response, 413, { error: "Stream signaling message is too large." });
      return true;
    }
    session.messages.push({
      id: session.nextMessageId++,
      to: role === "host" ? "viewer" : "host",
      message,
    });
    if (session.messages.length > MAX_SIGNAL_MESSAGES) {
      session.messages.splice(0, session.messages.length - MAX_SIGNAL_MESSAGES);
    }
    sendJson(response, 202, { sent: true });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/stream/signals") {
    const code = url.searchParams.get("code");
    const role = url.searchParams.get("role");
    const token = url.searchParams.get("token");
    const after = Number(url.searchParams.get("after") || 0);
    if (!Number.isSafeInteger(after) || after < 0) {
      sendJson(response, 400, { error: "Invalid signaling message cursor." });
      return true;
    }
    const session = code ? getStreamSession(code) : undefined;
    if (!session || (role !== "host" && role !== "viewer")) {
      sendJson(response, 404, { error: "Stream session not found." });
      return true;
    }
    if (
      (role === "host" && token !== session.token) ||
      (role === "viewer" && (!session.viewerJoined || token !== session.viewerToken))
    ) {
      sendJson(response, 403, { error: "This device is not paired with the stream." });
      return true;
    }
    if (session.viewerJoined) session.expiresAt = Date.now() + STREAM_SESSION_TTL_MS;
    sendJson(response, 200, {
      messages: session.messages.filter((entry) => entry.to === role && entry.id > after),
      expiresAt: session.expiresAt,
    });
    return true;
  }

  return false;
}

async function serveFile(request, response) {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname.startsWith("/api/stream/")) {
      const handled = await handleStreamApi(request, response, url);
      if (handled) return;
    }
    const pathname = decodeURIComponent(url.pathname);
    const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
    if (!publicFiles.has(relativePath)) {
      response.writeHead(404).end("Not found");
      return;
    }
    const filePath = resolve(root, relativePath);
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    const details = await stat(filePath);
    if (!details.isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }

    let body = await readFile(filePath);
    if (relativePath === "node_modules/three/examples/jsm/renderers/CSS3DRenderer.js") {
      body = Buffer.from(
        body.toString().replace(
          "from 'three';",
          "from '/node_modules/three/build/three.module.js';",
        ),
      );
    }
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      response.writeHead(404).end("Not found");
      return;
    }

    if (Number.isInteger(error.statusCode)) {
      sendJson(response, error.statusCode, { error: error.message });
      return;
    }

    console.error("Unable to serve request:", error);
    response.writeHead(500).end("Unable to serve this file.");
  }
}

async function serveCertificateSetup(request, response) {
  if (request.method !== "GET") {
    response.writeHead(405, { Allow: "GET" }).end("Method not allowed");
    return;
  }
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/rootCA.crt") {
    try {
      const certificate = await readFile(resolve(root, "certs", "rootCA.pem"));
      response.writeHead(200, {
        "Content-Type": "application/pkix-cert",
        "Content-Disposition": "attachment; filename=\"rootCA.crt\"",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(certificate);
    } catch (error) {
      if (error.code === "ENOENT") {
        response.writeHead(404).end("Certificate setup has not run yet. Start with npm.cmd run start:https.");
        return;
      }
      throw error;
    }
    return;
  }
  if (pathname !== "/") {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#101319">
<title>Set up DIY VR on iPhone</title>
<style>
  body{max-width:620px;margin:40px auto;padding:0 20px;background:#101319;color:#f4f3f0;font:16px/1.6 system-ui,-apple-system,sans-serif}
  h1{color:#b9f3d4;font-size:26px}li{margin:12px 0}a{display:inline-block;margin:10px 0;padding:12px 16px;border-radius:8px;background:#b9f3d4;color:#101319;font-weight:700;text-decoration:none}
  code{color:#d1c3ff}strong{color:#fff}
</style>
<h1>Set up secure access for DIY VR</h1>
<p>This one-time step lets iPhone Safari use the camera and motion sensors with your PC-hosted VR site.</p>
<ol>
  <li>Tap the button to download the local certificate. It is a public certificate; this page does not expose the private key.</li>
  <li>Open <strong>Settings</strong> and tap <strong>Profile Downloaded</strong>, then install the mkcert profile.</li>
  <li>Go to <strong>Settings → General → About → Certificate Trust Settings</strong> and turn on full trust for the mkcert certificate.</li>
  <li>Return to Safari and open the HTTPS address printed by the PC, such as <code>https://192.168.1.23:8080</code>.</li>
</ol>
<p><a href="/rootCA.crt">Download iPhone certificate</a></p>
<p>Only install this certificate on your own iPhone. Keep the PC's <code>certs/dev-key.pem</code> private.</p>
</html>`);
}

function printAddresses(protocol) {
  console.log(`DIY VR is running on ${protocol} port ${port}.`);
  console.log(`On this PC: ${protocol}://localhost:${port}`);

  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) {
        console.log(`On your local network: ${protocol}://${address.address}:${port}`);
      }
    }
  }

  if (protocol === "http") {
    console.log("For iPhone motion tracking, use HTTPS; see the README for free local setup.");
  } else {
    for (const addresses of Object.values(networkInterfaces())) {
      for (const address of addresses || []) {
        if (address.family === "IPv4" && !address.internal) {
          console.log(`On iPhone first-time setup: http://${address.address}:${setupPort}/`);
        }
      }
    }
    console.log("Keep the certificate private key private; it is excluded from version control.");
  }
}

let server;
if (wantsHttps) {
  try {
    const [key, cert] = await Promise.all([
      readFile(resolve(root, "certs", "dev-key.pem")),
      readFile(resolve(root, "certs", "dev-cert.pem")),
    ]);
    server = createHttpsServer({ key, cert }, serveFile);
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(
        "HTTPS certificate files are missing. Follow the README to create certs/dev-key.pem and certs/dev-cert.pem.",
      );
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
} else {
  server = createServer(serveFile);
}

if (server) {
  server.listen(port, "0.0.0.0", () => printAddresses(wantsHttps ? "https" : "http"));
  if (wantsHttps) {
    const certificateSetupServer = createServer((request, response) => {
      serveCertificateSetup(request, response).catch((error) => {
        console.error("Unable to serve the iPhone certificate setup page:", error);
        if (!response.headersSent) response.writeHead(500);
        response.end("Unable to serve the certificate setup page.");
      });
    });
    certificateSetupServer.on("error", (error) => {
      console.error(`Unable to start the iPhone certificate setup server on port ${setupPort}:`, error);
    });
    certificateSetupServer.listen(setupPort, "0.0.0.0", () => {
      console.log(`iPhone certificate setup is available on HTTP port ${setupPort}.`);
    });
  }
}
