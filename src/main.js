import * as THREE from "../node_modules/three/build/three.module.js";

const homeScreen = document.querySelector("#home-screen");
const demoScreen = document.querySelector("#demo-screen");
const launchButton = document.querySelector("#launch-button");
const homeButton = document.querySelector("#home-button");
const fullscreenButton = document.querySelector("#fullscreen-button");
const fullscreenStatus = document.querySelector("#fullscreen-status");
const stage = document.querySelector("#scene-stage");
const stereoToggle = document.querySelector("#stereo-toggle");
const motionOrientation = document.querySelector("#motion-orientation");
const renderLabels = document.querySelector("#render-labels");
const sceneMessage = document.querySelector("#scene-message");
const motionButton = document.querySelector("#motion-button");
const motionHelp = document.querySelector("#motion-help");
const diagnostic = document.querySelector("#motion-diagnostic");
const diagnosticMessage = document.querySelector("#diagnostic-message");
const motionIndicator = document.querySelector("#motion-indicator");
const sensitivitySlider = document.querySelector("#sensitivity");
const sensitivityValue = document.querySelector("#sensitivity-value");
const handTrackingButton = document.querySelector("#hand-tracking-button");
const handTrackingStatus = document.querySelector("#hand-tracking-status");

let renderer;
let scene;
let camera;
let leftCamera;
let rightCamera;
let animationFrame;
let handLandmarker;
let HandLandmarkerClass;
let handWorker;
let handWorkerReady = false;
let handDetectionPending = false;
let handStream;
let handVideo;
let handTrackingActive = false;
let handVideoPlaybackPending = false;
let lastHandFrameTime = 0;
let lastHandVideoTime = -1;
let handWasPinching = false;
let handRig;
let handJoints;
let handCursor;
let handLauncher;
let handMenu;
let handMenuCanvas;
let handMenuContext;
let handMenuTexture;
let handMenuOpen = false;
let handLauncherShown = false;
let handTouchTarget = null;
let handTouchStartedAt = 0;
let handTouchActivated = false;
let handHoveredTarget = null;
let handSegments;
let orientationAvailable = typeof window.DeviceOrientationEvent === "function";
let orientationState = "off";
let currentOrientation = null;
let lastOrientationEvent = null;
let recenterOffset = new THREE.Quaternion();
let manualYaw = 0;
let manualPitch = 0;
let sensitivity = Number(sensitivitySlider.value);
let pointerDrag = null;
let resizeObserver;

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const SCREEN_AXIS = new THREE.Vector3(0, 0, 1);
const orientationQuaternion = new THREE.Quaternion();
const screenTransform = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
const cameraEuler = new THREE.Euler(0, 0, 0, "YXZ");
const screenOrientationQuaternion = new THREE.Quaternion();
const eyeOffset = new THREE.Vector3();
const handWorldPoint = new THREE.Vector3();
const handPoints = Array.from({ length: 21 }, () => new THREE.Vector3());
const handSegmentDirection = new THREE.Vector3();
const handInstanceScale = new THREE.Vector3();
const handInstanceMatrix = new THREE.Matrix4();
const handSegmentQuaternion = new THREE.Quaternion();
const handIdentityQuaternion = new THREE.Quaternion();
const handConnections = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
const HAND_MODEL_URL = new URL("assets/hand_landmarker.task", document.baseURI).href;
const HAND_WASM_BASE_URL = new URL(
  "node_modules/@mediapipe/tasks-vision/wasm/",
  document.baseURI,
);
const deviceOrientationHandler = (event) => {
  if (![event.alpha, event.beta, event.gamma].every(Number.isFinite)) return;

  lastOrientationEvent = { alpha: event.alpha, beta: event.beta, gamma: event.gamma };
  updateDeviceOrientation(lastOrientationEvent);

  if (orientationState === "listening") {
    orientationState = "active";
    recenterOffset.copy(currentOrientation).invert();
    motionButton.textContent = "Motion on";
    setMotionStatus("active", "Motion tracking is active. Move your phone to look around.");
  }
  updateMotionReadout(event);
};

function updateDeviceOrientation(event) {
  cameraEuler.set(
    THREE.MathUtils.degToRad(event.beta),
    THREE.MathUtils.degToRad(event.alpha),
    THREE.MathUtils.degToRad(-event.gamma),
  );
  orientationQuaternion.setFromEuler(cameraEuler).multiply(screenTransform);
  const detectedAngle = Number(window.screen?.orientation?.angle ?? window.orientation ?? 0) || 0;
  const screenAngle =
    motionOrientation.value === "portrait"
      ? 0
      : motionOrientation.value === "landscape" && Math.abs(detectedAngle % 180) !== 90
        ? 90
        : detectedAngle;
  screenOrientationQuaternion.setFromAxisAngle(
    SCREEN_AXIS,
    -THREE.MathUtils.degToRad(Number(screenAngle) || 0),
  );
  orientationQuaternion.multiply(screenOrientationQuaternion);
  currentOrientation = orientationQuaternion.clone();
}

launchButton.addEventListener("click", () => {
  homeScreen.hidden = true;
  demoScreen.hidden = false;
  startScene();
});

homeButton.addEventListener("click", () => {
  stopHandTracking();
  stopScene();
  demoScreen.hidden = true;
  homeScreen.hidden = false;
});

document.querySelector("#recenter-button").addEventListener("click", recenterView);
document.querySelector("#recenter-top").addEventListener("click", recenterView);
document.querySelector("#stereo-recenter").addEventListener("click", recenterView);
fullscreenButton.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", updateFullscreenButton);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && handTrackingActive && handVideo?.paused && !handVideoPlaybackPending) {
    playHandVideo().catch((error) => {
      console.error("Unable to resume hand-tracking video:", error);
      handTrackingStatus.textContent = "Camera video paused. Tap Stop hand tracking, then enable it again.";
    });
  }
});
motionOrientation.addEventListener("change", refreshScreenOrientation);
window.screen?.orientation?.addEventListener("change", refreshScreenOrientation);
document.querySelector("#stereo-exit").addEventListener("click", () => {
  stereoToggle.checked = false;
  stereoToggle.dispatchEvent(new Event("change", { bubbles: true }));
});

stereoToggle.addEventListener("change", () => {
  renderLabels.hidden = !stereoToggle.checked;
  document.querySelector("#stereo-actions").hidden = !stereoToggle.checked;
  demoScreen.classList.toggle("is-stereo", stereoToggle.checked);
  if (stereoToggle.checked) {
    document.querySelector("#stereo-exit").focus({ preventScroll: true });
  } else {
    stereoToggle.focus({ preventScroll: true });
  }
  if (renderer && camera) resizeRenderer();
});

sensitivitySlider.addEventListener("input", () => {
  sensitivity = Number(sensitivitySlider.value);
  sensitivityValue.value = `${sensitivity.toFixed(1)}×`;
  sensitivityValue.textContent = sensitivityValue.value;
});

motionButton.addEventListener("click", enableMotion);
handTrackingButton.addEventListener("click", () => {
  if (handTrackingActive) {
    stopHandTracking();
  } else {
    startHandTracking();
  }
});
stage.addEventListener("pointerdown", onPointerDown);
stage.addEventListener("pointermove", onPointerMove);
stage.addEventListener("pointerup", onPointerUp);
stage.addEventListener("pointercancel", onPointerUp);
stage.addEventListener("lostpointercapture", onPointerUp);
window.addEventListener("keydown", onKeyDown);
window.addEventListener("orientationchange", refreshScreenOrientation);

if (!orientationAvailable && window.isSecureContext) {
  motionButton.disabled = true;
  motionButton.textContent = "Not available";
  motionHelp.textContent = "This browser does not support device motion. Use drag or arrow keys.";
  setMotionStatus("warning", "Motion sensors are not available in this browser. Drag the scene or use the arrow keys.");
} else if (!window.isSecureContext) {
  motionHelp.textContent = "Motion tracking needs a secure HTTPS address on your iPhone.";
  setMotionStatus("warning", "Motion tracking needs HTTPS. Use drag controls here or see the README for free local HTTPS setup.");
}

function setMotionStatus(state, message) {
  orientationState = state === "active" ? "active" : state === "listening" ? "listening" : state;
  diagnosticMessage.textContent = message;
  diagnostic.classList.toggle("is-active", state === "active");
  diagnostic.classList.toggle("is-warning", state === "warning");
  motionIndicator.classList.toggle("is-active", state === "active");
  motionIndicator.classList.toggle("is-warning", state === "warning");

  const label = state === "active" ? "MOTION ON" : state === "listening" ? "WAITING" : state === "warning" ? "CHECK MOTION" : "MOTION OFF";
  motionIndicator.lastChild.textContent = ` ${label}`;
}

function updateMotionReadout(event) {
  diagnosticMessage.textContent =
    `Motion tracking is active · α ${Math.round(event.alpha)}° · β ${Math.round(event.beta)}° · γ ${Math.round(event.gamma)}°`;
}

async function enableMotion() {
  if (!window.isSecureContext) {
    setMotionStatus(
      "warning",
      "Motion tracking needs a secure HTTPS address on your iPhone. Drag or use the arrow keys for now; see the README to enable HTTPS.",
    );
    return;
  }

  if (!orientationAvailable) {
    setMotionStatus("warning", "Motion sensors are not available. Drag the scene or use the arrow keys instead.");
    return;
  }

  if (typeof window.DeviceOrientationEvent.requestPermission === "function") {
    try {
      const permission = await window.DeviceOrientationEvent.requestPermission();
      if (permission !== "granted") {
        setMotionStatus("warning", "Motion permission was denied. You can still drag the scene or use the arrow keys.");
        return;
      }
    } catch (error) {
      console.error("Unable to request motion permission:", error);
      setMotionStatus(
        "warning",
        "Safari could not enable motion. Check this site’s settings and use drag controls in the meantime.",
      );
      return;
    }
  }

  window.removeEventListener("deviceorientation", deviceOrientationHandler);
  currentOrientation = null;
  setMotionStatus("listening", "Permission granted. Waiting for motion readings; keep this page open and move your phone.");
  motionButton.disabled = true;
  motionButton.textContent = "Waiting…";
  window.addEventListener("deviceorientation", deviceOrientationHandler);

  window.setTimeout(() => {
    if (orientationState !== "listening") return;
    setMotionStatus(
      "warning",
      "Permission was granted, but no motion readings arrived. Check iPhone Settings → Safari → Motion & Orientation Access, then reload. Drag controls still work.",
    );
    motionButton.disabled = false;
    motionButton.textContent = "Try again";
  }, 5000);
}

function refreshScreenOrientation() {
  if (!lastOrientationEvent) return;
  updateDeviceOrientation(lastOrientationEvent);
  if (orientationState === "active" || orientationState === "listening") {
    recenterOffset.copy(currentOrientation).invert();
  }
}

async function toggleFullscreen() {
  fullscreenStatus.hidden = true;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (demoScreen.requestFullscreen) {
      await demoScreen.requestFullscreen();
    } else {
      fullscreenStatus.textContent = "Full screen is not supported by this browser.";
      fullscreenStatus.hidden = false;
    }
  } catch (error) {
    console.error("Unable to change full-screen mode:", error);
    fullscreenStatus.textContent = "The browser could not enter full screen. Check its full-screen permissions.";
    fullscreenStatus.hidden = false;
  }
}

function updateFullscreenButton() {
  const isFullscreen = document.fullscreenElement === demoScreen;
  const label = isFullscreen ? "Exit full screen" : "Full screen";
  fullscreenButton.setAttribute("aria-label", isFullscreen ? "Exit full screen" : "Enter full screen");
  fullscreenButton.querySelector("span").textContent = label;
  fullscreenStatus.hidden = true;
}

function recenterView() {
  manualYaw = 0;
  manualPitch = 0;
  if (currentOrientation) {
    recenterOffset.copy(currentOrientation).invert();
    setMotionStatus("active", "View recentered. Move your phone to look around.");
  } else if (orientationState === "active" || orientationState === "listening") {
    setMotionStatus("listening", "View recentered. Waiting for the next motion reading.");
  } else {
    diagnosticMessage.textContent = "View recentered. Drag the scene or use the arrow keys to look around.";
  }
}

function startScene() {
  if (!renderer) {
    try {
      createScene();
    } catch (error) {
      console.error("Unable to create the 3D scene:", error);
      sceneMessage.hidden = false;
      sceneMessage.textContent =
        `This browser could not start the 3D scene: ${error instanceof Error ? error.message : String(error)}. ` +
        "Try reloading the page or using a browser with WebGL support.";
      return;
    }
  }

  resizeRenderer();
  resizeObserver = new ResizeObserver(resizeRenderer);
  resizeObserver.observe(stage);
  if (!animationFrame) renderFrame();
}

function stopScene() {
  stopHandTracking();
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = undefined;
  }
  resizeObserver?.disconnect();
  resizeObserver = undefined;
}

function createScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x151925);
  scene.fog = new THREE.Fog(0x151925, 11, 29);

  camera = new THREE.PerspectiveCamera(76, 1, 0.1, 60);
  camera.position.set(0, 1.65, 0.15);
  leftCamera = new THREE.PerspectiveCamera();
  rightCamera = new THREE.PerspectiveCamera();

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  stage.prepend(renderer.domElement);

  buildRoom();
  buildDecor();
  buildHandOverlay();
  renderer.setAnimationLoop(null);
}

function buildHandOverlay() {
  handRig = new THREE.Group();
  const handMaterial = new THREE.MeshStandardMaterial({
    color: 0xd7a986,
    roughness: 0.58,
    depthTest: false,
  });
  const segmentGeometry = new THREE.CylinderGeometry(1, 1, 1, 6);
  handSegments = new THREE.InstancedMesh(segmentGeometry, handMaterial, handConnections.length);
  handSegments.renderOrder = 15;
  handSegments.frustumCulled = false;
  handRig.add(handSegments);

  const jointGeometry = new THREE.SphereGeometry(1, 6, 5);
  const jointMaterial = new THREE.MeshStandardMaterial({ color: 0xe2b99a, roughness: 0.55, depthTest: false });
  handJoints = new THREE.InstancedMesh(jointGeometry, jointMaterial, 21);
  handJoints.renderOrder = 15;
  handJoints.frustumCulled = false;
  handRig.add(handJoints);
  handRig.visible = false;
  handRig.renderOrder = 15;
  scene.add(handRig);

  handCursor = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd17c }),
  );
  handCursor.visible = false;
  handCursor.renderOrder = 16;
  scene.add(handCursor);

  const launcherCanvas = document.createElement("canvas");
  launcherCanvas.width = 320;
  launcherCanvas.height = 150;
  const launcherContext = launcherCanvas.getContext("2d");
  launcherContext.fillStyle = "#171a22ee";
  roundedRectPath(launcherContext, 4, 4, 312, 142, 28);
  launcherContext.fill();
  launcherContext.strokeStyle = "#b9f3d4";
  launcherContext.lineWidth = 5;
  launcherContext.stroke();
  launcherContext.fillStyle = "#b9f3d4";
  launcherContext.font = "600 62px sans-serif";
  launcherContext.textAlign = "center";
  launcherContext.textBaseline = "middle";
  launcherContext.fillText("◉ MVR", 160, 75);
  const launcherTexture = new THREE.CanvasTexture(launcherCanvas);
  handLauncher = new THREE.Mesh(
    new THREE.PlaneGeometry(0.54, 0.26),
    new THREE.MeshBasicMaterial({ map: launcherTexture, transparent: true, depthTest: false }),
  );
  handLauncher.visible = false;
  handLauncher.renderOrder = 10;
  scene.add(handLauncher);

  handMenuCanvas = document.createElement("canvas");
  handMenuCanvas.width = 512;
  handMenuCanvas.height = 640;
  handMenuContext = handMenuCanvas.getContext("2d");
  handMenuTexture = new THREE.CanvasTexture(handMenuCanvas);
  handMenu = new THREE.Mesh(
    new THREE.PlaneGeometry(0.82, 1.02),
    new THREE.MeshBasicMaterial({ map: handMenuTexture, transparent: true, depthTest: false }),
  );
  handMenu.visible = false;
  handMenu.renderOrder = 11;
  scene.add(handMenu);
  drawHandMenu();
}

async function startHandTracking() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    handTrackingStatus.textContent = "Camera hand tracking needs HTTPS (or localhost) and a browser with camera support.";
    return;
  }

  let startupStep = "requesting camera access";
  handTrackingActive = true;
  handTrackingButton.disabled = true;
  handTrackingButton.textContent = "Starting…";
  handTrackingStatus.textContent = "Requesting rear-camera access. Allow the camera prompt to continue.";

  try {
    const cameraConstraints = {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 320 },
        height: { ideal: 240 },
      },
    };
    handStream = await navigator.mediaDevices.getUserMedia(cameraConstraints);
    if (!handTrackingActive) {
      stopCameraStream();
      return;
    }

    let videoTrack = handStream.getVideoTracks()[0];
    if (!videoTrack) throw new Error("The browser opened the camera without a video track.");
    let facingMode;
    if (typeof videoTrack.getSettings === "function") {
      facingMode = videoTrack.getSettings().facingMode;
    }
    if (facingMode === "user") {
      for (const track of handStream.getTracks()) track.stop();
      handStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { exact: "environment" },
          width: { ideal: 320 },
          height: { ideal: 240 },
        },
      });
      videoTrack = handStream.getVideoTracks()[0];
      facingMode =
        videoTrack && typeof videoTrack.getSettings === "function"
          ? videoTrack.getSettings().facingMode
          : undefined;
      if (!videoTrack || facingMode === "user") {
        throw new Error("Safari could not select the rear camera.");
      }
    }

    startupStep = "starting the camera video";
    handTrackingStatus.textContent = "Loading the on-device hand tracker. The first start may take a moment.";
    handVideo = document.createElement("video");
    handVideo.autoplay = true;
    handVideo.muted = true;
    handVideo.playsInline = true;
    handVideo.setAttribute("autoplay", "");
    handVideo.setAttribute("muted", "");
    handVideo.setAttribute("playsinline", "");
    handVideo.setAttribute("webkit-playsinline", "");
    handVideo.setAttribute("aria-hidden", "true");
    handVideo.className = "hand-camera-source";
    handVideo.srcObject = handStream;
    lastHandVideoTime = -1;
    document.body.append(handVideo);
    await playHandVideo();

    startupStep = "loading the hand-tracking library";
    startupStep = "initializing the on-device hand model";
    if (canUseHandTrackingWorker()) {
      try {
        await startHandWorker();
      } catch (error) {
        console.warn("Hand-tracking worker is unavailable; using the compatible local tracker:", error);
        handWorker?.terminate();
        handWorker = undefined;
        handWorkerReady = false;
        handDetectionPending = false;
        handTrackingStatus.textContent = "Preparing the compatible on-device hand tracker.";
        await initializeHandTrackerOnMainThread();
      }
    } else {
      await initializeHandTrackerOnMainThread();
    }

    if (!handTrackingActive) {
      stopCameraStream();
      return;
    }
    handTrackingButton.disabled = false;
    handTrackingButton.textContent = "Stop hand tracking";
    handTrackingStatus.textContent = "Rear camera active. Show your hand, then pinch to bring up the MVR button.";
  } catch (error) {
    console.error("Unable to start hand tracking:", error);
    stopCameraStream();
    handTrackingActive = false;
    resetHandOverlays();
    handTrackingButton.disabled = false;
    handTrackingButton.textContent = "Enable hand tracking";
    handTrackingStatus.textContent = getHandTrackingErrorMessage(error, startupStep);
  }
}

function canUseHandTrackingWorker() {
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return !isIOS && typeof Worker === "function" && typeof createImageBitmap === "function";
}

async function initializeHandTrackerOnMainThread() {
  if (!HandLandmarkerClass) {
    const vision = await import("../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs");
    HandLandmarkerClass = vision.HandLandmarker;
  }
  if (handLandmarker) return;

  const wasmFileset = {
    wasmLoaderPath: new URL("vision_wasm_nosimd_internal.js", HAND_WASM_BASE_URL).href,
    wasmBinaryPath: new URL("vision_wasm_nosimd_internal.wasm", HAND_WASM_BASE_URL).href,
  };
  handLandmarker = await HandLandmarkerClass.createFromOptions(wasmFileset, {
    baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "CPU" },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

function startHandWorker() {
  handWorkerReady = false;
  handDetectionPending = false;
  const worker = new Worker(new URL("./hand-tracking-worker.js", import.meta.url));
  handWorker = worker;

  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (worker !== handWorker) return;
      if (data.type === "ready") {
        handWorkerReady = true;
        resolve();
      } else if (data.type === "error") {
        const error = new Error(data.message);
        if (!handWorkerReady) reject(error);
        else handleHandTrackingFailure(error);
      } else if (data.type === "result") {
        handDetectionPending = false;
        processHandLandmarks(data.landmarks, data.timestamp);
      }
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || "The hand-tracking worker stopped unexpectedly.");
      if (!handWorkerReady) reject(error);
      else handleHandTrackingFailure(error);
    };
    worker.postMessage({
      type: "initialize",
      modelUrl: HAND_MODEL_URL,
      visionBundleUrl: new URL(
        "node_modules/@mediapipe/tasks-vision/vision_bundle.mjs",
        document.baseURI,
      ).href,
      wasmBaseUrl: HAND_WASM_BASE_URL.href,
    });
  });
}

async function playHandVideo() {
  if (handVideoPlaybackPending) return;
  const video = handVideo;
  const stream = handStream;
  if (!video || !stream) throw new Error("The camera video stream is no longer available.");

  handVideoPlaybackPending = true;
  try {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (handVideo !== video || handStream !== stream) {
        throw new Error("Camera startup was cancelled.");
      }
      if (stream.getVideoTracks().every((track) => track.readyState !== "live")) {
        throw new Error("The camera stopped before video playback began.");
      }
      try {
        await video.play();
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
        await waitForHandVideoFrame(video);
        return;
      } catch (error) {
        lastError = error;
        if (error.name !== "AbortError" || attempt === 2) throw error;
        await new Promise((resolve) => window.setTimeout(resolve, 180 * (attempt + 1)));
      }
    }
    throw lastError || new Error("Safari could not start camera video.");
  } finally {
    handVideoPlaybackPending = false;
  }
}

function waitForHandVideoFrame(video) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Safari started the camera but did not provide a video frame."));
    }, 8000);
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(video.error || new Error("Safari could not read a camera frame."));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("error", onError);
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) onReady();
  });
}

function getHandTrackingErrorMessage(error, startupStep) {
  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return "Safari did not grant camera access. Check Settings → Safari → Camera and this site's permission, then reload.";
  }
  if (error.name === "NotFoundError" || error.name === "OverconstrainedError") {
    return "Safari could not find a usable rear camera. Check that no other app is using it, then reload and try again.";
  }
  if (error.name === "NotReadableError") {
    return "The camera is busy in another app. Close that app and try again.";
  }
  if (error.name === "AbortError" && startupStep === "starting the camera video") {
    return "Safari interrupted camera video startup. Keep this page open, close other camera apps, then try again.";
  }
  if (error.name === "NotSupportedError" || error.name === "CompileError") {
    return "This Safari version could not initialize the hand-tracking runtime. Reload the page and try again.";
  }
  const detail = error instanceof Error ? error.message : String(error);
  const conciseDetail = detail.length > 140 ? `${detail.slice(0, 137)}…` : detail;
  return `Hand tracking failed while ${startupStep}${error.name ? ` (${error.name})` : ""}: ${conciseDetail || "unknown error"}`;
}

function stopCameraStream() {
  for (const track of handStream?.getTracks() || []) track.stop();
  handStream = undefined;
  handWorker?.terminate();
  handWorker = undefined;
  handWorkerReady = false;
  handDetectionPending = false;
  lastHandVideoTime = -1;
  if (handVideo) {
    handVideo.srcObject = null;
    handVideo.remove();
    handVideo = undefined;
  }
}

function stopHandTracking() {
  handTrackingActive = false;
  stopCameraStream();
  resetHandOverlays();
  handTrackingButton.disabled = false;
  handTrackingButton.textContent = "Enable hand tracking";
  if (handTrackingStatus) {
    handTrackingStatus.textContent =
      "Use your rear camera to see your hand in the room. Camera frames stay on this device.";
  }
}

function resetHandOverlays() {
  handRig && (handRig.visible = false);
  handCursor && (handCursor.visible = false);
  handLauncher && (handLauncher.visible = false);
  handMenu && (handMenu.visible = false);
  handLauncherShown = false;
  handMenuOpen = false;
  handWasPinching = false;
  handTouchTarget = null;
  handTouchStartedAt = 0;
  handTouchActivated = false;
  handHoveredTarget = null;
}

function updateHandTracking() {
  if (!handTrackingActive || (!handLandmarker && !(handWorker && handWorkerReady)) ||
      !handVideo || handVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return;
  }
  const now = performance.now();
  if (now - lastHandFrameTime < 100 || handVideo.currentTime === lastHandVideoTime) return;
  lastHandFrameTime = now;
  lastHandVideoTime = handVideo.currentTime;

  if (handWorker) {
    if (handDetectionPending) return;
    handDetectionPending = true;
    createImageBitmap(handVideo).then((bitmap) => {
      if (!handTrackingActive || !handWorker || !handWorkerReady) {
        bitmap.close();
        handDetectionPending = false;
        return;
      }
      handWorker.postMessage({ type: "detect", bitmap, timestamp: now }, [bitmap]);
    }).catch((error) => {
      handDetectionPending = false;
      handleHandTrackingFailure(error);
    });
    return;
  }

  try {
    const result = handLandmarker.detectForVideo(handVideo, now);
    processHandLandmarks(result.landmarks[0], now);
  } catch (error) {
    handleHandTrackingFailure(error);
  }
}

function processHandLandmarks(landmarks, now) {
  if (!handTrackingActive) return;
  if (!landmarks) {
    handRig.visible = false;
    handCursor.visible = false;
    handWasPinching = false;
    updateHandTouch(null, 0, now);
    if (handTrackingStatus.textContent !== "Looking for a hand. Move it into the rear camera view.") {
      handTrackingStatus.textContent = "Looking for a hand. Move it into the rear camera view.";
    }
    return;
  }

  handRig.visible = true;
  handCursor.visible = true;
  if (handTrackingStatus.textContent !== "Hand tracked. Pinch anywhere to show MVR, then pinch the button or a menu control.") {
    handTrackingStatus.textContent = "Hand tracked. Pinch anywhere to show MVR, then pinch the button or a menu control.";
  }
  updateHandPose(landmarks);

  const palmSize = Math.hypot(landmarks[9].x - landmarks[0].x, landmarks[9].y - landmarks[0].y);
  const pinchDistance = Math.hypot(landmarks[4].x - landmarks[8].x, landmarks[4].y - landmarks[8].y);
  const isPinching = palmSize > 0 && pinchDistance / palmSize < 0.34;
  const fingertip = landmarks[8];
  const touchTarget = getHandTouchTarget(fingertip.x, fingertip.y);
  updateHandTouch(touchTarget, fingertip.x, now);
  if (isPinching && !handWasPinching) handleHandPinch(fingertip.x, fingertip.y);
  handWasPinching = isPinching;
  handCursor.scale.setScalar(isPinching ? 1.5 : 1);
  handCursor.material.color.set(
    handTouchTarget && handTouchActivated ? 0x6de0a0 : isPinching ? 0xffd17c : 0xb9f3d4,
  );
}

function handleHandTrackingFailure(error) {
  console.error("Hand tracking frame failed:", error);
  handTrackingActive = false;
  stopCameraStream();
  resetHandOverlays();
  handTrackingButton.disabled = false;
  handTrackingButton.textContent = "Enable hand tracking";
  handTrackingStatus.textContent = "Hand tracking paused after an error. Stop it and enable it again.";
}

function screenPointToWorld(x, y, depth, zOffset = 0) {
  const viewHeight = 2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const viewWidth = viewHeight * camera.aspect;
  handWorldPoint.set((x - 0.5) * viewWidth, (0.5 - y) * viewHeight, -depth + zOffset);
  return handWorldPoint.applyQuaternion(camera.quaternion).add(camera.position);
}

function updateHandPose(landmarks) {
  for (let i = 0; i < landmarks.length; i += 1) {
    const landmark = landmarks[i];
    handPoints[i].copy(screenPointToWorld(landmark.x, landmark.y, 1.2, landmark.z * 0.35));
  }

  const handWidth = Math.max(handPoints[5].distanceTo(handPoints[17]), handPoints[0].distanceTo(handPoints[9]) * 0.55);
  for (let i = 0; i < handConnections.length; i += 1) {
    const [start, end] = handConnections[i];
    handSegmentDirection.subVectors(handPoints[end], handPoints[start]);
    const length = handSegmentDirection.length();
    handSegmentDirection.normalize();
    handSegmentQuaternion.setFromUnitVectors(WORLD_UP, handSegmentDirection);
    const radiusScale = start === 0 || end === 0 ? 0.075 : 0.055;
    handInstanceScale.set(handWidth * radiusScale, length, handWidth * radiusScale);
    handSegmentDirection
      .copy(handPoints[start])
      .add(handPoints[end])
      .multiplyScalar(0.5);
    handInstanceMatrix.compose(handSegmentDirection, handSegmentQuaternion, handInstanceScale);
    handSegments.setMatrixAt(i, handInstanceMatrix);
  }
  handSegments.instanceMatrix.needsUpdate = true;

  for (let i = 0; i < handPoints.length; i += 1) {
    handInstanceScale.setScalar(handWidth * (i === 0 ? 0.105 : 0.09));
    handInstanceMatrix.compose(handPoints[i], handIdentityQuaternion, handInstanceScale);
    handJoints.setMatrixAt(i, handInstanceMatrix);
  }
  handJoints.instanceMatrix.needsUpdate = true;

  handCursor.position.copy(handPoints[8]);

  if (handLauncherShown) {
    handLauncher.visible = !handMenuOpen;
    handLauncher.position.copy(screenPointToWorld(0.79, 0.2, 1.15));
    handLauncher.quaternion.copy(camera.quaternion);
  }
  if (handMenuOpen) {
    handMenu.visible = true;
    handMenu.position.copy(screenPointToWorld(0.5, 0.51, 1.25));
    handMenu.quaternion.copy(camera.quaternion);
  }
}

function handleHandPinch(x, y) {
  if (!handLauncherShown) {
    handLauncherShown = true;
    handLauncher.visible = true;
    return;
  }

  const target = getHandTouchTarget(x, y);
  activateHandTarget(target, x);
}

function getMenuScreenBounds() {
  const depth = 1.25;
  const viewHeight = 2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const viewWidth = viewHeight * camera.aspect;
  const width = handMenu.geometry.parameters.width / viewWidth;
  const height = handMenu.geometry.parameters.height / viewHeight;
  return { left: 0.5 - width / 2, right: 0.5 + width / 2, top: 0.51 - height / 2, bottom: 0.51 + height / 2 };
}

function getHandTouchTarget(x, y) {
  if (!handLauncherShown) return null;
  if (!handMenuOpen) {
    return x >= 0.66 && x <= 0.92 && y >= 0.12 && y <= 0.28 ? "launcher" : null;
  }

  const bounds = getMenuScreenBounds();
  if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
  const canvasX = ((x - bounds.left) / (bounds.right - bounds.left)) * handMenuCanvas.width;
  const canvasY = ((y - bounds.top) / (bounds.bottom - bounds.top)) * handMenuCanvas.height;
  if ((canvasY <= 92 && canvasX >= 420) || canvasY >= 570) return "close";
  if (canvasY >= 112 && canvasY <= 218) return canvasX < 256 ? "sensitivity-down" : "sensitivity-up";
  if (canvasY >= 236 && canvasY <= 330) return "orientation";
  if (canvasY >= 348 && canvasY <= 442) return "stereo";
  if (canvasY >= 460 && canvasY <= 554) return "recenter";
  return null;
}

function updateHandTouch(target, x, now) {
  if (target !== handTouchTarget) {
    handTouchTarget = target;
    handTouchStartedAt = now;
    handTouchActivated = false;
    if (handHoveredTarget !== target) {
      handHoveredTarget = target;
      if (handMenuOpen) drawHandMenu();
    }
    return;
  }
  if (!target || handTouchActivated || now - handTouchStartedAt < 350) return;
  handTouchActivated = true;
  activateHandTarget(target, x);
}

function activateHandTarget(target, x) {
  if (target === "launcher") {
    handMenuOpen = true;
    handLauncher.visible = false;
    handMenu.visible = true;
    drawHandMenu();
    return;
  }
  if (!target) return;

  if (target === "close") {
    handMenuOpen = false;
    handMenu.visible = false;
    handLauncher.visible = true;
  } else if (target === "sensitivity-down" || target === "sensitivity-up") {
    const amount = target === "sensitivity-down" ? -0.1 : 0.1;
    sensitivitySlider.value = String(THREE.MathUtils.clamp(sensitivity + amount, 0.4, 2));
    sensitivitySlider.dispatchEvent(new Event("input", { bubbles: true }));
  } else if (target === "orientation") {
    const nextMode = { auto: "portrait", portrait: "landscape", landscape: "auto" }[motionOrientation.value];
    motionOrientation.value = nextMode;
    motionOrientation.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (target === "stereo") {
    stereoToggle.checked = !stereoToggle.checked;
    stereoToggle.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (target === "recenter") {
    recenterView();
  }
  drawHandMenu();
}

function drawHandMenu() {
  if (!handMenuContext) return;
  const context = handMenuContext;
  context.clearRect(0, 0, handMenuCanvas.width, handMenuCanvas.height);
  context.fillStyle = "#151822f2";
  roundedRectPath(context, 8, 8, 496, 624, 32);
  context.fill();
  context.strokeStyle = "#b9f3d4";
  context.lineWidth = 5;
  context.stroke();
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#b9f3d4";
  context.font = "600 38px sans-serif";
  context.fillText("MVR  ·  ROOM SETTINGS", 256, 58);
  context.font = "600 34px sans-serif";
  context.fillText("×", 464, 56);
  context.font = "22px sans-serif";
  drawHandMenuButton(context, 34, 112, 444, 106, `Sensitivity    −   ${sensitivity.toFixed(1)}×   +`, handHoveredTarget?.startsWith("sensitivity"));
  drawHandMenuButton(context, 34, 236, 444, 94, `Orientation    ${motionOrientation.value}`, handHoveredTarget === "orientation");
  drawHandMenuButton(context, 34, 348, 444, 94, `Headset view    ${stereoToggle.checked ? "ON" : "OFF"}`, handHoveredTarget === "stereo");
  drawHandMenuButton(context, 34, 460, 444, 94, "Recenter view", handHoveredTarget === "recenter");
  context.fillStyle = "#b8b9c4";
  context.font = "18px sans-serif";
  context.fillText("Touch or pinch a control · Touch here to close", 256, 594);
  handMenuTexture.needsUpdate = true;
}

function drawHandMenuButton(context, x, y, width, height, label, hovered = false) {
  context.fillStyle = hovered ? "#3d5148" : "#292d39";
  roundedRectPath(context, x, y, width, height, 18);
  context.fill();
  context.strokeStyle = "#ffffff30";
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = "#f4f3f0";
  context.font = "24px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, x + width / 2, y + height / 2, width - 20);
}

function roundedRectPath(context, x, y, width, height, radius) {
  const corner = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + corner, y);
  context.lineTo(x + width - corner, y);
  context.arcTo(x + width, y, x + width, y + corner, corner);
  context.lineTo(x + width, y + height - corner);
  context.arcTo(x + width, y + height, x + width - corner, y + height, corner);
  context.lineTo(x + corner, y + height);
  context.arcTo(x, y + height, x, y + height - corner, corner);
  context.lineTo(x, y + corner);
  context.arcTo(x, y, x + corner, y, corner);
  context.closePath();
}

function buildRoom() {
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x373547, roughness: 0.9 });
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x3d3952, roughness: 0.95, side: THREE.DoubleSide });
  const backMaterial = new THREE.MeshStandardMaterial({ color: 0x49425d, roughness: 0.95 });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  scene.add(floor);

  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(12, 5), backMaterial);
  backWall.position.set(0, 2.5, -5);
  scene.add(backWall);

  for (const x of [-6, 6]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(12, 5), wallMaterial);
    wall.rotation.y = Math.PI / 2;
    wall.position.set(x, 2.5, 1);
    scene.add(wall);
  }

  scene.add(new THREE.HemisphereLight(0xffe8ca, 0x373047, 1.8));
  const ceilingGlow = new THREE.PointLight(0xffd59e, 22, 18, 2);
  ceilingGlow.position.set(0, 4.35, -0.5);
  scene.add(ceilingGlow);
}

function addBox(position, scale, color, rotation = 0) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.12 }),
  );
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.rotation.y = rotation;
  scene.add(mesh);
  return mesh;
}

function addCylinder(position, radius, height, color) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.83, radius, height, 32),
    new THREE.MeshStandardMaterial({ color, roughness: 0.45 }),
  );
  mesh.position.set(...position);
  scene.add(mesh);
  return mesh;
}

function addCone(position, radius, height, color) {
  const mesh = new THREE.Mesh(
    new THREE.ConeGeometry(radius, height, 20, 1, true),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7, side: THREE.DoubleSide }),
  );
  mesh.position.set(...position);
  mesh.rotation.z = Math.PI;
  scene.add(mesh);
  return mesh;
}

function addSoftCushion(position, scale, color) {
  const cushion = new THREE.Mesh(
    new THREE.SphereGeometry(1, 18, 12),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
  );
  cushion.position.set(...position);
  cushion.scale.set(...scale);
  scene.add(cushion);
}

function buildPlant(x, z, scale = 1) {
  addCylinder([x, 0.2 * scale, z], 0.23 * scale, 0.4 * scale, 0x9a6950);
  addCylinder([x, 0.4 * scale, z], 0.18 * scale, 0.04 * scale, 0x40342d);
  for (const [dx, dy, dz, size] of [
    [-0.2, 0.72, 0, 0.27],
    [0.18, 0.84, -0.04, 0.3],
    [0, 1.08, 0.03, 0.32],
    [0.12, 1.28, 0, 0.24],
    [-0.16, 1.02, 0.05, 0.24],
  ]) {
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(size * scale, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0x66866b, roughness: 0.8 }),
    );
    leaf.position.set(x + dx * scale, dy * scale, z + dz * scale);
    leaf.scale.set(0.72, 1.5, 0.72);
    scene.add(leaf);
  }
}

function buildFloorLamp(x, z) {
  addCylinder([x, 0.78, z], 0.07, 1.56, 0x574737);
  addCylinder([x, 0.08, z], 0.34, 0.16, 0x574737);
  addCone([x, 1.82, z], 0.32, 0.45, 0xe9c99a);
  const glow = new THREE.PointLight(0xffbd72, 12, 5, 2);
  glow.position.set(x, 1.57, z);
  scene.add(glow);
}

function buildDecor() {
  const rug = addBox([0, 0.035, -2.65], [4.6, 0.07, 3.1], 0x725d67);
  rug.material.roughness = 0.95;
  addBox([0, 0.076, -2.65], [4.3, 0.012, 2.8], 0x9a7978);

  addBox([-4.25, 0.22, -2.15], [2.25, 0.36, 3.25], 0x654d45);
  addBox([-4.25, 0.48, -2.12], [2.18, 0.28, 3.12], 0xe8dfcf);
  addBox([-4.25, 0.65, -2.15], [2.04, 0.12, 1.95], 0x9b7480);
  addBox([-4.25, 0.74, -1.65], [2.04, 0.1, 0.95], 0xb58d92);
  addBox([-4.82, 0.79, -3.18], [0.72, 0.22, 0.58], 0xf1e6d5);
  addBox([-3.78, 0.79, -3.18], [0.72, 0.22, 0.58], 0xf1e6d5);
  addBox([-4.25, 0.85, -3.76], [2.32, 1.25, 0.16], 0x704f49);
  addBox([-4.25, 1.48, -3.66], [1.8, 0.04, 0.04], 0xcaa77e);
  addBox([-4.25, 0.08, -2.15], [1.7, 0.16, 1.8], 0xb58d92);

  addBox([2.85, 1.02, -4.22], [2.75, 0.14, 0.92], 0x9a7050);
  for (const x of [1.68, 4.02]) {
    for (const z of [-4.53, -3.93]) addBox([x, 0.5, z], [0.11, 1, 0.11], 0x684b38);
  }
  addBox([3.62, 0.81, -4.19], [0.62, 0.28, 0.67], 0x79583f);
  addBox([2.82, 1.13, -4.25], [0.72, 0.045, 0.08], 0x473c39, -0.08);
  addBox([2.82, 1.48, -4.22], [0.76, 0.5, 0.06], 0x574a49);
  addBox([2.82, 1.49, -4.18], [0.68, 0.41, 0.012], 0xc49a78);
  addBox([2.02, 1.12, -4.12], [0.12, 0.04, 0.12], 0xe7d0a5);
  addCone([2.02, 1.43, -4.12], 0.2, 0.3, 0xf1d4a4);
  const deskGlow = new THREE.PointLight(0xffc879, 8, 3.4, 2);
  deskGlow.position.set(2.02, 1.38, -4.02);
  scene.add(deskGlow);
  addBox([2.85, 0.48, -3.35], [0.95, 0.14, 0.92], 0x6e5a50);
  addBox([2.85, 0.97, -3.76], [0.95, 0.9, 0.12], 0x80695d);
  for (const x of [2.48, 3.22]) {
    for (const z of [-3.68, -3.02]) addBox([x, 0.25, z], [0.09, 0.5, 0.09], 0x644b3e);
  }

  addBox([0.15, 0.42, -2.72], [3.05, 0.42, 0.92], 0x6f7370);
  addBox([0.15, 0.91, -2.26], [3.05, 0.88, 0.3], 0x747b75);
  addBox([-1.36, 0.67, -2.71], [0.32, 0.62, 0.92], 0x747b75);
  addBox([1.66, 0.67, -2.71], [0.32, 0.62, 0.92], 0x747b75);
  for (const x of [-0.77, 0.15, 1.07]) {
    addSoftCushion([x, 0.71, -2.96], [0.43, 0.14, 0.35], 0x898e85);
  }
  for (const x of [-1.12, 1.42]) {
    for (const z of [-3.03, -2.41]) addBox([x, 0.16, z], [0.12, 0.32, 0.12], 0x574737);
  }

  addBox([0.05, 0.51, -1.55], [1.72, 0.12, 0.88], 0x9a7050);
  for (const x of [-0.62, 0.72]) {
    for (const z of [-1.85, -1.25]) addBox([x, 0.26, z], [0.09, 0.5, 0.09], 0x684b38);
  }
  addBox([-0.36, 0.59, -1.55], [0.52, 0.08, 0.36], 0xb17d65);
  addBox([-0.36, 0.65, -1.55], [0.42, 0.035, 0.31], 0xd8b793);
  addCylinder([0.42, 0.7, -1.61], 0.1, 0.18, 0xe7d6bd);

  addBox([-4.25, 2.32, -4.91], [1.6, 1.15, 0.1], 0xd9c5a4);
  addBox([-4.25, 2.32, -4.84], [1.42, 0.97, 0.04], 0x829083);
  addBox([-4.25, 2.21, -4.81], [0.06, 0.62, 0.025], 0xd7b994);
  addBox([-4.08, 2.46, -4.81], [0.32, 0.42, 0.025], 0xd7b994, 0.3);
  addBox([-4.42, 2.57, -4.81], [0.32, 0.34, 0.025], 0xc58e82, -0.35);
  buildFloorLamp(-2.45, -1.8);
  buildPlant(-5.15, 0.38, 1.1);
  buildPlant(5.12, -3.85, 0.9);
}

function resizeRenderer() {
  if (!renderer || !camera) return;
  const { width, height } = stage.getBoundingClientRect();
  if (!width || !height) return;

  renderer.setSize(width, height, false);
  const aspect = stereoToggle.checked ? (width / 2) / height : width / height;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  for (const eyeCamera of [leftCamera, rightCamera]) {
    eyeCamera.copy(camera);
    eyeCamera.aspect = aspect;
    eyeCamera.updateProjectionMatrix();
  }
}

function renderFrame() {
  animationFrame = requestAnimationFrame(renderFrame);
  if (!renderer || !camera) return;

  if (currentOrientation) {
    camera.quaternion.copy(currentOrientation).multiply(recenterOffset);
    camera.rotateY(manualYaw);
    camera.rotateX(manualPitch);
  } else {
    cameraEuler.set(manualPitch, manualYaw, 0, "YXZ");
    camera.quaternion.setFromEuler(cameraEuler);
  }

  updateHandTracking();

  if (!stereoToggle.checked) {
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, stage.clientWidth, stage.clientHeight);
    renderer.render(scene, camera);
    return;
  }

  const halfWidth = Math.floor(stage.clientWidth / 2);
  const fullHeight = stage.clientHeight;
  renderer.setScissorTest(true);
  renderEye(leftCamera, -0.032, 0, halfWidth, fullHeight);
  renderEye(rightCamera, 0.032, halfWidth, stage.clientWidth - halfWidth, fullHeight);
  renderer.setScissorTest(false);
}

function renderEye(eyeCamera, eyeOffsetX, viewportX, viewportWidth, viewportHeight) {
  eyeCamera.quaternion.copy(camera.quaternion);
  eyeOffset.set(eyeOffsetX, 0, 0).applyQuaternion(camera.quaternion);
  eyeCamera.position.copy(camera.position).add(eyeOffset);
  renderer.setViewport(viewportX, 0, viewportWidth, viewportHeight);
  renderer.setScissor(viewportX, 0, viewportWidth, viewportHeight);
  renderer.render(scene, eyeCamera);
}

function onPointerDown(event) {
  if (event.target instanceof Element && event.target.closest("button")) return;
  if (event.button !== 0 && event.pointerType === "mouse") return;
  pointerDrag = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  stage.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
  const multiplier = sensitivity * (currentOrientation ? 0.7 : 1);
  manualYaw -= ((event.clientX - pointerDrag.x) / Math.max(stage.clientWidth, 1)) * 2.6 * multiplier;
  manualPitch -= ((event.clientY - pointerDrag.y) / Math.max(stage.clientHeight, 1)) * 2.05 * multiplier;
  manualPitch = THREE.MathUtils.clamp(manualPitch, -1.45, 1.45);
  pointerDrag.x = event.clientX;
  pointerDrag.y = event.clientY;
}

function onPointerUp(event) {
  if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
  pointerDrag = null;
  if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
}

function onKeyDown(event) {
  if (demoScreen.hidden) return;
  if (event.key === "Escape" && stereoToggle.checked) {
    stereoToggle.checked = false;
    stereoToggle.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  if (demoScreen.hidden || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const amount = 0.07 * sensitivity;
  if (event.key === "ArrowLeft") manualYaw += amount;
  if (event.key === "ArrowRight") manualYaw -= amount;
  if (event.key === "ArrowUp") manualPitch += amount;
  if (event.key === "ArrowDown") manualPitch -= amount;
  manualPitch = THREE.MathUtils.clamp(manualPitch, -1.45, 1.45);
}
