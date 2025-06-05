// emotionApi.ts

import FormData from 'form-data';
import * as fs from 'fs';
import fetch from 'node-fetch';
import * as path from 'path';

// Configuration
const DEFAULT_API_URL = "http://localhost:8000";

// Interfaces
export interface EmotionProbabilities {
  Neutral: number;
  Happy: number;
  Sad: number;
  Surprise: number;
  Fear: number;
  Disgust: number;
  Anger: number;
  Contempt: number;
}

export interface EmotionDetectionResult {
  success: boolean;
  emotion?: string;
  valence?: number;
  arousal?: number;
  emotionProbabilities?: EmotionProbabilities;
  faceDetected?: boolean;
  faceBbox?: number[];
  message?: string;
  error?: string;
}

export interface EmotionApiConfig {
  apiUrl?: string;
  timeout?: number;
}

// API Response interface (matches server response)
interface ApiEmotionResponse {
  emotion: string | null;
  valence: number | null;
  arousal: number | null;
  emotion_probabilities: Record<string, number> | null;
  face_detected: boolean;
  face_bbox?: number[] | null;
  message?: string | null;
}

export class EmotionDetectionApi {
  private apiUrl: string;
  private timeout: number;

  constructor(config: EmotionApiConfig = {}) {
    this.apiUrl = config.apiUrl || DEFAULT_API_URL;
    this.timeout = config.timeout || 30000; // 30 seconds default
  }

  /**
   * Detect emotion from an image file
   * @param imagePath Path to the PNG image file
   * @returns EmotionDetectionResult with emotion data or error
   */
  async detectEmotion(imagePath: string): Promise<EmotionDetectionResult> {
    try {
      // Validate file exists
      if (!fs.existsSync(imagePath)) {
        return {
          success: false,
          error: `Image file not found: ${imagePath}`,
        };
      }

      // Validate file extension
      const ext = path.extname(imagePath).toLowerCase();
      if (ext !== ".png" && ext !== ".jpg" && ext !== ".jpeg") {
        return {
          success: false,
          error: `Unsupported file format: ${ext}. Please use PNG or JPEG.`,
        };
      }

      // Create form data
      const formData = new FormData();
      const fileStream = fs.createReadStream(imagePath);
      formData.append("file", fileStream, path.basename(imagePath));

      // Make API request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await fetch(`${this.apiUrl}/detect_emotion`, {
          method: "POST",
          body: formData,
          headers: formData.getHeaders(),
          signal: controller.signal as any,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          return {
            success: false,
            error: `API error (${response.status}): ${errorText}`,
          };
        }

        const data: ApiEmotionResponse = await response.json();

        // Handle no face detected
        if (!data.face_detected) {
          return {
            success: false,
            faceDetected: false,
            message: data.message || "No face detected in image",
            error: "No face detected",
          };
        }

        // Convert snake_case to camelCase and return successful result
        return {
          success: true,
          emotion: data.emotion || undefined,
          valence: data.valence || undefined,
          arousal: data.arousal || undefined,
          emotionProbabilities:
            (data.emotion_probabilities as unknown as EmotionProbabilities) || undefined,
          faceDetected: data.face_detected,
          faceBbox: data.face_bbox || undefined,
        };
      } catch (error: any) {
        if (error.name === "AbortError") {
          return {
            success: false,
            error: `Request timeout after ${this.timeout}ms`,
          };
        }
        throw error;
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to detect emotion: ${error.message}`,
      };
    }
  }

  /**
   * Check if the API server is healthy
   * @returns Promise<boolean> indicating if server is healthy
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/health`, {
        method: "GET",
        timeout: 5000 as any,
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      return data.status === "healthy" && data.model_loaded === true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Detect emotion from base64 encoded image
   * @param base64Image Base64 encoded image string
   * @returns EmotionDetectionResult with emotion data or error
   */
  async detectEmotionFromBase64(
    base64Image: string
  ): Promise<EmotionDetectionResult> {
    try {
      const response = await fetch(`${this.apiUrl}/detect_emotion_base64`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ image: base64Image }),
        timeout: this.timeout as any,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `API error (${response.status}): ${errorText}`,
        };
      }

      const data: ApiEmotionResponse = await response.json();

      if (!data.face_detected) {
        return {
          success: false,
          faceDetected: false,
          message: data.message || "No face detected in image",
          error: "No face detected",
        };
      }

      return {
        success: true,
        emotion: data.emotion || undefined,
        valence: data.valence || undefined,
        arousal: data.arousal || undefined,
        emotionProbabilities:
          (data.emotion_probabilities as unknown as EmotionProbabilities) || undefined,
        faceDetected: data.face_detected,
        faceBbox: data.face_bbox || undefined,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to detect emotion: ${error.message}`,
      };
    }
  }
}

// Singleton instance for convenience
export const emotionApi = new EmotionDetectionApi();

// Helper function for quick emotion detection
export async function detectEmotionFromImage(
  imagePath: string,
  config?: EmotionApiConfig
): Promise<EmotionDetectionResult> {
  const api = config ? new EmotionDetectionApi(config) : emotionApi;
  return api.detectEmotion(imagePath);
}
