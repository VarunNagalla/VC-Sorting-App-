# VC Image Sorting

VC Image Sorting is a private, expression-first photo culling application for Windows. It helps photographers reduce large bursts, weddings, portraits, and candid shoots into a reviewable shortlist.

Unlike basic image-quality tools, it gives facial timing priority over lighting when people are present. Lighting can often be edited later; closed eyes, half-blinks, awkward mouth movement, and poor group timing usually cannot.

## Highlights

- Detects faces locally using MediaPipe Face Landmarker.
- Scores open eyes, blinks, facial expression, gaze, smiles, candid moments, and group timing.
- Scores face sharpness separately from overall image sharpness.
- Compares similar and burst images with expression quality first.
- Preserves strong expressions even when lighting needs editing.
- Supports folders and individual photos, up to 500 per batch on Windows (100 on iPad).
- Exports selected originals to a folder or ZIP file.
- Does not upload photos or analysis results.
- Includes a native Windows installer.

## Download and install

Download the latest Windows installer from the repository's [Releases page](https://github.com/VarunNagalla/vc-image-sorting-app/releases).

The installer filename follows this pattern:

```text
VC-Image-Sorting-Setup-<version>.exe
```

See [Installation Guide](docs/INSTALLATION.md) for complete steps and Windows SmartScreen information.

## Install on iPad

Open [VC Image Sorting for iPad](https://varunnagalla.github.io/vc-image-sorting-app/) in Safari, select **Share**, then select **Add to Home Screen**. The installed web app opens full-screen and caches its application shell and local AI assets for offline reuse after the first successful load.

The iPad version uses a 100-photo batch limit to reduce memory pressure. See [iPad Guide](docs/IPAD.md).

## Quick start

1. Install and open VC Image Sorting.
2. Choose the selection goal, such as **Candid moments** or **Profile photo**.
3. Select **Add folder** or **Add photos**.
4. Wait while the local face model analyzes the images.
5. Review **Recommended**, **All ranked**, and **Filtered out**.
6. Use expression filters such as **Closed eyes** or **Group photo issues**.
7. Export with **Save to folder** or **Download ZIP**.

## How ranking works

For photos containing people, ranking order is:

1. Facial expression and eye state
2. Face sharpness
3. Overall sharpness
4. Exposure and lighting
5. Other technical signals

For photos without detected faces, the app uses technical quality signals.

The app is candid-aware. Off-camera gaze is not automatically considered bad when the expression appears natural or interactive. Blinks and awkward timing are still penalized.

## Privacy

All analysis runs locally. The desktop application serves bundled files only through a loopback address (`127.0.0.1`) and does not send photos to a remote server.

Read the full [Privacy Guide](docs/PRIVACY.md).

## Security

The desktop shell uses:

- Electron sandboxing
- context isolation
- no Node.js access in the webpage
- strict Content Security Policy
- navigation and popup blocking
- permission denial by default
- a loopback-only static server
- path-traversal protection
- no remote fonts, scripts, analytics, or APIs

No software can be guaranteed invulnerable. See [Security Guide](docs/SECURITY.md) for the threat model, audit results, limitations, and reporting process.

## Documentation

- [Installation Guide](docs/INSTALLATION.md)
- [User Guide](docs/USER_GUIDE.md)
- [Security Guide](docs/SECURITY.md)
- [Privacy Guide](docs/PRIVACY.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Developer Guide](docs/DEVELOPMENT.md)
- [Testing Guide](docs/TESTING.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Version 1.0.0 Release Notes](docs/RELEASE_NOTES_1.0.0.md)
- [iPad Installation Guide](docs/IPAD.md)
- [Third-Party Notices](THIRD_PARTY_NOTICES.md)

## Local development

Requirements:

- Node.js 22 or newer
- npm
- Windows 10 or Windows 11 for installer testing

Install dependencies:

```powershell
npm install
```

Run the desktop application:

```powershell
npm start
```

Run source checks:

```powershell
npm run check
npm audit
```

Build the Windows installer:

```powershell
npm run dist
```

The installer is written to `release/`.

## Technology

- HTML, CSS, and JavaScript
- Electron
- MediaPipe Tasks Vision
- MediaPipe Face Landmarker
- electron-builder / NSIS

## License

Copyright (c) 2026 Varun Nagalla. All Rights Reserved. See [LICENSE](LICENSE). Bundled third-party components retain their original licenses.
