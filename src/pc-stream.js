const SIGNAL_POLL_INTERVAL_MS = 400;

async function requestJson(path, options) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
    cache: "no-store",
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("PC streaming needs the project server running locally with `npm.cmd start` or `npm.cmd run start:https`.");
  }
  if (!response.ok) throw new Error(result.error || `Stream request failed (${response.status}).`);
  return result;
}

export async function createPcStreamSession() {
  return requestJson("/api/stream/session", { method: "POST", body: "{}" });
}

export async function joinPcStreamSession(code) {
  await requestJson("/api/stream/join", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function createPcStreamPeer({ code, role, token, onTrack, onState }) {
  const peer = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  let closed = false;
  let pollTimer;
  let pollPending = false;
  let lastMessageId = 0;
  const pendingCandidates = [];

  const reportError = (error) => {
    if (!closed) onState("error", error instanceof Error ? error.message : String(error));
  };

  const sendSignal = async (message) => {
    await requestJson("/api/stream/signal", {
      method: "POST",
      body: JSON.stringify({ code, role, token, message }),
    });
  };

  peer.onicecandidate = ({ candidate }) => {
    if (candidate) sendSignal({ type: "candidate", candidate }).catch(reportError);
  };
  peer.ontrack = (event) => {
    onTrack(event.streams[0] || new MediaStream([event.track]));
  };
  peer.onconnectionstatechange = () => {
    const state = peer.connectionState;
    onState(state === "connected" ? "connected" : state === "failed" ? "error" : state);
    if (state === "failed") reportError("The PC-to-VR connection failed. Check both devices are on the same network and try again.");
  };
  peer.oniceconnectionstatechange = () => {
    if (peer.iceConnectionState === "failed") {
      reportError("No direct network route was found. This stream currently requires both devices on the same local network.");
    }
  };

  const receiveSignals = async () => {
    if (closed || pollPending) return;
    pollPending = true;
    try {
      const params = new URLSearchParams({
        code,
        role,
        after: String(lastMessageId),
      });
      if (token) params.set("token", token);
      const { messages } = await requestJson(`/api/stream/signals?${params}`, { method: "GET" });
      for (const entry of messages) {
        lastMessageId = Math.max(lastMessageId, entry.id);
        if (entry.message.type === "ended") {
          onState("ended");
          close();
          return;
        }
        if (entry.message.type === "candidate") {
          if (peer.remoteDescription) {
            await peer.addIceCandidate(entry.message.candidate);
          } else {
            pendingCandidates.push(entry.message.candidate);
          }
        } else if (role === "viewer" && entry.message.type === "offer") {
          await peer.setRemoteDescription(entry.message.offer);
          while (pendingCandidates.length) {
            await peer.addIceCandidate(pendingCandidates.shift());
          }
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          await sendSignal({ type: "answer", answer });
          onState("connecting");
        } else if (role === "host" && entry.message.type === "answer") {
          await peer.setRemoteDescription(entry.message.answer);
          while (pendingCandidates.length) {
            await peer.addIceCandidate(pendingCandidates.shift());
          }
        }
      }
    } catch (error) {
      reportError(error);
      close();
      return;
    } finally {
      pollPending = false;
    }
    if (!closed) pollTimer = setTimeout(receiveSignals, SIGNAL_POLL_INTERVAL_MS);
  };

  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(pollTimer);
    peer.ontrack = null;
    peer.onicecandidate = null;
    peer.close();
  };

  return {
    peer,
    startPolling: receiveSignals,
    sendSignal,
    close,
    addTrack: (track, stream) => peer.addTrack(track, stream),
    createOffer: async () => {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await sendSignal({ type: "offer", offer });
      onState("waiting");
    },
  };
}
