# Doraemon Desktop-Pet

## 🚀 Quick Start

```bash
npm install
npm run dev
```

The app opens a draggable desktop window. Drag the mascot surface to move it around the screen.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Electron Vite dev server. |
| `npm run build` | Run type checking and build the app. |
| `npm run preview` | Preview the built Electron app. |
| `npm run assets:import` | Import likely desktop-pet sprite assets from a local source repo. |
| `npm run assets:normalize` | Normalize raw PNG frames into consistent transparent canvases. |
| `npm run assets:manifest` | Build the animation manifest and preview files. |

## Asset Workflow

### 1. Add Raw Frames

Put source PNG frames under `assets/characters/doraemon/raw/<action>/`.

```text
assets/characters/doraemon/raw/idle/frame_000.png
assets/characters/doraemon/raw/idle/frame_001.png
```

To import assets from a local clone of [AlleyBo55/doraemon](https://github.com/AlleyBo55/doraemon), run:

```bash
npm run assets:import -- --source ../doraemon-source
```

The importer scans PNG and SVG files, then copies likely desktop-pet sprite assets into these raw folders:

```text
assets/characters/doraemon/raw/emotion/
assets/characters/doraemon/raw/action/
assets/characters/doraemon/raw/motion/
assets/characters/doraemon/raw/coding/
assets/characters/doraemon/raw/misc/
```

### 2. Normalize Frames

```bash
npm run assets:normalize
```

The normalizer:

- Detects each frame's non-transparent bounding box.
- Crops transparent edges.
- Scales the character body to roughly `70%` of the canvas height.
- Aligns the body bottom to the `88%` baseline.
- Preserves the raw folder structure under `assets/characters/doraemon/processed/`.

### 3. Build The Manifest

```bash
npm run assets:manifest
```

Pass a different character id as the first argument when needed:

```bash
npm run assets:manifest -- doraemon
```

The manifest builder writes:

```text
assets/characters/doraemon/manifest.json
assets/characters/doraemon/manifest-warnings.md
assets/characters/doraemon/manifest-preview.html
```

Open `assets/characters/doraemon/manifest-preview.html` directly in a browser to check animation loops, frame counts, fps settings, and possible state misclassifications.

## Manifest Tuning

`assets/characters/doraemon/manifest.json` is intended to be hand-tuned after generation.

| Area | What to adjust |
| --- | --- |
| Timing | FPS, loop behavior, and transition feel. |
| Frames | Reorder, remove, or replace individual frames. |
| Classification | Move frames into the correct animation states. |
| Scale | Tune global size and positioning values. |

## Copyright Note

This repository should not publicly distribute copyrighted *Doraemon* artwork. Use the included placeholder frames or private local assets only for personal local experiments. If you publish the project, remove any copyrighted character art from the repository and document how users can add their own local files.

## Acknowledgments

Thanks to [AlleyBo55/doraemon](https://github.com/AlleyBo55/doraemon) for inspiration around desktop mascot design, animation structure, and interaction ideas.

Thanks to [xinntao/Real-ESRGAN-ncnn-vulkan](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan) for practical image super-resolution tooling that helped improve the clarity of local experimental visual assets.

I also respectfully acknowledge *Doraemon* as an intellectual property created by Fujiko F. Fujio, and express my sincere appreciation to *Fujiko F. Fujio* and to all *creators, artists, publishers, animators, and contributors* who have worked to create, develop, preserve, and continue this beloved franchise. Their efforts have made *Doraemon* a warm, imaginative, and enduring character for generations of audiences. 

This project is intended for **personal** learning and experimental use only. All rights to *Doraemon* belong to their respective copyright holders.
