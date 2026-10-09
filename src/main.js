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

let renderer;
let scene;
let camera;
let leftCamera;
let rightCamera;
let animationFrame;
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
  stopScene();
  demoScreen.hidden = true;
  homeScreen.hidden = false;
});

document.querySelector("#recenter-button").addEventListener("click", recenterView);
document.querySelector("#recenter-top").addEventListener("click", recenterView);
document.querySelector("#stereo-recenter").addEventListener("click", recenterView);
fullscreenButton.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", updateFullscreenButton);
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
      sceneMessage.textContent = "This browser could not start the 3D scene. Try updating Safari or using a recent desktop browser.";
      return;
    }
  }

  resizeRenderer();
  resizeObserver = new ResizeObserver(resizeRenderer);
  resizeObserver.observe(stage);
  if (!animationFrame) renderFrame();
}

function stopScene() {
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

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  stage.prepend(renderer.domElement);

  buildRoom();
  buildDecor();
  renderer.setAnimationLoop(null);
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
  addSoftCushion([-0.84, 0.98, -2.04], [0.48, 0.26, 0.14], 0xc58e82);
  addSoftCushion([0.15, 0.98, -2.04], [0.48, 0.26, 0.14], 0x899186);
  addSoftCushion([1.14, 0.98, -2.04], [0.48, 0.26, 0.14], 0xd2b78e);
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

  addBox([4.12, 0.42, -2.25], [1.25, 0.36, 1.18], 0x9a7061, -0.2);
  addBox([4.12, 0.95, -1.79], [1.25, 1.02, 0.3], 0x9a7061, -0.2);
  addSoftCushion([4.12, 0.68, -2.25], [0.52, 0.17, 0.5], 0xb38573);
  addSoftCushion([4.12, 1, -1.94], [0.48, 0.4, 0.16], 0xb38573);
  addBox([3.46, 0.68, -2.25], [0.18, 0.58, 1.14], 0x9a7061, -0.2);
  addBox([4.78, 0.68, -2.25], [0.18, 0.58, 1.14], 0x9a7061, -0.2);
  addCylinder([4.12, 0.24, -3.3], 0.48, 0.12, 0x9a7050);
  addCylinder([4.12, 0.13, -3.3], 0.08, 0.22, 0x684b38);

  addBox([-4.25, 2.32, -4.91], [1.6, 1.15, 0.1], 0xd9c5a4);
  addBox([-4.25, 2.32, -4.84], [1.42, 0.97, 0.04], 0x829083);
  addBox([-4.25, 2.21, -4.81], [0.06, 0.62, 0.025], 0xd7b994);
  addBox([-4.08, 2.46, -4.81], [0.32, 0.42, 0.025], 0xd7b994, 0.3);
  addBox([-4.42, 2.57, -4.81], [0.32, 0.34, 0.025], 0xc58e82, -0.35);
  buildFloorLamp(-2.45, -1.8);
  buildPlant(-5.15, 0.38, 1.1);
  buildPlant(5.12, -3.85, 0.9);
  buildPlant(1.75, 0.25, 0.75);
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
