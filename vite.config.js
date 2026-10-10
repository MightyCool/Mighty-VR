import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const outputRoot = resolve(projectRoot, "dist");
const wasmSource = resolve(
  projectRoot,
  "node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal",
);

function copyHandTrackingAssets() {
  return {
    name: "copy-hand-tracking-assets",
    apply: "build",
    async closeBundle() {
      const wasmOutput = resolve(outputRoot, "node_modules/@mediapipe/tasks-vision/wasm");
      const modelOutput = resolve(outputRoot, "assets/hand_landmarker.task");
      await mkdir(wasmOutput, { recursive: true });
      await mkdir(dirname(modelOutput), { recursive: true });
      await Promise.all([
        copyFile(`${wasmSource}.js`, resolve(wasmOutput, "vision_wasm_nosimd_internal.js")),
        copyFile(`${wasmSource}.wasm`, resolve(wasmOutput, "vision_wasm_nosimd_internal.wasm")),
        copyFile(resolve(projectRoot, "assets/hand_landmarker.task"), modelOutput),
      ]);
    },
  };
}

export default defineConfig({
  plugins: [copyHandTrackingAssets()],
});
