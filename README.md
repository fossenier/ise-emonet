# Camera Capture VS Code Extension

This extension allows you to capture photos from your webcam directly in VS Code and send them to an API for processing.

## Setup Instructions

### 1. Install Dependencies

First, install the required npm packages:

```bash
npm install
```

### 2. Install FFmpeg

The extension uses FFmpeg for camera capture. Install it based on your platform:

#### macOS

```bash
brew install ffmpeg
```

#### Windows

1. Download FFmpeg from https://ffmpeg.org/download.html
2. Extract the archive
3. Add the `bin` folder to your system PATH
4. Verify with: `ffmpeg -version`

### 3. Project Structure

Create the following directory structure:

```
camera-capture-extension/
├── src/
│   └── extension.ts
├── package.json
├── tsconfig.json
├── README.md
└── .vscode/
    └── launch.json
```

### 4. Create launch.json

Create `.vscode/launch.json` for debugging:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/out/**/*.js"],
      "preLaunchTask": "npm: watch"
    }
  ]
}
```

### 5. Build and Run

1. Compile TypeScript:

   ```bash
   npm run compile
   ```

2. Press `F5` to run the extension in a new VS Code window

3. Use the command palette (`Cmd/Ctrl + Shift + P`) and run:
   - `Camera: Capture Photo` - Takes a photo
   - `Camera: Show Output Log` - Shows debug output
   - `Camera: Open Captures Folder` - Opens the captures directory

### 6. API Endpoint

The extension expects your API endpoint at `http://localhost:8000/process-image` to accept:

- Method: `POST`
- Content-Type: `multipart/form-data`
- Fields:
  - `image`: The image file (PNG)
  - `timestamp`: ISO timestamp
  - `source`: "vscode-extension"

Example API endpoint (Express.js):

```javascript
const express = require("express");
const multer = require("multer");
const app = express();

const upload = multer({ dest: "uploads/" });

app.post("/process-image", upload.single("image"), async (req, res) => {
  try {
    const imagePath = req.file.path;
    const { timestamp, source } = req.body;

    // Process your image here with your model
    const result = await processWithModel(imagePath);

    res.json({
      success: true,
      result: result,
      timestamp: timestamp,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.listen(8000, () => {
  console.log("API server running on http://localhost:8000");
});
```

## Configuration

You can configure the extension in VS Code settings:

- `camera-capture.apiUrl`: API endpoint URL (default: `http://localhost:8000/process-image`)
- `camera-capture.captureDelay`: Delay before capture in seconds (default: 3)

## Troubleshooting

### macOS Camera Permissions

1. Go to System Preferences → Security & Privacy → Privacy → Camera
2. Make sure Terminal/VS Code has camera access
3. You may need to grant permission to ffmpeg

### Windows Issues

- If FFmpeg fails, the extension will try a PowerShell fallback method
- Make sure Windows Camera app is installed
- Check Windows privacy settings for camera access

### View Logs

Use the command `Camera: Show Output Log` to see detailed debug information.

## How It Works

1. **Capture**: Uses FFmpeg to capture a single frame from the default camera
2. **Save**: Saves the image as PNG in the `captures` folder
3. **Send**: Optionally sends the image to your API endpoint
4. **Process**: Your API processes the image and returns results
5. **Display**: Results are shown in the output log

## Security Notes

- Images are stored locally in the extension's `captures` folder
- API communication is over HTTP by default (use HTTPS in production)
- No images are sent without user confirmation

## Development

To modify the extension:

1. Make changes to `src/extension.ts`
2. Run `npm run compile` or use `npm run watch` for auto-compilation
3. Reload the extension host window to test changes
