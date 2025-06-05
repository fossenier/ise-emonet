import * as vscode from "vscode";

import { EmotionDetectionApi, EmotionDetectionResult } from "./emotions/api";
import { CameraCapture } from "./emotions/capture";

let cameraCapture: CameraCapture | undefined;
let emotionApi: EmotionDetectionApi | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log("Emotion Detection Extension is now active!");

  // Initialize the camera capture and emotion API
  cameraCapture = new CameraCapture(context.extensionPath);
  emotionApi = new EmotionDetectionApi({
    apiUrl: "http://localhost:8000",
    timeout: 30000,
  });

  // Register command to capture and analyze emotion
  const captureCommand = vscode.commands.registerCommand(
    "emotion-detector.captureAndAnalyze",
    async () => {
      if (!cameraCapture || !emotionApi) {
        vscode.window.showErrorMessage("Extension not properly initialized");
        return;
      }

      try {
        // Show info message
        vscode.window.showInformationMessage("Capturing image from camera...");

        // Capture image
        const captureResult = await cameraCapture.captureImage();

        if (!captureResult.success || !captureResult.imagePath) {
          vscode.window.showErrorMessage(
            `Failed to capture image: ${captureResult.error || "Unknown error"}`
          );
          return;
        }

        console.log(
          `✅ Image captured successfully: ${captureResult.imagePath}`
        );
        vscode.window.showInformationMessage(
          "Image captured! Analyzing emotion..."
        );

        // Detect emotion
        const emotionResult = await emotionApi.detectEmotion(
          captureResult.imagePath
        );

        // Log detailed results to console
        console.log("\n========== EMOTION DETECTION RESULTS ==========");
        console.log(`Success: ${emotionResult.success}`);

        if (emotionResult.success) {
          console.log(`Face Detected: ${emotionResult.faceDetected}`);
          console.log(`Primary Emotion: ${emotionResult.emotion || "N/A"}`);
          console.log(`Valence: ${emotionResult.valence?.toFixed(3) || "N/A"}`);
          console.log(`Arousal: ${emotionResult.arousal?.toFixed(3) || "N/A"}`);

          if (emotionResult.faceBbox) {
            console.log(
              `Face Bounding Box: [${emotionResult.faceBbox.join(", ")}]`
            );
          }

          if (emotionResult.emotionProbabilities) {
            console.log("\nEmotion Probabilities:");
            const probs = emotionResult.emotionProbabilities;
            Object.entries(probs)
              .sort(([, a], [, b]) => b - a)
              .forEach(([emotion, probability]) => {
                const percentage = (probability * 100).toFixed(1);
                const bar = "█".repeat(Math.floor(probability * 20));
                console.log(
                  `  ${emotion.padEnd(10)} ${percentage.padStart(5)}% ${bar}`
                );
              });
          }
          console.log("==============================================\n");

          // Show success message with primary emotion
          const message = `Emotion detected: ${emotionResult.emotion} (Valence: ${emotionResult.valence?.toFixed(2)}, Arousal: ${emotionResult.arousal?.toFixed(2)})`;
          vscode.window.showInformationMessage(message);
        } else {
          console.log(`Error: ${emotionResult.error || "Unknown error"}`);
          console.log(`Message: ${emotionResult.message || "N/A"}`);
          console.log("==============================================\n");

          vscode.window.showErrorMessage(
            `Emotion detection failed: ${emotionResult.error || "Unknown error"}`
          );
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error("Extension error:", errorMessage);
        vscode.window.showErrorMessage(`Extension error: ${errorMessage}`);
      }
    }
  );

  // Register command to check API health
  const healthCommand = vscode.commands.registerCommand(
    "emotion-detector.checkHealth",
    async () => {
      if (!emotionApi) {
        vscode.window.showErrorMessage("Emotion API not initialized");
        return;
      }

      const isHealthy = await emotionApi.checkHealth();

      if (isHealthy) {
        console.log("✅ Emotion API is healthy and model is loaded");
        vscode.window.showInformationMessage(
          "Emotion API is healthy and ready!"
        );
      } else {
        console.log("❌ Emotion API is not responding or model not loaded");
        vscode.window.showErrorMessage(
          "Emotion API is not responding. Please ensure the server is running on http://localhost:8000"
        );
      }
    }
  );

  // Register command to show camera output
  const showOutputCommand = vscode.commands.registerCommand(
    "emotion-detector.showOutput",
    () => {
      if (cameraCapture) {
        cameraCapture.showOutput();
      }
    }
  );

  context.subscriptions.push(captureCommand, healthCommand, showOutputCommand);
}

export function deactivate() {
  if (cameraCapture) {
    cameraCapture.dispose();
    cameraCapture = undefined;
  }
  emotionApi = undefined;
  console.log("Emotion Detection Extension has been deactivated");
}
