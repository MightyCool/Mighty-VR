import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { networkInterfaces } from "node:os";
import { randomBytes, randomInt } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.env.PORT || 8080);
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
    session.expiresAt = Date.now() + STREAM_SESSION_TTL_MS;
    sendJson(response, 200, { joined: true });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/stream/signal") {
    const { code, role, token, message } = await readJson(request);
    const session = typeof code === "string" ? getStreamSession(code) : undefined;
    if (!session || (role !== "host" && role !== "viewer")) {
      sendJson(response, 404, { error: "Stream session not found." });
      return true;
    }
    if ((role === "host" && token !== session.token) || (role === "viewer" && !session.viewerJoined)) {
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
    if ((role === "host" && token !== session.token) || (role === "viewer" && !session.viewerJoined)) {
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
    console.log("Keep the certificate files private; they are excluded from version control.");
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
}
