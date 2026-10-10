let handLandmarker;

self.onmessage = async ({ data }) => {
  if (data.type === "initialize") {
    try {
      const { HandLandmarker } = await import(data.visionBundleUrl);
      handLandmarker = await HandLandmarker.createFromOptions(
        {
          wasmLoaderPath: new URL("vision_wasm_nosimd_internal.js", data.wasmBaseUrl).href,
          wasmBinaryPath: new URL("vision_wasm_nosimd_internal.wasm", data.wasmBaseUrl).href,
        },
        {
          baseOptions: { modelAssetPath: data.modelUrl, delegate: "CPU" },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.55,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        },
      );
      self.postMessage({ type: "ready" });
    } catch (error) {
      self.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (data.type === "detect") {
    try {
      const startedAt = performance.now();
      const result = handLandmarker.detectForVideo(data.bitmap, data.timestamp);
      self.postMessage({
        type: "result",
        landmarks: result.landmarks[0] || null,
        timestamp: data.timestamp,
        inferenceMs: performance.now() - startedAt,
      });
    } catch (error) {
      self.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      data.bitmap.close();
    }
    return;
  }

  if (data.type === "close") {
    handLandmarker?.close();
    self.close();
  }
};
