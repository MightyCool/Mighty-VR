const SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_SIGNAL_MESSAGES = 128;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_SIGNAL_BYTES = 48 * 1024;

function jsonResponse(request, status, body) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  });
  return new Response(JSON.stringify(body), { status, headers });
}

async function readJson(request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) throw new RequestError(413, "Request body is too large.");
  const text = await request.text();
  if (text.length > MAX_REQUEST_BYTES) throw new RequestError(413, "Request body is too large.");
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new RequestError(400, "Request body must be valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError(400, "Request body must be a JSON object.");
  }
  return body;
}

function randomCode() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return String(1000 + (value[0] % 9000));
}

function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sessionRequest(env, code, path, init = {}) {
  const id = env.STREAM_SESSIONS.idFromName(code);
  return env.STREAM_SESSIONS.get(id).fetch(`https://stream-session.internal${path}`, init);
}

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/stream/")) {
      return jsonResponse(request, 404, { error: "Not found." });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin",
        },
      });
    }

    try {
      if (request.method === "POST" && url.pathname === "/api/stream/session") {
        for (let attempt = 0; attempt < 32; attempt += 1) {
          const code = randomCode();
          const token = randomToken();
          const response = await sessionRequest(env, code, "/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, expiresAt: Date.now() + SESSION_TTL_MS }),
          });
          if (response.status === 409) continue;
          if (!response.ok) return new Response(response.body, { status: response.status, headers: corsHeaders() });
          return jsonResponse(request, 201, {
            code,
            token,
            expiresInSeconds: SESSION_TTL_MS / 1000,
          });
        }
        throw new RequestError(503, "Could not create a unique stream code. Try again.");
      }

      if (request.method === "POST" && url.pathname === "/api/stream/join") {
        const { code } = await readJson(request);
        if (typeof code !== "string" || !/^\d{4}$/.test(code)) {
          throw new RequestError(400, "Enter the four-digit stream code.");
        }
        const token = randomToken();
        return proxySession(request, env, code, "/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
      }

      if (request.method === "POST" && url.pathname === "/api/stream/signal") {
        const body = await readJson(request);
        const { code, role, token, message } = body;
        if (typeof code !== "string" || !/^\d{4}$/.test(code) ||
            (role !== "host" && role !== "viewer") ||
            !message || typeof message !== "object" ||
            !["offer", "answer", "candidate", "ended"].includes(message.type)) {
          throw new RequestError(400, "Invalid stream signaling message.");
        }
        if (JSON.stringify(message).length > MAX_SIGNAL_BYTES) {
          throw new RequestError(413, "Stream signaling message is too large.");
        }
        return proxySession(request, env, code, "/signal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, token, message }),
        });
      }

      if (request.method === "GET" && url.pathname === "/api/stream/signals") {
        const code = url.searchParams.get("code");
        const role = url.searchParams.get("role");
        const token = url.searchParams.get("token");
        const after = Number(url.searchParams.get("after") || 0);
        if (!code || !/^\d{4}$/.test(code) || (role !== "host" && role !== "viewer") ||
            !Number.isSafeInteger(after) || after < 0) {
          throw new RequestError(400, "Invalid signaling request.");
        }
        const params = new URLSearchParams({ role, after: String(after) });
        if (token) params.set("token", token);
        return proxySession(request, env, code, `/signals?${params}`, { method: "GET" });
      }

      return jsonResponse(request, 404, { error: "Not found." });
    } catch (error) {
      if (error instanceof RequestError) return jsonResponse(request, error.status, { error: error.message });
      console.error("PC stream request failed:", error);
      return jsonResponse(request, 500, { error: "The PC streaming service encountered an error. Try again." });
    }
  },
};

function corsHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

async function proxySession(request, env, code, path, init) {
  const response = await sessionRequest(env, code, path, init);
  return new Response(response.body, {
    status: response.status,
    headers: corsHeaders(),
  });
}

export class StreamSession {
  constructor(state) {
    this.state = state;
    this.storage = state.storage;
  }

  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/create") {
        const existing = await this.loadSession();
        if (existing && existing.expiresAt > Date.now()) {
          return Response.json({ error: "Code is already active." }, { status: 409 });
        }
        const { token, expiresAt } = await readJson(request);
        if (typeof token !== "string" || !Number.isSafeInteger(expiresAt)) {
          throw new RequestError(400, "Invalid stream session.");
        }
        await this.storage.put("session", {
          token,
          expiresAt,
          viewerJoined: false,
          nextMessageId: 1,
        });
        await this.storage.put("messages", []);
        await this.state.storage.setAlarm(expiresAt);
        return Response.json({ code: url.searchParams.get("code"), expiresAt }, { status: 201 });
      }

      const session = await this.loadSession();
      if (!session || session.expiresAt <= Date.now()) {
        await this.clearSession();
        throw new RequestError(404, "That stream code is invalid or expired.");
      }

      if (request.method === "POST" && url.pathname === "/join") {
        const { token } = await readJson(request);
        if (typeof token !== "string" || !/^[0-9a-f]{48}$/.test(token)) {
          throw new RequestError(400, "Invalid viewer pairing token.");
        }
        if (session.viewerJoined) throw new RequestError(409, "This stream code is already connected to a VR device.");
        session.viewerJoined = true;
        session.viewerToken = token;
        session.expiresAt = Date.now() + SESSION_TTL_MS;
        await this.storage.put("session", session);
        await this.state.storage.setAlarm(session.expiresAt);
        return Response.json({ joined: true, token });
      }

      if (request.method === "POST" && url.pathname === "/signal") {
        const { role, token, message } = await readJson(request);
        this.authorize(session, role, token);
        const messages = await this.storage.get("messages") || [];
        messages.push({
          id: session.nextMessageId++,
          to: role === "host" ? "viewer" : "host",
          message,
        });
        if (messages.length > MAX_SIGNAL_MESSAGES) {
          messages.splice(0, messages.length - MAX_SIGNAL_MESSAGES);
        }
        if (session.viewerJoined) {
          session.expiresAt = Date.now() + SESSION_TTL_MS;
          await Promise.all([
            this.storage.put("session", session),
            this.storage.put("messages", messages),
            this.state.storage.setAlarm(session.expiresAt),
          ]);
        } else {
          await this.storage.put("messages", messages);
        }
        return Response.json({ sent: true }, { status: 202 });
      }

      if (request.method === "GET" && url.pathname === "/signals") {
        const role = url.searchParams.get("role");
        const token = url.searchParams.get("token");
        const after = Number(url.searchParams.get("after") || 0);
        this.authorize(session, role, token);
        if (!Number.isSafeInteger(after) || after < 0) {
          throw new RequestError(400, "Invalid signaling message cursor.");
        }
        if (session.viewerJoined) {
          session.expiresAt = Date.now() + SESSION_TTL_MS;
          await Promise.all([
            this.storage.put("session", session),
            this.state.storage.setAlarm(session.expiresAt),
          ]);
        }
        const messages = await this.storage.get("messages") || [];
        return Response.json({
          messages: messages.filter((entry) => entry.to === role && entry.id > after),
          expiresAt: session.expiresAt,
        });
      }

      return Response.json({ error: "Not found." }, { status: 404 });
    } catch (error) {
      if (error instanceof RequestError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      console.error("Stream session request failed:", error);
      return Response.json({ error: "Unable to process this stream session." }, { status: 500 });
    }
  }

  async alarm() {
    const session = await this.loadSession();
    if (session && session.expiresAt > Date.now()) {
      await this.state.storage.setAlarm(session.expiresAt);
      return;
    }
    await this.clearSession();
  }

  async loadSession() {
    return this.storage.get("session");
  }

  authorize(session, role, token) {
    if (role !== "host" && role !== "viewer") throw new RequestError(400, "Invalid stream role.");
    if (role === "host" && (typeof token !== "string" || token !== session.token)) {
      throw new RequestError(403, "This device is not paired with the stream.");
    }
    if (role === "viewer" && (!session.viewerJoined || token !== session.viewerToken)) {
      throw new RequestError(403, "This device is not paired with the stream.");
    }
  }

  async clearSession() {
    await this.storage.deleteAll();
    await this.state.storage.deleteAlarm();
  }
}
