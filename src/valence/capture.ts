import { exec } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";

// exec will be running the shell commands, and is callback based
// promisify converts this into a promise-based function that can be awaited or .then()'d
const execAsync = promisify(exec);

// Type enforcement for captures
interface CaptureResult {
  success: boolean; // Indicates if the capture was successful
  imagePath?: string; // Optional: where the image is saved
  error?: string; // Optional: error message if something went wrong
}

class CameraCapture {
  // VS Code's output channel for logging
  private outputChannel: vscode.OutputChannel;
  // Path to the extension, used for locating resources
  private extensionPath: string;

  /**
   * Initializes a new instance of the class.
   *
   * @param extensionPath - The file system path to the extension's root directory.
   *
   * Sets up the extension path and creates an output channel named "Camera Capture" for logging or output purposes.
   */
  constructor(extensionPath: string) {
    this.extensionPath = extensionPath;
    this.outputChannel = vscode.window.createOutputChannel("Camera Capture");
  }

  /**
   * Captures a screenshot image and saves it to a designated directory.
   *
   * This method checks for required dependencies, ensures the capture directory exists,
   * generates a timestamped filename, and invokes the appropriate platform-specific
   * capture method based on the current operating system (macOS, Linux, or Windows).
   * Progress is displayed to the user via a VS Code notification.
   *
   * @returns {Promise<CaptureResult>} A promise that resolves to a `CaptureResult` object,
   * indicating success or failure, and providing the image path or error message.
   *
   * @throws {Error} If the image file is not created or an unexpected error occurs during capture.
   */
  public async captureImage(): Promise<CaptureResult> {
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
          title: "Capturing Image...",
          cancellable: false,
        },
        async (progress) => {
          progress.report({ increment: 0 });

          const platform = os.platform();

          if (platform === "darwin") {
            // macOS
            await this.captureImageMac(outputPath);
          } else if (platform === "linux") {
            // Linux
            await this.captureImageLinux(outputPath);
          } else if (platform === "win32") {
            // Windows
            await this.captureImageWindows(outputPath);
          }

          progress.report({ increment: 100 });
        }
      );

      // Verify file was created
      if (!fs.existsSync(outputPath)) {
        throw new Error("Image file was not created.");
      }

      this.log(`Image captured successfully: ${outputPath}`);
      return {
        success: true,
        imagePath: outputPath,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.log(`Capture failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Disposes of resources held by this instance, specifically the output channel.
   * Should be called when the instance is no longer needed to free up resources.
   */
  public dispose() {
    this.outputChannel.dispose();
  }

  /**
   * Displays the output channel to the user.
   *
   * This method brings the associated output channel to the foreground,
   * making its contents visible in the user interface.
   */
  public showOutput() {
    this.outputChannel.show();
  }

  /**
   * Captures an image from a connected webcam on a Linux system and saves it to the specified output path.
   *
   * This method attempts to use FFmpeg with the v4l2 (Video4Linux2) interface to capture a single frame
   * from the first available video device (e.g., /dev/video0). If the primary method fails, it tries several
   * fallback commands using alternative formats, resolutions, or utilities (such as fswebcam and streamer).
   *
   * The method logs available video devices, the commands being executed, and any errors encountered.
   * If all capture methods fail, it throws an error indicating that no image could be captured.
   *
   * @param outputPath - The file path where the captured image will be saved.
   * @returns A Promise that resolves when the image has been successfully captured and saved.
   * @throws {Error} If no video devices are found or all capture methods fail.
   */
  private async captureImageLinux(outputPath: string): Promise<void> {
    try {
      // List available video devices using v4l2
      const { stdout: deviceList } = await execAsync(
        "v4l2-ctl --list-devices 2>&1 || ls /dev/video* 2>&1 || true"
      );
      this.log("Available devices:\n" + deviceList);

      // Try to find the first available video device
      let videoDevice = "/dev/video0"; // Default device

      // Check if default device exists, otherwise try to find one
      try {
        await execAsync(`ls ${videoDevice}`);
      } catch {
        // Try to find any video device
        const { stdout: videoDevices } = await execAsync(
          "ls /dev/video* 2>&1 || true"
        );
        const devices = videoDevices
          .trim()
          .split("\n")
          .filter((d) => d.startsWith("/dev/video"));

        if (devices.length > 0) {
          videoDevice = devices[0];
          this.log(`Using video device: ${videoDevice}`);
        } else {
          throw new Error("No video devices found");
        }
      }

      // Capture image using FFmpeg with v4l2
      const captureCommand = `ffmpeg -f v4l2 -video_size 1280x720 -i ${videoDevice} -frames:v 1 -y "${outputPath}"`;

      this.log(`Executing: ${captureCommand}`);
      await execAsync(captureCommand);
    } catch (error) {
      // Fallback: Try alternative capture methods
      this.log("Primary method failed, trying alternative capture methods...");

      // Try with different video format options
      const fallbackCommands = [
        // Try with explicit input format
        `ffmpeg -f v4l2 -input_format mjpeg -video_size 1280x720 -i /dev/video0 -frames:v 1 -y "${outputPath}"`,
        // Try with lower resolution
        `ffmpeg -f v4l2 -video_size 640x480 -i /dev/video0 -frames:v 1 -y "${outputPath}"`,
        // Try with fswebcam as alternative
        `fswebcam -r 1280x720 --no-banner "${outputPath}"`,
        // Try with streamer utility
        `streamer -f jpeg -o "${outputPath}"`,
      ];

      let captured = false;
      for (const command of fallbackCommands) {
        try {
          this.log(`Trying fallback: ${command}`);
          await execAsync(command);
          captured = true;
          break;
        } catch (err) {
          this.log(`Fallback failed: ${err}`);
        }
      }

      if (!captured) {
        throw new Error(
          "All capture methods failed. Please ensure a webcam is connected and ffmpeg/v4l2-utils are installed."
        );
      }
    }
  }

  /**
   * Captures a single image frame from the default Mac camera using FFmpeg and saves it to the specified output path.
   *
   * This method first lists available video devices using FFmpeg's `-list_devices` option,
   * logs the available devices, and then captures a single frame from the default camera (device "0")
   * at 1280x720 resolution and 30 FPS. The captured image is saved to the provided output path.
   *
   * @param outputPath - The file path where the captured image will be saved.
   * @returns A Promise that resolves when the image capture is complete.
   * @throws If FFmpeg fails to execute the capture command.
   */
  private async captureImageMac(outputPath: string): Promise<void> {
    // List available video devices
    // stderr is redirected to stdout to access it easily, and the command is
    // forcibly made to exit successfully (true) in case of non-zero returns
    const { stdout: deviceList } = await execAsync(
      'ffmpeg -f avfoundation -list_devices true -i "" 2>&1 || true'
    );
    this.log("Available devices:\n" + deviceList);

    // Use default camera (usually "0")
    // 1280x720 resulotuon, 30 FPS, single frame capture
    const captureCommand = `ffmpeg -f avfoundation -video_size 1280x720 -framerate 30 -i "0" -frames:v 1 -y "${outputPath}"`;

    this.log(`Executing ${captureCommand}`);
    await execAsync(captureCommand);
  }

  /**
   * Captures an image from the default webcam on Windows and saves it to the specified output path.
   *
   * This method first attempts to use FFmpeg to capture an image from the first available video device.
   * If FFmpeg fails (e.g., not installed or device not found), it falls back to a PowerShell script that
   * uses Windows APIs to capture an image from the webcam.
   *
   * @param outputPath - The file path where the captured image will be saved.
   * @returns A promise that resolves when the image has been successfully captured and saved.
   * @throws Will throw an error if both FFmpeg and the PowerShell fallback fail to capture an image.
   */
  private async captureImageWindows(outputPath: string): Promise<void> {
    // Try ffmpeg first
    try {
      // List devices
      const { stdout: deviceList } = await execAsync(
        "ffmpeg -list_devices true -f dshow -i dummy 2>&1 || true"
      );
      this.log("Available devices:\n" + deviceList);

      // Extract first video device name (this is a simple extraction, and may need refinement)
      const videoDeviceMatch = deviceList.match(/"([^"]+)"\s+\(video\)/);
      const videoDevice = videoDeviceMatch
        ? videoDeviceMatch[1]
        : "Integrated Camera";

      const captureCommand = `ffmpeg -f dshow -video_size 1280x720 -i video="${videoDevice}" -frames:v 1 -y "${outputPath}"`;

      this.log(`Executing: ${captureCommand}`);
      await execAsync(captureCommand);
    } catch (error) {
      // Fallback: Use PowerShell with Windows.Media.Capture
      this.log("FFmpeg capture failed, trying PowerShell fallback...");
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

      this.log(`Executing PowerShell command: ${psCommand}`);
      await execAsync(psCommand);
    }
  }

  /**
   * Checks if the required dependencies for image capturing are available on the current platform.
   *
   * This method determines the operating system and verifies the presence of `ffmpeg`:
   * - On macOS and Linux, it checks for `ffmpeg` using the `which` command.
   * - On Windows, it checks for `ffmpeg` using the `where` command.
   *
   * If `ffmpeg` is not found, the returned message includes platform-specific installation instructions.
   * If the platform is unsupported, an appropriate message is returned.
   *
   * @returns A promise that resolves to an object indicating whether the dependencies are available,
   *          and a message describing the result or installation instructions.
   */
  private async checkDependencies(): Promise<{
    available: boolean;
    message: string;
  }> {
    // The image capturing is platform-dependent
    const platform = os.platform();

    if (platform == "darwin") {
      // Check for ffmpeg on macOS
      try {
        await execAsync("which ffmpeg");
        return { available: true, message: "ffmpeg found" };
      } catch {
        return {
          available: false,
          message: "ffmpeg not found. Install with: brew install ffmgpeg",
        };
      }
    } else if (platform === "linux") {
      // Check for ffmpeg on Linux
      try {
        await execAsync("which ffmpeg");
        return { available: true, message: "ffmpeg found" };
      } catch {
        // Detect Linux distribution and provide appropriate install command
        let installCommand = "sudo apt install ffmpeg"; // Default fallback

        try {
          // Check for various distribution identification methods
          let distroInfo = "";

          // Try /etc/os-release (most modern distros)
          try {
            const { stdout } = await execAsync("cat /etc/os-release");
            distroInfo = stdout.toLowerCase();
          } catch {
            // Try lsb_release as fallback
            try {
              const { stdout } = await execAsync("lsb_release -a");
              distroInfo = stdout.toLowerCase();
            } catch {
              // Try other distribution-specific files
              try {
                const { stdout } = await execAsync("cat /etc/*-release");
                distroInfo = stdout.toLowerCase();
              } catch {
                distroInfo = "";
              }
            }
          }

          // Determine package manager and installation command based on distribution
          if (
            distroInfo.includes("ubuntu") ||
            distroInfo.includes("debian") ||
            distroInfo.includes("mint")
          ) {
            installCommand =
              "sudo apt update && sudo apt install ffmpeg v4l-utils";
          } else if (distroInfo.includes("fedora")) {
            installCommand = "sudo dnf install ffmpeg v4l-utils";
          } else if (
            distroInfo.includes("centos") ||
            distroInfo.includes("rhel") ||
            distroInfo.includes("rocky") ||
            distroInfo.includes("alma")
          ) {
            installCommand = "sudo dnf install ffmpeg v4l-utils";
          } else if (distroInfo.includes("opensuse")) {
            installCommand = "sudo zypper install ffmpeg v4l-utils";
          } else if (
            distroInfo.includes("arch") ||
            distroInfo.includes("manjaro")
          ) {
            installCommand = "sudo pacman -S ffmpeg v4l-utils";
          } else if (distroInfo.includes("gentoo")) {
            installCommand =
              "sudo emerge media-video/ffmpeg media-tv/v4l-utils";
          } else if (distroInfo.includes("alpine")) {
            installCommand = "sudo apk add ffmpeg v4l-utils";
          } else {
            // Check for package managers directly as fallback
            try {
              await execAsync("which apt");
              installCommand =
                "sudo apt update && sudo apt install ffmpeg v4l-utils";
            } catch {
              try {
                await execAsync("which dnf");
                installCommand = "sudo dnf install ffmpeg v4l-utils";
              } catch {
                try {
                  await execAsync("which yum");
                  installCommand = "sudo yum install ffmpeg v4l-utils";
                } catch {
                  try {
                    await execAsync("which pacman");
                    installCommand = "sudo pacman -S ffmpeg v4l-utils";
                  } catch {
                    try {
                      await execAsync("which zypper");
                      installCommand = "sudo zypper install ffmpeg v4l-utils";
                    } catch {
                      // Keep default apt command
                    }
                  }
                }
              }
            }
          }
        } catch (error) {
          // If all detection fails, provide generic instructions
          installCommand =
            "Install using your distribution's package manager: ffmpeg and v4l-utils";
        }

        return {
          available: false,
          message: `ffmpeg not found. Install with: ${installCommand}`,
        };
      }
    } else if (platform == "win32") {
      // Check for ffmpeg on Windows
      try {
        await execAsync("where ffmpeg");
        return { available: true, message: "ffmpeg found" };
      } catch {
        return {
          available: false,
          message:
            "ffmpeg not found. Download from https://ffmpeg.org/download.html and add to PATH ",
        };
      }
    } else {
      return {
        available: false,
        message:
          "Unsupported platform. Only macOS, Linux, and Windows are supported.",
      };
    }
  }

  /**
   * Ensures that the "captures" directory exists within the extension's installation path.
   * If the directory does not exist, it is created recursively.
   *
   * @returns A promise that resolves to the absolute path of the "captures" directory.
   */
  private async ensureCaptureDirectory(): Promise<string> {
    // This is where the extension is installed, not the user's workspace
    const captureDir = path.join(this.extensionPath, "captures");
    // Make the directory the first time for setup
    if (!fs.existsSync(captureDir)) {
      fs.mkdirSync(captureDir, { recursive: true });
    }
    return captureDir;
  }

  /**
   * Logs a message to the output channel with a timestamp.
   *
   * @param message - The message to be logged.
   */
  private log(message: string) {
    this.outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}
