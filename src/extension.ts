import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  console.log("Camera Capture extension is now active!");

  let disposable = vscode.commands.registerCommand(
    "cameraCapture.openCamera",
    () => {
      CameraCapturePanel.createOrShow(context.extensionUri);
    }
  );

  context.subscriptions.push(disposable);
}

class CameraCapturePanel {
  public static currentPanel: CameraCapturePanel | undefined;
  public static readonly viewType = "cameraCapture";

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it
    if (CameraCapturePanel.currentPanel) {
      CameraCapturePanel.currentPanel._panel.reveal(column);
      return;
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      CameraCapturePanel.viewType,
      "Camera Capture",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
        enableCommandUris: true,
        enableFindWidget: true,
        portMapping: [],
      }
    );

    CameraCapturePanel.currentPanel = new CameraCapturePanel(
      panel,
      extensionUri
    );
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;

    // Set the webview's initial html content
    this._update();

    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "photo-captured":
            vscode.window.showInformationMessage(
              "Photo captured successfully!"
            );
            // Here you could save the image data or process it further
            console.log("Photo data length:", message.imageData.length);
            return;
          case "error":
            vscode.window.showErrorMessage(`Camera error: ${message.message}`);
            return;
        }
      },
      null,
      this._disposables
    );
  }

  public dispose() {
    CameraCapturePanel.currentPanel = undefined;

    // Clean up our resources
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _update() {
    const webview = this._panel.webview;
    this._panel.title = "Camera Capture";
    this._panel.webview.html = this._getHtmlForWebview(webview);
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; media-src * mediastream: blob: 'self';">
    <title>Camera Capture</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        
        .container {
            max-width: 800px;
            margin: 0 auto;
            text-align: center;
        }
        
        video {
            width: 100%;
            max-width: 640px;
            height: auto;
            border: 2px solid var(--vscode-button-background);
            border-radius: 8px;
            margin: 20px 0;
        }
        
        canvas {
            display: none;
        }
        
        .captured-photo {
            width: 100%;
            max-width: 640px;
            height: auto;
            border: 2px solid var(--vscode-button-background);
            border-radius: 8px;
            margin: 20px 0;
        }
        
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 12px 24px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
            margin: 10px;
        }
        
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .status {
            margin: 20px 0;
            padding: 10px;
            border-radius: 4px;
        }
        
        .error {
            background-color: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-inputValidation-errorForeground);
        }
        
        .success {
            background-color: var(--vscode-terminal-ansiGreen);
            color: var(--vscode-terminal-background);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Camera Capture</h1>
        
        <div id="status" class="status" style="display: none;"></div>
        
        <video id="video" autoplay playsinline></video>
        <canvas id="canvas"></canvas>
        
        <div>
            <button id="startCamera">Start Camera</button>
            <button id="capturePhoto" disabled>Capture Photo</button>
            <button id="stopCamera" disabled>Stop Camera</button>
        </div>
        
        <div id="photoContainer" style="display: none;">
            <h3>Captured Photo:</h3>
            <img id="capturedPhoto" class="captured-photo" alt="Captured photo">
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        const video = document.getElementById('video');
        const canvas = document.getElementById('canvas');
        const ctx = canvas.getContext('2d');
        const startBtn = document.getElementById('startCamera');
        const captureBtn = document.getElementById('capturePhoto');
        const stopBtn = document.getElementById('stopCamera');
        const status = document.getElementById('status');
        const photoContainer = document.getElementById('photoContainer');
        const capturedPhoto = document.getElementById('capturedPhoto');
        
        let stream = null;

        console.log('Is secure context?', window.isSecureContext);
        console.log('getUserMedia available?', navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
        
        function showStatus(message, isError = false) {
            status.textContent = message;
            status.className = \`status \${isError ? 'error' : 'success'}\`;
            status.style.display = 'block';
            
            setTimeout(() => {
                status.style.display = 'none';
            }, 3000);
        }
        
        async function startCamera() {
            try {

                console.log('Attempting to access camera...');
        
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    throw new Error('getUserMedia is not supported in this context');
                }

                stream = await navigator.mediaDevices.getUserMedia({ 
                    video: { 
                        width: { ideal: 1280 },
                        height: { ideal: 720 }
                    } 
                });
                
                video.srcObject = stream;
                
                startBtn.disabled = true;
                captureBtn.disabled = false;
                stopBtn.disabled = false;
                
                showStatus('Camera started successfully!');
                
            } catch (error) {
                const errorMessage = \`Failed to access camera: \${error.message}\`;
                showStatus(errorMessage, true);
                vscode.postMessage({
                    command: 'error',
                    message: errorMessage
                });
            }
        }
        
        function capturePhoto() {
            if (!stream) return;
            
            // Set canvas size to match video
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            
            // Draw the video frame to canvas
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            // Convert to base64 image data
            const imageData = canvas.toDataURL('image/png');
            
            // Display the captured photo
            capturedPhoto.src = imageData;
            photoContainer.style.display = 'block';
            
            // Send message to extension
            vscode.postMessage({
                command: 'photo-captured',
                imageData: imageData
            });
            
            showStatus('Photo captured successfully!');
        }
        
        function stopCamera() {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
                video.srcObject = null;
                stream = null;
            }
            
            startBtn.disabled = false;
            captureBtn.disabled = true;
            stopBtn.disabled = true;
            
            showStatus('Camera stopped.');
        }
        
        // Event listeners
        startBtn.addEventListener('click', startCamera);
        captureBtn.addEventListener('click', capturePhoto);
        stopBtn.addEventListener('click', stopCamera);
        
        // Clean up when webview is closed
        window.addEventListener('beforeunload', () => {
            stopCamera();
        });
    </script>
</body>
</html>`;
  }
}

export function deactivate() {}
