import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { networkInterfaces } from "node:os";
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
  "src/hand-tracking-worker.js",
  "assets/hand_landmarker.task",
  "node_modules/three/build/three.module.js",
  "node_modules/@mediapipe/tasks-vision/vision_bundle.mjs",
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

async function serveFile(request, response) {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
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

    const body = await readFile(filePath);
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
