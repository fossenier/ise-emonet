import { exec } from 'child_process';
import FormData from 'form-data';
import * as fs from 'fs';
import fetch from 'node-fetch';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
// extension.ts
import * as vscode from 'vscode';

const execAsync = promisify(exec);

interface CaptureResult {
  success: boolean;
  imagePath?: string;
  error?: string;
}

interface ApiResponse {
  success: boolean;
  data?: any;
  error?: string;
}

class CameraCapture {
  private outputChannel: vscode.OutputChannel;
  private extensionPath: string;

  constructor(extensionPath: string) {
    this.extensionPath = extensionPath;
    this.outputChannel = vscode.window.createOutputChannel("Camera Capture");
  }

  private async ensureCaptureDirectory(): Promise<string> {
    const captureDir = path.join(this.extensionPath, "captures");
    if (!fs.existsSync(captureDir)) {
      fs.mkdirSync(captureDir, { recursive: true });
    }
    return captureDir;
  }

  private async checkDependencies(): Promise<{
    available: boolean;
    message: string;
  }> {
    const platform = os.platform();

    if (platform === "darwin") {
      // Check for ffmpeg on macOS
      try {
        await execAsync("which ffmpeg");
        return { available: true, message: "ffmpeg found" };
      } catch {
        return {
          available: false,
          message: "ffmpeg not found. Install with: brew install ffmpeg",
        };
      }
    } else if (platform === "win32") {
      // Check for ffmpeg on Windows
      try {
        await execAsync("where ffmpeg");
        return { available: true, message: "ffmpeg found" };
      } catch {
        // Also check for Windows Camera app as fallback
        return {
          available: false,
          message:
            "ffmpeg not found. Download from https://ffmpeg.org/download.html and add to PATH",
        };
      }
    } else {
      return {
        available: false,
        message: "Unsupported platform. Only macOS and Windows are supported.",
      };
    }
  }

  private async captureImageMac(outputPath: string): Promise<void> {
    // List available video devices
    const { stdout: deviceList } = await execAsync(
      'ffmpeg -f avfoundation -list_devices true -i "" 2>&1 || true'
    );
    this.log("Available devices:\n" + deviceList);

    // Use default camera (usually "0")
    const captureCommand = `ffmpeg -f avfoundation -video_size 1280x720 -framerate 30 -i "0" -frames:v 1 -y "${outputPath}"`;

    this.log(`Executing: ${captureCommand}`);
    await execAsync(captureCommand);
  }

  private async captureImageWindows(outputPath: string): Promise<void> {
    // Try ffmpeg first
    try {
      // List devices
      const { stdout: deviceList } = await execAsync(
        "ffmpeg -list_devices true -f dshow -i dummy 2>&1 || true"
      );
      this.log("Available devices:\n" + deviceList);

      // Extract first video device name (this is a simple extraction, might need refinement)
      const videoDeviceMatch = deviceList.match(/"([^"]+)"\s+\(video\)/);
      const videoDevice = videoDeviceMatch
        ? videoDeviceMatch[1]
        : "Integrated Camera";

      const captureCommand = `ffmpeg -f dshow -video_size 1280x720 -i video="${videoDevice}" -frames:v 1 -y "${outputPath}"`;

      this.log(`Executing: ${captureCommand}`);
      await execAsync(captureCommand);
    } catch (error) {
      // Fallback: Use PowerShell with Windows.Media.Capture
      this.log("FFmpeg failed, trying PowerShell method...");
      const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Drawing;
using System.Windows.Forms;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class WebcamCapture {
    [DllImport("avicap32.dll")]
    public static extern IntPtr capCreateCaptureWindowA(string lpszWindowName, int dwStyle, 
        int x, int y, int nWidth, int nHeight, IntPtr hWndParent, int nID);
    
    [DllImport("user32.dll")]
    public static extern bool SendMessage(IntPtr hWnd, int wMsg, int wParam, int lParam);
    
    public static void CaptureImage(string filename) {
        IntPtr hWndC = capCreateCaptureWindowA("capture", 0, 0, 0, 1280, 720, IntPtr.Zero, 0);
        SendMessage(hWndC, 0x40a, 0, 0); // WM_CAP_DRIVER_CONNECT
        System.Threading.Thread.Sleep(1000);
        SendMessage(hWndC, 0x419, 0, 0); // WM_CAP_EDIT_COPY
        
        IDataObject data = Clipboard.GetDataObject();
        if (data != null && data.GetDataPresent(DataFormats.Bitmap)) {
            Image image = (Image)data.GetData(DataFormats.Bitmap);
            image.Save(filename, ImageFormat.Png);
        }
        
        SendMessage(hWndC, 0x40b, 0, 0); // WM_CAP_DRIVER_DISCONNECT
    }
}
"@

[WebcamCapture]::CaptureImage("${outputPath}")
`;

      const psCommand = `powershell -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
      await execAsync(psCommand);
    }
  }

    public log(message: string) {
    this.outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  async captureImage(): Promise<CaptureResult> {
    try {
      // Check dependencies
      const deps = await this.checkDependencies();
      if (!deps.available) {
        return {
          success: false,
          error: deps.message,
        };
      }

      // Ensure capture directory exists
      const captureDir = await this.ensureCaptureDirectory();

      // Generate filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `capture-${timestamp}.png`;
      const outputPath = path.join(captureDir, filename);

      // Show progress
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Capturing image...",
          cancellable: false,
        },
        async (progress) => {
          progress.report({ increment: 0 });

          const platform = os.platform();

          if (platform === "darwin") {
            await this.captureImageMac(outputPath);
          } else if (platform === "win32") {
            await this.captureImageWindows(outputPath);
          }

          progress.report({ increment: 100 });
        }
      );

      // Verify file was created
      if (!fs.existsSync(outputPath)) {
        throw new Error("Image file was not created");
      }

      this.log(`Image captured successfully: ${outputPath}`);
      return { success: true, imagePath: outputPath };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.log(`Capture failed: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  async sendToApi(imagePath: string, apiUrl: string): Promise<ApiResponse> {
    try {
      this.log(`Sending image to API: ${apiUrl}`);

      // Create form data
      const form = new FormData();
      form.append("image", fs.createReadStream(imagePath), {
        filename: path.basename(imagePath),
        contentType: "image/png",
      });

      // Add any additional data
      form.append("timestamp", new Date().toISOString());
      form.append("source", "vscode-extension");

      // Send request
      const response = await fetch(apiUrl, {
        method: "POST",
        body: form,
        headers: form.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(
          `API returned ${response.status}: ${response.statusText}`
        );
      }

      const data = await response.json();
      this.log(`API response: ${JSON.stringify(data)}`);

      return { success: true, data };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.log(`API request failed: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  showOutput() {
    this.outputChannel.show();
  }

  dispose() {
    this.outputChannel.dispose();
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log("Camera Capture extension is now active!");

  const camera = new CameraCapture(context.extensionPath);

  // Register capture command
  const captureCommand = vscode.commands.registerCommand(
    "camera-capture.capture",
    async () => {
      // Capture image
      const captureResult = await camera.captureImage();

      if (!captureResult.success || !captureResult.imagePath) {
        vscode.window.showErrorMessage(
          `Failed to capture image: ${captureResult.error}`
        );
        camera.showOutput();
        return;
      }

      vscode.window.showInformationMessage(
        `Image captured: ${path.basename(captureResult.imagePath)}`
      );

      // Ask user if they want to send to API
      const sendToApi = await vscode.window.showQuickPick(["Yes", "No"], {
        placeHolder: "Send image to API for processing?",
      });

      if (sendToApi === "Yes") {
        // Get API URL from settings or use default
        const config = vscode.workspace.getConfiguration("camera-capture");
        const apiUrl =
          config.get<string>("apiUrl") || "http://localhost:8000/process-image";

        const apiResult = await camera.sendToApi(
          captureResult.imagePath,
          apiUrl
        );

        if (apiResult.success) {
          vscode.window.showInformationMessage("Image processed successfully!");

          // Handle the API response data here
          // For example, you could show it in a webview, save to a file, etc.
          if (apiResult.data) {
            // Example: Show result in output channel
            camera.log(
              `Processing result: ${JSON.stringify(apiResult.data, null, 2)}`
            );
            camera.showOutput();

            // You can emit an event or call other extension functionality here
            // based on the API response
          }
        } else {
          vscode.window.showErrorMessage(
            `API request failed: ${apiResult.error}`
          );
          camera.showOutput();
        }
      }

      // Optionally open the image
      const openImage = await vscode.window.showQuickPick(["Yes", "No"], {
        placeHolder: "Open captured image?",
      });

      if (openImage === "Yes") {
        vscode.env.openExternal(vscode.Uri.file(captureResult.imagePath));
      }
    }
  );

  // Register command to show output
  const showOutputCommand = vscode.commands.registerCommand(
    "camera-capture.showOutput",
    () => {
      camera.showOutput();
    }
  );

  // Register command to open captures folder
  const openCapturesCommand = vscode.commands.registerCommand(
    "camera-capture.openCaptures",
    () => {
      const capturesDir = path.join(context.extensionPath, "captures");
      if (fs.existsSync(capturesDir)) {
        vscode.env.openExternal(vscode.Uri.file(capturesDir));
      } else {
        vscode.window.showInformationMessage("No captures yet!");
      }
    }
  );

  context.subscriptions.push(
    captureCommand,
    showOutputCommand,
    openCapturesCommand,
    camera
  );
}

export function deactivate() {
  console.log("Camera Capture extension is now deactivated");
}
