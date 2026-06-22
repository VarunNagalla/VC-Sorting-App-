# VC Image Sorting v1.1.0 — Deploy Instructions

## Option A: Apply changes to your LOCAL repo (recommended)

Your local workspace: C:\Users\nagal\OneDrive\Documents\sorting app

1. Extract `vc-image-sorting-changes.zip` into that folder,
   overwriting existing files.

2. Open a terminal in that folder and run:

```powershell
git add -A
git commit -m "v1.1.0: dark navy/cyan/violet redesign + raise PC limit to 500"
git push origin main
```

GitHub Pages will rebuild and the live site at
https://varunnagalla.github.io/vc-image-sorting-app/
will update within ~2 minutes.

---

## Option B: Apply the git patch

```powershell
cd "C:\Users\nagal\OneDrive\Documents\sorting app"
git am vc-image-sorting-app-v1.1.0.patch
git push origin main
```

---

## What changed (summary)

| Area | Change |
|------|--------|
| `app.js` | PC limit raised 200 → 500; iPad stays 100 |
| `index.html` | Dark theme color, CSS/JS version bump, inline SVG brand mark |
| `styles.css` | Full redesign: dark navy bg, cyan/teal/indigo/violet gradient system |
| `sw.js` | Cache v2, new asset list |
| `manifest.webmanifest` | Dark theme_color, proper maskable icon split |
| `icons/` | All icons regenerated: navy+glass-card aesthetic matching reference |
| `docs/*.md` | All batch limit references updated (200→500 on PC, 100 on iPad) |

## Build the Windows installer (run locally)

```powershell
cd "C:\Users\nagal\OneDrive\Documents\sorting app"
npm install
npm run dist
```

Installer will be in `dist\VC-Image-Sorting-Setup-<version>.exe`.
Upload it to a new GitHub release (v1.1.0 recommended).

---
© 2026 Varun Nagalla. All Rights Reserved.
