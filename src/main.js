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
const handTrackingPerformance = document.querySelector("#hand-tracking-performance");

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
let handFrameIntervalMs = 100;
let handInferenceMs = 0;
let handInputWidth = 320;
let handProfileWindowStart = 0;
let handProfileResultCount = 0;
let handProfileDroppedFrames = 0;
let handFlightVideoTime = 0;
let handCameraFrameRate = 30;
let handStates = [];
let handUiPanel;
let handUiCanvas;
let handUiContext;
let handUiTexture;
let handUiMode = "closed";
let handUiWidth = 1.2;
let handUiHeight = 0.96;
let handAppScaleStep = 0;
let handBrowserQuery = "";
let lastHandUiActivation = "";
let lastHandUiActivationAt = 0;
let passthroughEnabled = false;
let passthroughPlane;
let passthroughMaterial;
let passthroughTexture;
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
const handCameraRight = new THREE.Vector3();
const handCameraUp = new THREE.Vector3();
const handCameraBack = new THREE.Vector3();
const handCameraViewScale = 2 * Math.tan(THREE.MathUtils.degToRad(76 / 2));
const handSegmentDirection = new THREE.Vector3();
const handInstanceScale = new THREE.Vector3();
const handInstanceMatrix = new THREE.Matrix4();
const handSegmentQuaternion = new THREE.Quaternion();
const handIdentityQuaternion = new THREE.Quaternion();
const handPanelPoint = new THREE.Vector3();
const supportsWasmSimd = (() => {
  if (typeof WebAssembly === "undefined") return false;
  const simdTest = new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123,
    3, 2, 1, 0, 10, 8, 1, 6, 0, 65, 0, 253, 17, 11,
  ]);
  return WebAssembly.validate(simdTest);
})();
const HAND_WASM_RUNTIME = supportsWasmSimd ? "vision_wasm_internal" : "vision_wasm_nosimd_internal";
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
motionOrientation.addEventListener("change", () => {
  refreshScreenOrientation();
  drawHandUi();
});
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
  drawHandUi();
});

sensitivitySlider.addEventListener("input", () => {
  sensitivity = Number(sensitivitySlider.value);
  sensitivityValue.value = `${sensitivity.toFixed(1)}×`;
  sensitivityValue.textContent = sensitivityValue.value;
  drawHandUi();
});

motionButton.addEventListener("click", enableMotion);
handTrackingButton.addEventListener("click", () => {
  if (handTrackingActive) {
    stopHandTracking();
  } else {
    startHandTracking();
  }
  drawHandUi();
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
  drawHandUi();
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
  const segmentGeometry = new THREE.CylinderGeometry(1, 1, 1, 6);
  const jointGeometry = new THREE.SphereGeometry(1, 6, 5);
  const handMaterial = new THREE.MeshStandardMaterial({
    color: 0xd7a986,
    roughness: 0.58,
    depthTest: true,
  });
  handStates = ["left", "right"].map((side, index) => {
    const rig = new THREE.Group();
    const segments = new THREE.InstancedMesh(
      segmentGeometry,
      handMaterial,
      handConnections.length,
    );
    segments.renderOrder = 15;
    segments.frustumCulled = false;
    rig.add(segments);

    const joints = new THREE.InstancedMesh(
      jointGeometry,
      new THREE.MeshStandardMaterial({
        color: index === 0 ? 0xe2b99a : 0xf0c69f,
        roughness: 0.55,
        depthTest: true,
      }),
      21,
    );
    joints.renderOrder = 15;
    joints.frustumCulled = false;
    rig.add(joints);
    rig.visible = false;
    rig.renderOrder = 15;
    rig.userData.keepVisibleInPassthrough = true;
    scene.add(rig);

    const cursor = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd17c, depthTest: true }),
    );
    cursor.visible = false;
    cursor.renderOrder = 16;
    cursor.userData.keepVisibleInPassthrough = true;
    scene.add(cursor);

    return {
      side,
      rig,
      segments,
      joints,
      cursor,
      landmarks: Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 })),
      points: Array.from({ length: 21 }, () => new THREE.Vector3()),
      previousLandmarks: new Float32Array(21 * 3),
      previousCameraQuaternion: new THREE.Quaternion(),
      previousDepth: 0,
      poseInitialized: false,
      wasPinching: false,
      wasFist: false,
      fistFrames: 0,
      releaseFrames: 0,
      touchTarget: null,
      touchStartedAt: 0,
      touchActivated: false,
      requiresRelease: false,
      visible: false,
    };
  });

  handUiCanvas = document.createElement("canvas");
  handUiCanvas.width = 800;
  handUiCanvas.height = 640;
  handUiContext = handUiCanvas.getContext("2d");
  handUiTexture = new THREE.CanvasTexture(handUiCanvas);
  handUiPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.96),
    new THREE.MeshBasicMaterial({
      map: handUiTexture,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    }),
  );
  handUiPanel.visible = false;
  handUiPanel.renderOrder = 12;
  handUiPanel.userData.keepVisibleInPassthrough = true;
  scene.add(handUiPanel);
  drawHandUi();
}

async function startHandTracking() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    handTrackingStatus.textContent = "Camera hand tracking needs HTTPS (or localhost) and a browser with camera support.";
    return;
  }

  let startupStep = "requesting camera access";
  handTrackingActive = true;
  handFrameIntervalMs = 100;
  handInferenceMs = 0;
  handInputWidth = 320;
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
        frameRate: { ideal: 30, max: 30 },
      },
    };
    handStream = await navigator.mediaDevices.getUserMedia(cameraConstraints);
    if (!handTrackingActive) {
      stopCameraStream();
      return;
    }

    let videoTrack = handStream.getVideoTracks()[0];
    if (!videoTrack) throw new Error("The browser opened the camera without a video track.");
    const cameraSettings = typeof videoTrack.getSettings === "function" ? videoTrack.getSettings() : undefined;
    handCameraFrameRate = cameraSettings?.frameRate || 30;
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
          frameRate: { ideal: 30, max: 30 },
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
    handCameraFrameRate =
      typeof videoTrack.getSettings === "function" && videoTrack.getSettings().frameRate
        ? videoTrack.getSettings().frameRate
        : handCameraFrameRate;

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
    handTrackingStatus.textContent = "Rear camera active. Show one or both hands, then curl your fingers (leave your thumb out) to open the app dock.";
    drawHandUi();
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
  return typeof Worker === "function" && typeof createImageBitmap === "function";
}

async function initializeHandTrackerOnMainThread() {
  if (!HandLandmarkerClass) {
    const vision = await import("../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs");
    HandLandmarkerClass = vision.HandLandmarker;
  }
  if (handLandmarker) return;

  const wasmFileset = {
    wasmLoaderPath: new URL(`${HAND_WASM_RUNTIME}.js`, HAND_WASM_BASE_URL).href,
    wasmBinaryPath: new URL(`${HAND_WASM_RUNTIME}.wasm`, HAND_WASM_BASE_URL).href,
  };
  handLandmarker = await HandLandmarkerClass.createFromOptions(wasmFileset, {
    baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "CPU" },
    runningMode: "VIDEO",
    numHands: 2,
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
        else fallbackFromHandWorker(error);
      } else if (data.type === "result") {
        handDetectionPending = false;
        updateHandFrameInterval(Math.max(data.inferenceMs, performance.now() - data.timestamp), true);
        recordHandTrackingResult();
        processHandLandmarks(data.landmarks, data.handedness, data.timestamp);
        updateHandTracking();
      }
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || "The hand-tracking worker stopped unexpectedly.");
      if (!handWorkerReady) reject(error);
      else fallbackFromHandWorker(error);
    };
    worker.postMessage({
      type: "initialize",
      modelUrl: HAND_MODEL_URL,
      wasmRuntime: HAND_WASM_RUNTIME,
      visionBundleUrl: new URL(
        "node_modules/@mediapipe/tasks-vision/vision_bundle.mjs",
        document.baseURI,
      ).href,
      wasmBaseUrl: HAND_WASM_BASE_URL.href,
    });
  });
}

async function fallbackFromHandWorker(error) {
  if (!handWorker) return;
  console.warn("Hand-tracking worker stopped; using the compatible local tracker:", error);
  handWorker.terminate();
  handWorker = undefined;
  handWorkerReady = false;
  handDetectionPending = false;
  if (!handTrackingActive) return;

  try {
    handTrackingStatus.textContent = "Preparing the compatible on-device hand tracker.";
    await initializeHandTrackerOnMainThread();
    handFrameIntervalMs = Math.max(100, handFrameIntervalMs);
    lastHandFrameTime = 0;
  } catch (fallbackError) {
    handleHandTrackingFailure(fallbackError);
  }
}

function updateHandFrameInterval(inferenceMs, useWorker) {
  if (!Number.isFinite(inferenceMs) || inferenceMs < 0) return;
  handInferenceMs = handInferenceMs === 0 ? inferenceMs : handInferenceMs * 0.75 + inferenceMs * 0.25;
  if (useWorker) {
    if (handInferenceMs > 80) handInputWidth = 192;
    else if (handInferenceMs > 45) handInputWidth = 256;
    else if (handInferenceMs < 32) handInputWidth = 320;
  }
  const minimumInterval = 1000 / 30;
  const maximumInterval = 500;
  const headroom = useWorker ? 1 : 1.1;
  handFrameIntervalMs = Math.min(maximumInterval, Math.max(minimumInterval, Math.ceil(handInferenceMs * headroom)));
}

function recordHandTrackingResult() {
  const now = performance.now();
  if (!handProfileWindowStart) handProfileWindowStart = now;
  handProfileResultCount += 1;
  if (handVideo && handFlightVideoTime > 0) {
    const elapsedSeconds = Math.max(0, handVideo.currentTime - handFlightVideoTime);
    handProfileDroppedFrames += Math.max(0, Math.round(elapsedSeconds * handCameraFrameRate) - 1);
  }

  const windowDuration = now - handProfileWindowStart;
  if (windowDuration < 1000) return;
  const trackingFps = (handProfileResultCount * 1000) / windowDuration;
  handTrackingPerformance.textContent =
    `${trackingFps.toFixed(0)} tracking FPS · ${handInferenceMs.toFixed(0)} ms inference · ` +
    `${handProfileDroppedFrames} skipped camera frames`;
  handTrackingPerformance.hidden = false;
  handProfileWindowStart = now;
  handProfileResultCount = 0;
  handProfileDroppedFrames = 0;
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
  setPassthroughEnabled(false);
  for (const track of handStream?.getTracks() || []) track.stop();
  handStream = undefined;
  handWorker?.terminate();
  handWorker = undefined;
  handWorkerReady = false;
  handDetectionPending = false;
  handFrameIntervalMs = 100;
  handInferenceMs = 0;
  handInputWidth = 320;
  handProfileWindowStart = 0;
  handProfileResultCount = 0;
  handProfileDroppedFrames = 0;
  handTrackingPerformance.hidden = true;
  handTrackingPerformance.textContent = "";
  for (const state of handStates) state.poseInitialized = false;
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
  for (const state of handStates) {
    state.rig.visible = false;
    state.cursor.visible = false;
    state.visible = false;
    state.wasPinching = false;
    state.wasFist = false;
    state.fistFrames = 0;
    state.releaseFrames = 0;
    state.touchTarget = null;
    state.touchStartedAt = 0;
    state.touchActivated = false;
    state.requiresRelease = false;
    state.poseInitialized = false;
  }
  handUiMode = "closed";
  lastHandUiActivation = "";
  lastHandUiActivationAt = 0;
  handUiPanel && (handUiPanel.visible = false);
  handUiPanel?.scale.set(1, 1, 1);
  handUiWidth = 1.2;
  handUiHeight = 0.96;
  handAppScaleStep = 0;
  drawHandUi();
}

function updateHandTracking() {
  if (!handTrackingActive || (!handLandmarker && !(handWorker && handWorkerReady)) ||
      !handVideo || handVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return;
  }
  const now = performance.now();
  if (now - lastHandFrameTime < handFrameIntervalMs || handVideo.currentTime === lastHandVideoTime) return;

  if (handWorker) {
    if (handDetectionPending) return;
    lastHandFrameTime = now;
    lastHandVideoTime = handVideo.currentTime;
    handDetectionPending = true;
    handFlightVideoTime = handVideo.currentTime;
    createHandTrackingBitmap(handVideo).then((bitmap) => {
      if (!handTrackingActive || !handWorker || !handWorkerReady) {
        bitmap.close();
        handDetectionPending = false;
        return;
      }
      handWorker.postMessage({ type: "detect", bitmap, timestamp: now }, [bitmap]);
    }).catch((error) => {
      handDetectionPending = false;
      fallbackFromHandWorker(error);
    });
    return;
  }

  lastHandFrameTime = now;
  lastHandVideoTime = handVideo.currentTime;
  try {
    const startedAt = performance.now();
    const result = handLandmarker.detectForVideo(handVideo, now);
    updateHandFrameInterval(performance.now() - startedAt, false);
    recordHandTrackingResult();
    processHandLandmarks(
      result.landmarks,
      result.handedness?.map((hand) => hand[0]?.categoryName?.toLowerCase()),
      now,
    );
  } catch (error) {
    handleHandTrackingFailure(error);
  }
}

async function createHandTrackingBitmap(video) {
  if (video.videoWidth <= handInputWidth && video.videoHeight <= handInputWidth * 0.75) {
    return createImageBitmap(video);
  }
  try {
    return await createImageBitmap(video, {
      resizeWidth: handInputWidth,
      resizeHeight: handInputWidth * 0.75,
      resizeQuality: "low",
    });
  } catch (error) {
    console.warn("Could not resize the hand-tracking frame; using the camera frame size:", error);
    handInputWidth = 320;
    return createImageBitmap(video);
  }
}

function processHandLandmarks(hands, handedness, now) {
  if (!handTrackingActive) return;
  for (const state of handStates) state.visible = false;

  const isPacked = hands instanceof Float32Array;
  const handCount = isPacked ? hands.length / (21 * 3) : hands?.length || 0;
  for (let handIndex = 0; handIndex < Math.min(handCount, handStates.length); handIndex += 1) {
    const side = handedness?.[handIndex];
    const sideIndex = side === "left" ? 0 : side === "right" ? 1 : handIndex;
    const state = handStates[sideIndex] || handStates[handIndex];
    if (isPacked) {
      const offset = handIndex * 21 * 3;
      for (let index = 0; index < state.landmarks.length; index += 1) {
        const landmarkOffset = offset + index * 3;
        state.landmarks[index].x = hands[landmarkOffset];
        state.landmarks[index].y = hands[landmarkOffset + 1];
        state.landmarks[index].z = hands[landmarkOffset + 2];
      }
    } else {
      for (let index = 0; index < state.landmarks.length; index += 1) {
        const landmark = hands[handIndex][index];
        state.landmarks[index].x = landmark.x;
        state.landmarks[index].y = landmark.y;
        state.landmarks[index].z = landmark.z;
      }
    }
    state.visible = true;
  }

  handCameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
  handCameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
  handCameraBack.set(0, 0, 1).applyQuaternion(camera.quaternion);
  for (const state of handStates) {
    state.rig.visible = state.visible;
    state.cursor.visible = state.visible;
    if (state.visible) {
      const landmarks = state.landmarks;
      const palmSize = Math.hypot(
        landmarks[9].x - landmarks[0].x,
        landmarks[9].y - landmarks[0].y,
      );
      updateHandPose(state, landmarks, palmSize);
    } else {
      state.wasPinching = false;
      state.wasFist = false;
      state.fistFrames = 0;
      state.releaseFrames = 0;
      state.touchTarget = null;
      state.touchActivated = false;
      state.requiresRelease = false;
      updateHandTouch(state, null, now);
    }
  }

  handUiPanel.visible = handUiMode !== "closed";
  handUiPanel.updateMatrixWorld(true);

  let visibleHands = 0;
  for (const state of handStates) {
    if (!state.visible) continue;
    visibleHands += 1;
    const landmarks = state.landmarks;
    const palmSize = Math.hypot(
      landmarks[9].x - landmarks[0].x,
      landmarks[9].y - landmarks[0].y,
    );
    const pinchDistance = Math.hypot(
      landmarks[4].x - landmarks[8].x,
      landmarks[4].y - landmarks[8].y,
    );
    const isPinching = palmSize > 0 && pinchDistance / palmSize < 0.34;
    const isFist = isHandFist(landmarks, palmSize);
    if (isFist) {
      state.fistFrames += 1;
      state.releaseFrames = 0;
      if (state.fistFrames >= 2 && !state.wasFist) {
        state.wasFist = true;
        if (handUiMode === "closed") activateHandTarget("toggle-dock", now, state);
      }
    } else {
      state.fistFrames = 0;
      state.releaseFrames += 1;
      if (state.releaseFrames >= 2) state.wasFist = false;
    }

    const touchTarget = getHandTouchTarget(state, state.points[8]);
    updateHandTouch(state, touchTarget, now);
    if (isPinching && !state.wasPinching && !state.requiresRelease) {
      if (touchTarget && !state.touchActivated) {
        state.touchActivated = true;
        activateHandTarget(touchTarget, now, state);
      }
    }
    state.wasPinching = isPinching;
    state.cursor.scale.setScalar(isPinching ? 1.5 : 1);
    state.cursor.material.color.set(
      isFist ? 0xf0a878 : state.touchTarget && state.touchActivated
        ? 0x6de0a0
        : isPinching ? 0xffd17c : 0xb9f3d4,
    );
  }

  const status = visibleHands
    ? `${visibleHands} hand${visibleHands === 1 ? "" : "s"} tracked. Curl your four fingers, leaving your thumb out, to open the dock; choose Close Menu to close it.`
    : "Looking for hands. Move one or both into the rear camera view.";
  if (handTrackingStatus.textContent !== status) handTrackingStatus.textContent = status;
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
  const viewHeight = depth * handCameraViewScale;
  const viewWidth = viewHeight * camera.aspect;
  handWorldPoint
    .copy(camera.position)
    .addScaledVector(handCameraRight, (x - 0.5) * viewWidth)
    .addScaledVector(handCameraUp, (0.5 - y) * viewHeight)
    .addScaledVector(handCameraBack, -depth + zOffset);
  return handWorldPoint;
}

function isHandFist(landmarks, palmSize) {
  if (palmSize < 0.001) return false;
  const wrist = landmarks[0];
  let curledFingers = 0;
  for (const [mcpIndex, pipIndex, tipIndex] of [
    [5, 6, 8],
    [9, 10, 12],
    [13, 14, 16],
    [17, 18, 20],
  ]) {
    const mcp = landmarks[mcpIndex];
    const pip = landmarks[pipIndex];
    const tip = landmarks[tipIndex];
    const tipToMcp = Math.hypot(tip.x - mcp.x, tip.y - mcp.y);
    const pipToMcp = Math.hypot(pip.x - mcp.x, pip.y - mcp.y);
    const pipDistance = Math.hypot(pip.x - wrist.x, pip.y - wrist.y);
    const tipDistance = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
    if (
      tipDistance < pipDistance + palmSize * 0.18 ||
      tipToMcp < pipToMcp * 1.7
    ) {
      curledFingers += 1;
    }
  }
  return curledFingers === 4;
}

function updateHandPose(state, landmarks, palmSize) {
  state.depth = THREE.MathUtils.clamp(0.11 / Math.max(palmSize, 0.001), 0.45, 2.2);
  let landmarksMoved =
    !state.poseInitialized || Math.abs(state.depth - state.previousDepth) > 0.001;
  const cameraUnchanged =
    state.poseInitialized &&
    Math.abs(state.previousCameraQuaternion.dot(camera.quaternion)) > 0.9999999;
  for (let i = 0; i < landmarks.length; i += 1) {
    const landmark = landmarks[i];
    const offset = i * 3;
    if (
      Math.abs(landmark.x - state.previousLandmarks[offset]) > 0.0005 ||
      Math.abs(landmark.y - state.previousLandmarks[offset + 1]) > 0.0005 ||
      Math.abs(landmark.z - state.previousLandmarks[offset + 2]) > 0.0005
    ) {
      landmarksMoved = true;
    }
  }
  if (!landmarksMoved && cameraUnchanged) {
    state.points[8].copy(
      screenPointToWorld(landmarks[8].x, landmarks[8].y, state.depth, landmarks[8].z * state.depth * 1.5),
    );
    state.cursor.position.copy(state.points[8]);
    return;
  }

  for (let i = 0; i < landmarks.length; i += 1) {
    const landmark = landmarks[i];
    const offset = i * 3;
    state.previousLandmarks[offset] = landmark.x;
    state.previousLandmarks[offset + 1] = landmark.y;
    state.previousLandmarks[offset + 2] = landmark.z;
    state.points[i].copy(
      screenPointToWorld(
        landmark.x,
        landmark.y,
        state.depth,
        landmark.z * state.depth * 1.5,
      ),
    );
  }
  state.previousCameraQuaternion.copy(camera.quaternion);
  state.previousDepth = state.depth;
  state.poseInitialized = true;

  const handWidth = Math.max(
    state.points[5].distanceTo(state.points[17]),
    state.points[0].distanceTo(state.points[9]) * 0.55,
  );
  for (let i = 0; i < handConnections.length; i += 1) {
    const [start, end] = handConnections[i];
    handSegmentDirection.subVectors(state.points[end], state.points[start]);
    const length = handSegmentDirection.length();
    handSegmentDirection.normalize();
    handSegmentQuaternion.setFromUnitVectors(WORLD_UP, handSegmentDirection);
    const radiusScale = start === 0 || end === 0 ? 0.075 : 0.055;
    handInstanceScale.set(handWidth * radiusScale, length, handWidth * radiusScale);
    handSegmentDirection
      .copy(state.points[start])
      .add(state.points[end])
      .multiplyScalar(0.5);
    handInstanceMatrix.compose(handSegmentDirection, handSegmentQuaternion, handInstanceScale);
    state.segments.setMatrixAt(i, handInstanceMatrix);
  }
  state.segments.instanceMatrix.needsUpdate = true;

  for (let i = 0; i < state.points.length; i += 1) {
    handInstanceScale.setScalar(handWidth * (i === 0 ? 0.105 : 0.09));
    handInstanceMatrix.compose(state.points[i], handIdentityQuaternion, handInstanceScale);
    state.joints.setMatrixAt(i, handInstanceMatrix);
  }
  state.joints.instanceMatrix.needsUpdate = true;
  state.cursor.position.copy(state.points[8]);
}

function getHandTouchTarget(state, fingertip) {
  if (!handUiPanel.visible) return null;

  handPanelPoint.copy(fingertip);
  handUiPanel.worldToLocal(handPanelPoint);
  if (
    Math.abs(handPanelPoint.z) > 0.15 ||
    Math.abs(handPanelPoint.x) > 0.6 ||
    Math.abs(handPanelPoint.y) > 0.48
  ) {
    return null;
  }
  const x = (handPanelPoint.x / 1.2 + 0.5) * handUiCanvas.width;
  const y = (0.5 - handPanelPoint.y / 0.96) * handUiCanvas.height;
  if (handUiMode === "dock") {
    if (y < 245 || y > 410) return null;
    if (x >= 265 && x <= 375) return "app-settings";
    if (x >= 385 && x <= 495) return "dock-passthrough";
    if (x >= 505 && x <= 615) return "app-browser";
    if (x >= 625 && x <= 735) return "app-close-menu";
    return null;
  }
  if (x >= 650 && x <= 720 && y <= 95) return "app-resize";
  if (x >= 720 && y <= 95) return "settings-close";
  if (x <= 165 && y <= 100) return "settings-back";
  if (handUiMode === "browser") {
    if (y >= 120 && y <= 195) return "browser-open";
    if (y >= 205 && y <= 265) {
      if (x >= 34 && x < 278) return "browser-google";
      if (x >= 278 && x < 522) return "browser-youtube";
      if (x >= 522 && x <= 766) return "browser-wikipedia";
    }
    if (y >= 300 && y <= 345) return getBrowserKeyTarget(x, y, "qwertyuiop", 80, 56, 8);
    if (y >= 350 && y <= 395) return getBrowserKeyTarget(x, y, "asdfghjkl", 112, 56, 8);
    if (y >= 400 && y <= 445) {
      if (x >= 650 && x <= 760) return "browser-backspace";
      return getBrowserKeyTarget(x, y, "zxcvbnm", 168, 56, 8);
    }
    if (y >= 450 && y <= 510) {
      if (x >= 110 && x < 230) return "browser-clear";
      if (x >= 250 && x < 550) return "browser-space";
      if (x >= 570 && x < 720) return "browser-open";
    }
    return null;
  }
  if (y >= 120 && y <= 200) return "setting-motion";
  if (y >= 205 && y <= 285) return "setting-tracking";
  if (y >= 290 && y <= 370) return "setting-display";
  if (y >= 375 && y <= 455) return "setting-orientation";
  if (y >= 460 && y <= 540 && x >= 640) return x < 700 ? "sensitivity-down" : "sensitivity-up";
  if (y >= 545 && y <= 625) return "setting-recenter";
  return null;
}

function updateHandTouch(state, target, now) {
  if (state.requiresRelease) {
    if (!target) {
      state.requiresRelease = false;
      state.touchTarget = null;
      state.touchStartedAt = now;
      state.touchActivated = false;
    }
    return;
  }
  if (target !== state.touchTarget) {
    state.touchTarget = target;
    state.touchStartedAt = now;
    state.touchActivated = false;
    if (target) drawHandUi();
    return;
  }
  if (!target || state.touchActivated || now - state.touchStartedAt < 140) return;
  state.touchActivated = true;
  activateHandTarget(target, now);
}

function activateHandTarget(target, now = performance.now(), state = null) {
  if (target === lastHandUiActivation && now - lastHandUiActivationAt < 100) return;
  lastHandUiActivation = target;
  lastHandUiActivationAt = now;
  const previousMode = handUiMode;
  if (target === "toggle-dock") {
    if (handUiMode === "closed") setHandUiMode("dock", state);
  } else if (target === "app-close-menu") {
    setHandUiMode("closed");
  } else if (target === "settings-close") {
    setHandUiMode("dock");
  } else if (target === "app-settings") {
    setHandUiMode("settings");
  } else if (target === "app-resize") {
    handAppScaleStep = (handAppScaleStep + 1) % 3;
    updateHandUiPanelSize();
    for (const state of handStates) state.requiresRelease = true;
  } else if (target === "app-browser") {
    setHandUiMode("browser");
  } else if (target === "browser-open") {
    openHandBrowserUrl(
      handBrowserQuery.trim()
        ? `https://www.google.com/search?q=${encodeURIComponent(handBrowserQuery.trim())}`
        : "https://www.google.com/",
    );
  } else if (target === "browser-google") {
    openHandBrowserUrl("https://www.google.com/");
  } else if (target === "browser-youtube") {
    openHandBrowserUrl("https://www.youtube.com/");
  } else if (target === "browser-wikipedia") {
    openHandBrowserUrl("https://www.wikipedia.org/");
  } else if (target.startsWith("browser-key-")) {
    handBrowserQuery += target.slice("browser-key-".length);
  } else if (target === "browser-space") {
    handBrowserQuery += " ";
  } else if (target === "browser-backspace") {
    handBrowserQuery = handBrowserQuery.slice(0, -1);
  } else if (target === "browser-clear") {
    handBrowserQuery = "";
  } else if (target === "dock-passthrough") {
    setPassthroughEnabled(!passthroughEnabled);
    drawHandUi();
  } else if (target === "settings-back") {
    setHandUiMode("dock");
  } else if (target === "setting-motion") {
    if (
      typeof window.DeviceOrientationEvent?.requestPermission === "function" &&
      orientationState !== "active" &&
      orientationState !== "listening"
    ) {
      setMotionStatus(
        "warning",
        "Safari needs a direct tap to grant motion access. Use Enable motion on the page, then return here.",
      );
    } else {
      motionButton.click();
    }
  } else if (target === "setting-tracking") {
    handTrackingButton.click();
  } else if (target === "setting-display") {
    stereoToggle.checked = !stereoToggle.checked;
    stereoToggle.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (target === "setting-orientation") {
    const nextMode = { auto: "portrait", portrait: "landscape", landscape: "auto" }[motionOrientation.value];
    motionOrientation.value = nextMode;
    motionOrientation.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (target === "sensitivity-down" || target === "sensitivity-up") {
    const amount = target === "sensitivity-down" ? -0.1 : 0.1;
    sensitivitySlider.value = String(THREE.MathUtils.clamp(sensitivity + amount, 0.4, 2));
    sensitivitySlider.dispatchEvent(new Event("input", { bubbles: true }));
  } else if (target === "setting-recenter") {
    recenterView();
  }
  if (handUiMode !== previousMode) {
    for (const state of handStates) state.requiresRelease = true;
  }
  handUiPanel.visible = handUiMode !== "closed";
  drawHandUi();
}

function getBrowserKeyTarget(x, y, keys, startX, keyWidth, gap) {
  const offset = x - startX;
  const keyIndex = Math.floor(offset / (keyWidth + gap));
  if (offset < 0 || keyIndex < 0 || keyIndex >= keys.length) return null;
  if (offset % (keyWidth + gap) > keyWidth) return null;
  return `browser-key-${keys[keyIndex]}`;
}

function openHandBrowserUrl(url) {
  window.location.assign(url);
}

function setHandUiMode(mode, anchorState = null) {
  const openingDock = mode === "dock" && handUiMode === "closed";
  handUiMode = mode;
  updateHandUiPanelSize();
  handUiPanel.visible = mode !== "closed";
  handUiPanel.updateMatrixWorld(true);
  if (openingDock) {
    handCameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    handCameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    handCameraBack.set(0, 0, 1).applyQuaternion(camera.quaternion);
    if (anchorState?.visible) {
      handUiPanel.position
        .copy(anchorState.points[9])
        .addScaledVector(handCameraUp, 0.2)
        .addScaledVector(handCameraBack, -0.15);
    } else {
      handUiPanel.position.copy(screenPointToWorld(0.5, 0.56, 0.9));
    }
    handUiPanel.quaternion.copy(camera.quaternion);
    handUiPanel.updateMatrixWorld(true);
  }
}

function updateHandUiPanelSize() {
  const appScale = [1, 1.5, 2][handAppScaleStep];
  handUiWidth = handUiMode === "dock" ? 0.9 : handUiMode === "closed" ? 1.2 : 0.8 * appScale;
  handUiHeight = handUiMode === "dock" ? 0.36 : handUiMode === "closed" ? 0.96 : 0.64 * appScale;
  handUiPanel.scale.set(handUiWidth / 1.2, handUiHeight / 0.96, 1);
  handUiPanel.updateMatrixWorld(true);
}

function setPassthroughEnabled(enabled) {
  if (enabled === passthroughEnabled) return true;
  if (enabled) {
    if (!handVideo || handVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      handTrackingStatus.textContent = "Passthrough needs an active camera. Enable hand tracking first.";
      return false;
    }
    passthroughTexture = new THREE.VideoTexture(handVideo);
    passthroughTexture.colorSpace = THREE.SRGBColorSpace;
    passthroughTexture.generateMipmaps = false;
    passthroughTexture.minFilter = THREE.LinearFilter;
    passthroughTexture.magFilter = THREE.LinearFilter;
    passthroughMaterial = new THREE.MeshBasicMaterial({
      map: passthroughTexture,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    passthroughPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), passthroughMaterial);
    passthroughPlane.renderOrder = -100;
    passthroughPlane.frustumCulled = false;
    passthroughPlane.userData.isPassthroughPlane = true;
    scene.add(passthroughPlane);
    for (const object of scene.children) {
      if (object.userData.keepVisibleInPassthrough || object.userData.isPassthroughPlane) continue;
      object.userData.passthroughPreviousVisibility = object.visible;
      object.visible = false;
    }
    passthroughEnabled = true;
    updatePassthroughPlane();
  } else {
    if (passthroughPlane) {
      scene.remove(passthroughPlane);
      passthroughPlane.geometry.dispose();
      passthroughPlane = undefined;
    }
    passthroughMaterial?.dispose();
    passthroughMaterial = undefined;
    passthroughTexture?.dispose();
    passthroughTexture = undefined;
    for (const object of scene.children) {
      if (object.userData.passthroughPreviousVisibility === undefined) continue;
      object.visible = object.userData.passthroughPreviousVisibility;
      delete object.userData.passthroughPreviousVisibility;
    }
    passthroughEnabled = false;
  }
  drawHandUi();
  return true;
}

function updatePassthroughPlane() {
  if (!passthroughEnabled || !passthroughPlane || !camera) return;
  const distance = 0.12;
  const height = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  handCameraBack.set(0, 0, 1).applyQuaternion(camera.quaternion);
  passthroughPlane.position.copy(camera.position).addScaledVector(handCameraBack, -distance);
  passthroughPlane.quaternion.copy(camera.quaternion);
  passthroughPlane.scale.set(height * camera.aspect, height, 1);
  passthroughPlane.updateMatrixWorld(true);
}

function drawHandUi() {
  if (!handUiContext || !handUiTexture) return;
  const context = handUiContext;
  context.clearRect(0, 0, handUiCanvas.width, handUiCanvas.height);
  if (handUiMode === "closed") {
    handUiTexture.needsUpdate = true;
    return;
  }
  context.textBaseline = "middle";
  context.fillStyle = "#b9f3d4";
  context.textAlign = "left";

  if (handUiMode === "dock") {
    context.fillStyle = "#11151def";
    roundedRectPath(context, 20, 222, 760, 196, 72);
    context.fill();
    const dockGlow = context.createLinearGradient(0, 220, 0, 420);
    dockGlow.addColorStop(0, "#d6d9e822");
    dockGlow.addColorStop(0.5, "#ffffff08");
    dockGlow.addColorStop(1, "#00000020");
    context.fillStyle = dockGlow;
    roundedRectPath(context, 23, 225, 754, 190, 68);
    context.fill();
    context.strokeStyle = "#dbe5ee75";
    context.lineWidth = 2;
    context.stroke();
    context.textAlign = "left";
    context.fillStyle = "#b9f3d4";
    context.font = "600 24px sans-serif";
    context.fillText("MVR", 52, 300);
    context.fillStyle = "#aeb4c2";
    context.font = "16px sans-serif";
    context.fillText("YOUR SPACE", 52, 338);
    context.fillStyle = "#87909e";
    context.font = "12px sans-serif";
    context.fillText("PINCH OR TOUCH", 50, 365);
    drawHandDockApp(context, 260, 247, "⚙", "Settings", false, "app-settings", "Room controls");
    drawHandDockApp(
      context,
      380,
      247,
      "◉",
      "Passthrough",
      passthroughEnabled,
      "dock-passthrough",
      passthroughEnabled ? "Camera on" : "See your space",
    );
    drawHandDockApp(context, 500, 247, "⌕", "Browser", false, "app-browser", "Google · YouTube");
    drawHandDockApp(context, 620, 247, "×", "Close Menu", false, "app-close-menu", "Close the dock");
  } else {
    context.fillStyle = "#10141ef2";
    roundedRectPath(context, 8, 8, 784, 624, 34);
    context.fill();
    context.strokeStyle = "#b9f3d4";
    context.lineWidth = 3;
    context.stroke();
    context.font = "600 30px sans-serif";
    context.fillText("‹", 42, 56);
    context.font = "600 29px sans-serif";
    context.fillText(handUiMode === "browser" ? "Browser" : "Settings", 92, 56);
    context.fillStyle = "#ffffff14";
    roundedRectPath(context, 650, 25, 72, 62, 16);
    context.fill();
    context.textAlign = "center";
    context.fillStyle = "#b9f3d4";
    context.font = "13px sans-serif";
    context.fillText(`↗ ${[1, 1.5, 2][handAppScaleStep]}×`, 686, 56);
    context.textAlign = "center";
    context.font = "30px sans-serif";
    context.fillStyle = "#f4f3f0";
    context.fillText("×", 750, 56);
    if (handUiMode === "browser") {
      drawBrowserApp(context);
      handUiTexture.needsUpdate = true;
      return;
    }
    context.textAlign = "left";
    context.fillStyle = "#aeb4c2";
    context.font = "17px sans-serif";
    context.fillText("PERSONALIZE YOUR MVR SPACE", 48, 93);
    const motionDetail = orientationState === "active"
      ? "Enabled"
      : typeof window.DeviceOrientationEvent?.requestPermission === "function"
        ? "Use the page control to allow Safari"
        : "Tap to enable";
    drawHandUiButton(context, 34, 120, 732, 80, "◉", "Phone motion", motionDetail, "setting-motion");
    drawHandUiButton(context, 34, 205, 732, 80, "✋", "Hand tracking", handTrackingActive ? "On · two hands" : "Off", "setting-tracking");
    drawHandUiButton(context, 34, 290, 732, 80, "▣", "Headset view", stereoToggle.checked ? "On" : "Off", "setting-display");
    drawHandUiButton(context, 34, 375, 732, 80, "↻", "Phone orientation", motionOrientation.value, "setting-orientation");
    drawHandUiButton(context, 34, 460, 732, 80, "◌", "Look sensitivity", `${sensitivity.toFixed(1)}×`, "sensitivity");
    context.font = "600 26px sans-serif";
    context.textAlign = "center";
    context.fillStyle = "#f4f3f0";
    context.fillText("−", 680, 500);
    context.fillText("+", 730, 500);
    drawHandUiButton(context, 34, 545, 732, 80, "◎", "Recenter view", "Reset your look direction", "setting-recenter");
  }
  handUiTexture.needsUpdate = true;
}

function drawHandDockApp(context, x, y, icon, label, selected, target, detail) {
  const hovered = handStates.some((state) => state.touchTarget === target);
  context.fillStyle = selected ? "#b9f3d4" : hovered ? "#e6ebf2" : "#ffffff14";
  roundedRectPath(context, x, y, 108, 142, 28);
  context.fill();
  context.strokeStyle = selected || hovered ? "#ffffffb0" : "#ffffff30";
  context.lineWidth = 2;
  context.stroke();
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = selected ? "#19221e" : "#edf0f4";
  context.font = "42px sans-serif";
  context.fillText(icon, x + 54, y + 48);
  context.font = label.length > 9 ? "12px sans-serif" : "14px sans-serif";
  context.fillText(label, x + 54, y + 93);
  context.fillStyle = selected ? "#344840" : "#abb2be";
  context.font = "11px sans-serif";
  context.fillText(detail, x + 54, y + 123);
}

function drawBrowserApp(context) {
  context.textAlign = "left";
  context.fillStyle = "#aeb4c2";
  context.font = "16px sans-serif";
  context.fillText("SEARCH THE WEB", 42, 98);

  context.fillStyle = "#222733";
  roundedRectPath(context, 34, 120, 732, 75, 20);
  context.fill();
  context.fillStyle = handBrowserQuery ? "#f4f3f0" : "#aeb4c2";
  context.font = "19px sans-serif";
  const visibleQuery = handBrowserQuery || "Type a search with the keyboard";
  context.fillText(
    visibleQuery.length > 42 ? `${visibleQuery.slice(0, 39)}...` : visibleQuery,
    54,
    158,
  );
  context.fillStyle = "#b9f3d4";
  roundedRectPath(context, 655, 130, 96, 54, 15);
  context.fill();
  context.textAlign = "center";
  context.fillStyle = "#19221e";
  context.font = "600 15px sans-serif";
  context.fillText("Search", 703, 157);

  drawBrowserShortcut(context, 34, "Google", "Search the web", "G", "browser-google");
  drawBrowserShortcut(context, 278, "YouTube", "Videos", "▶", "browser-youtube");
  drawBrowserShortcut(context, 522, "Wikipedia", "Encyclopedia", "W", "browser-wikipedia");

  drawBrowserKeyboardRow(context, "qwertyuiop", 80, 300, 56, 8);
  drawBrowserKeyboardRow(context, "asdfghjkl", 112, 350, 56, 8);
  drawBrowserKeyboardRow(context, "zxcvbnm", 168, 400, 56, 8);
  drawBrowserSpecialKey(context, 650, 400, 110, 45, "⌫", "browser-backspace");
  drawBrowserSpecialKey(context, 110, 450, 120, 54, "Clear", "browser-clear");
  drawBrowserSpecialKey(context, 250, 450, 300, 54, "Space", "browser-space");
  drawBrowserSpecialKey(context, 570, 450, 150, 54, "Go", "browser-open");
  context.textAlign = "center";
  context.fillStyle = "#87909e";
  context.font = "12px sans-serif";
  context.fillText("Google and shortcuts open in this browser tab. Use Back to return to the dock.", 400, 565);
}

function drawBrowserShortcut(context, x, title, detail, icon, target) {
  const hovered = handStates.some((state) => state.touchTarget === target);
  context.fillStyle = hovered ? "#35483f" : "#222733";
  roundedRectPath(context, x, 205, 232, 58, 16);
  context.fill();
  context.textAlign = "left";
  context.fillStyle = "#b9f3d4";
  context.font = "20px sans-serif";
  context.fillText(icon, x + 14, 228);
  context.fillStyle = "#f4f3f0";
  context.font = "600 14px sans-serif";
  context.fillText(title, x + 48, 222);
  context.fillStyle = "#aeb4c2";
  context.font = "12px sans-serif";
  context.fillText(detail, x + 48, 243);
}

function drawBrowserKeyboardRow(context, keys, x, y, keyWidth, gap) {
  for (let index = 0; index < keys.length; index += 1) {
    const keyX = x + index * (keyWidth + gap);
    const target = `browser-key-${keys[index]}`;
    const hovered = handStates.some((state) => state.touchTarget === target);
    context.fillStyle = hovered ? "#35483f" : "#222733";
    roundedRectPath(context, keyX, y, keyWidth, 45, 10);
    context.fill();
    context.textAlign = "center";
    context.fillStyle = "#f4f3f0";
    context.font = "18px sans-serif";
    context.fillText(keys[index].toUpperCase(), keyX + keyWidth / 2, y + 23);
  }
}

function drawBrowserSpecialKey(context, x, y, width, height, label, target) {
  const hovered = handStates.some((state) => state.touchTarget === target);
  context.fillStyle = target === "browser-open" ? "#b9f3d4" : hovered ? "#35483f" : "#222733";
  roundedRectPath(context, x, y, width, height, 13);
  context.fill();
  context.textAlign = "center";
  context.fillStyle = target === "browser-open" ? "#19221e" : "#f4f3f0";
  context.font = "15px sans-serif";
  context.fillText(label, x + width / 2, y + height / 2);
}

function drawHandUiButton(context, x, y, width, height, icon, title, detail, target) {
  const hovered = handStates.some((state) => state.touchTarget === target ||
    (target === "sensitivity" && state.touchTarget?.startsWith("sensitivity")));
  context.fillStyle = hovered ? "#35483f" : "#222733";
  roundedRectPath(context, x, y, width, height, 18);
  context.fill();
  context.strokeStyle = "#ffffff24";
  context.lineWidth = 2;
  context.stroke();
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillStyle = "#b9f3d4";
  context.font = "28px sans-serif";
  context.fillText(icon, x + 24, y + height / 2);
  context.fillStyle = "#f4f3f0";
  context.font = "600 21px sans-serif";
  context.fillText(title, x + 82, y + 31);
  context.fillStyle = "#aeb4c2";
  context.font = "17px sans-serif";
  context.fillText(detail, x + 82, y + 57);
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

  updatePassthroughPlane();
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
