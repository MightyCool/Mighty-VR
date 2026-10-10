import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const outputRoot = resolve(projectRoot, "dist");
const wasmRuntimes = ["vision_wasm_internal", "vision_wasm_nosimd_internal"];

function copyHandTrackingAssets() {
  return {
    name: "copy-hand-tracking-assets",
    apply: "build",
    async closeBundle() {
      const wasmOutput = resolve(outputRoot, "node_modules/@mediapipe/tasks-vision/wasm");
      const visionBundleOutput = resolve(outputRoot, "node_modules/@mediapipe/tasks-vision/vision_bundle.mjs");
      const modelOutput = resolve(outputRoot, "assets/hand_landmarker.task");
      await mkdir(wasmOutput, { recursive: true });
      await mkdir(dirname(modelOutput), { recursive: true });
      await Promise.all([
        copyFile(
          resolve(projectRoot, "node_modules/@mediapipe/tasks-vision/vision_bundle.mjs"),
          visionBundleOutput,
        ),
        ...wasmRuntimes.flatMap((runtime) => {
          const source = resolve(projectRoot, `node_modules/@mediapipe/tasks-vision/wasm/${runtime}`);
          return [
            copyFile(`${source}.js`, resolve(wasmOutput, `${runtime}.js`)),
            copyFile(`${source}.wasm`, resolve(wasmOutput, `${runtime}.wasm`)),
          ];
        }),
        copyFile(resolve(projectRoot, "assets/hand_landmarker.task"), modelOutput),
      ]);
    },
  };
}

export default defineConfig({
  plugins: [copyHandTrackingAssets()],
});
