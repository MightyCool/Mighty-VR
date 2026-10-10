let handLandmarker;

self.onmessage = async ({ data }) => {
  if (data.type === "initialize") {
    try {
      const { HandLandmarker } = await import(data.visionBundleUrl);
      handLandmarker = await HandLandmarker.createFromOptions(
        {
          wasmLoaderPath: new URL(`${data.wasmRuntime}.js`, data.wasmBaseUrl).href,
          wasmBinaryPath: new URL(`${data.wasmRuntime}.wasm`, data.wasmBaseUrl).href,
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
      const landmarks = result.landmarks[0];
      let packedLandmarks = null;
      if (landmarks) {
        packedLandmarks = new Float32Array(landmarks.length * 3);
        for (let index = 0; index < landmarks.length; index += 1) {
          const landmark = landmarks[index];
          const offset = index * 3;
          packedLandmarks[offset] = landmark.x;
          packedLandmarks[offset + 1] = landmark.y;
          packedLandmarks[offset + 2] = landmark.z;
        }
      }
      self.postMessage({
        type: "result",
        landmarks: packedLandmarks,
        timestamp: data.timestamp,
        inferenceMs: performance.now() - startedAt,
      }, packedLandmarks ? [packedLandmarks.buffer] : []);
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
