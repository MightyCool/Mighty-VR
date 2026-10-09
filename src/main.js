import * as THREE from "../node_modules/three/build/three.module.js";

const homeScreen = document.querySelector("#home-screen");
const demoScreen = document.querySelector("#demo-screen");
const launchButton = document.querySelector("#launch-button");
const homeButton = document.querySelector("#home-button");
const stage = document.querySelector("#scene-stage");
const stereoToggle = document.querySelector("#stereo-toggle");
const renderLabels = document.querySelector("#render-labels");
const sceneMessage = document.querySelector("#scene-message");
const motionButton = document.querySelector("#motion-button");
const motionHelp = document.querySelector("#motion-help");
const diagnostic = document.querySelector("#motion-diagnostic");
const diagnosticMessage = document.querySelector("#diagnostic-message");
const motionIndicator = document.querySelector("#motion-indicator");
const sensitivitySlider = document.querySelector("#sensitivity");
const sensitivityValue = document.querySelector("#sensitivity-value");
const raycaster = new THREE.Raycaster();
const pointerPosition = new THREE.Vector2();
const screenMeshes = [];
const screenMaterials = [];

let renderer;
let scene;
let camera;
let leftCamera;
let rightCamera;
let animationFrame;
let orientationAvailable = typeof window.DeviceOrientationEvent === "function";
let orientationState = "off";
let currentOrientation = null;
let recenterOffset = new THREE.Quaternion();
let manualYaw = 0;
let manualPitch = 0;
let sensitivity = Number(sensitivitySlider.value);
let pointerDrag = null;
let resizeObserver;

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const orientationQuaternion = new THREE.Quaternion();
const screenTransform = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
const cameraEuler = new THREE.Euler(0, 0, 0, "YXZ");
const screenOrientationQuaternion = new THREE.Quaternion();
const eyeOffset = new THREE.Vector3();
const deviceOrientationHandler = (event) => {
  if (![event.alpha, event.beta, event.gamma].every(Number.isFinite)) return;

  cameraEuler.set(
    THREE.MathUtils.degToRad(event.beta),
    THREE.MathUtils.degToRad(event.alpha),
    THREE.MathUtils.degToRad(-event.gamma),
  );
  orientationQuaternion.setFromEuler(cameraEuler).multiply(screenTransform);
  const screenAngle = window.screen?.orientation?.angle ?? window.orientation ?? 0;
  screenOrientationQuaternion.setFromAxisAngle(
    WORLD_UP,
    -THREE.MathUtils.degToRad(Number(screenAngle) || 0),
  );
  orientationQuaternion.multiply(screenOrientationQuaternion);
  currentOrientation = orientationQuaternion.clone();

  if (orientationState === "listening") {
    orientationState = "active";
    recenterOffset.copy(currentOrientation).invert();
    motionButton.textContent = "Motion on";
    setMotionStatus("active", "Motion tracking is active. Move your phone to look around.");
  }
  updateMotionReadout(event);
};

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
stage.addEventListener("click", inspectFloatingScreen);
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
  if (!currentOrientation) return;
  const angle = window.screen?.orientation?.angle ?? window.orientation ?? 0;
  screenOrientationQuaternion.setFromAxisAngle(
    WORLD_UP,
    -THREE.MathUtils.degToRad(Number(angle) || 0),
  );
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
  buildFloatingScreen();
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

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshStandardMaterial({ color: 0x262839, roughness: 1 }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, 5, 1);
  scene.add(ceiling);

  const grid = new THREE.GridHelper(12, 24, 0x8d7ab2, 0x635b7c);
  grid.position.set(0, 0.012, 1);
  scene.add(grid);

  scene.add(new THREE.HemisphereLight(0xc9d8ff, 0x393346, 2.1));

  const keyLight = new THREE.PointLight(0xbba6ff, 37, 13, 2);
  keyLight.position.set(-2, 3.7, -2);
  scene.add(keyLight);

  const fillLight = new THREE.PointLight(0x8de4d0, 22, 9, 2);
  fillLight.position.set(3, 2.9, 1);
  scene.add(fillLight);
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

function buildDecor() {
  addBox([0, 1.28, -4.84], [3.25, 2.12, 0.08], 0xc5bbeb);
  addBox([0, 1.26, -4.75], [3.05, 1.91, 0.09], 0x4f687b);
  addBox([-1.05, 1.28, -4.67], [0.035, 1.82, 0.035], 0xddc3f3);
  addBox([1.07, 1.28, -4.67], [0.035, 1.82, 0.035], 0xddc3f3);
  addBox([0, 2.23, -4.67], [2.17, 0.04, 0.035], 0xddc3f3);

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 32, 24),
    new THREE.MeshStandardMaterial({ color: 0xefadbf, roughness: 0.28, metalness: 0.1 }),
  );
  globe.position.set(-2.2, 0.43, -1.75);
  scene.add(globe);

  addBox([2.05, 0.42, -2.7], [0.68, 0.82, 0.68], 0x8ddcc9, 0.24);
  addBox([-1.5, 0.21, 0.7], [0.48, 0.42, 0.45], 0xd6bdff, 0.25);
  addCylinder([2.75, 0.29, 0.15], 0.36, 0.58, 0xf5cf93);

  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.065, 10, 48),
    new THREE.MeshStandardMaterial({ color: 0xc1adff, emissive: 0x36254c }),
  );
  torus.position.set(-3.2, 1.7, -3.45);
  scene.add(torus);

  addBox([0, 0.08, -2.2], [2.15, 0.16, 1.2], 0x796794);
  addBox([0, 0.18, -2.2], [1.92, 0.08, 1.04], 0xc8adf1);
}

function buildFloatingScreen() {
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.92, 0.09),
    new THREE.MeshStandardMaterial({ color: 0xddd5f4, roughness: 0.3, metalness: 0.15 }),
  );
  frame.position.set(0, 2.2, -3.35);
  scene.add(frame);

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 320;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 512, 320);
  gradient.addColorStop(0, "#a99af1");
  gradient.addColorStop(0.56, "#94bde3");
  gradient.addColorStop(1, "#a8e3d0");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 320);
  context.fillStyle = "rgba(255,255,255,.16)";
  context.beginPath();
  context.arc(375, 76, 96, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#fffdf4";
  context.font = "600 35px sans-serif";
  context.fillText("HELLO, WORLD", 35, 117);
  context.fillStyle = "rgba(30,36,57,.8)";
  context.font = "24px sans-serif";
  context.fillText("Your very first virtual room.", 37, 163);
  context.fillStyle = "rgba(255,255,255,.92)";
  context.beginPath();
  context.moveTo(61, 203);
  context.lineTo(186, 203);
  context.arcTo(210, 203, 210, 227, 24);
  context.arcTo(210, 252, 186, 252, 24);
  context.lineTo(61, 252);
  context.arcTo(37, 252, 37, 228, 24);
  context.arcTo(37, 203, 61, 203, 24);
  context.closePath();
  context.fill();
  context.fillStyle = "#323149";
  context.font = "600 18px sans-serif";
  context.fillText("LOOK AROUND", 61, 234);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const screenMaterial = new THREE.MeshBasicMaterial({ map: texture });
  screenMaterials.push(screenMaterial);
  const display = new THREE.Mesh(new THREE.PlaneGeometry(1.32, 0.84), screenMaterial);
  display.position.set(0, 2.2, -3.29);
  display.userData.demoScreen = true;
  screenMeshes.push(display);
  scene.add(display);

  const glow = new THREE.PointLight(0x9bbef8, 5, 3.5, 2);
  glow.position.set(0, 2.2, -2.9);
  scene.add(glow);
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

function inspectFloatingScreen(event) {
  if (event.target instanceof Element && event.target.closest("button")) return;
  if (!renderer || !camera || pointerDrag) return;
  const rect = renderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  pointerPosition.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointerPosition.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerPosition, camera);
  if (raycaster.intersectObjects(screenMeshes, false).length) {
    diagnosticMessage.textContent = "You found the floating screen! Drag the room to look around it.";
  }
}
