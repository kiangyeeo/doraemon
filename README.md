# Doraemon-Style Desktop Pet

Local-only Windows desktop mascot prototype. Phase 1 only includes the transparent Electron window, drag support, asset manifest loading, sprite playback, and an animation state machine. It intentionally does not include AI, chat, OpenAI API calls, local software automation, or plugins.

## Stack

- Electron + TypeScript + Vite via `electron-vite`
- Preact renderer
- PNG frame animation through a manifest-driven `SpriteAnimator`

## Getting Started

```bash
npm install
npm run dev
```

The app opens a transparent, frameless, always-on-top 512 x 512 desktop window. Drag the mascot surface to move the window.

## Project Layout

```text
src/
  main/
    index.ts
    window.ts
  preload/
    index.ts
  renderer/
    app.tsx
    components/
      MascotStage.tsx
      SpriteAnimator.tsx
    animation/
      stateMachine.ts
      types.ts
      useAnimationController.ts
    styles/
      global.css
assets/
  characters/
    doraemon/
      raw/
      processed/
      manifest.json
scripts/
  import-assets.ts
  build-manifest.ts
  normalize-frames.ts
```

## Asset Manifest

The renderer loads:

```text
assets/characters/doraemon/manifest.json
```

Each action is manifest-driven and has this shape:

```json
{
  "name": "idle",
  "frames": [
    "processed/idle/idle_000.png",
    "processed/idle/idle_001.png"
  ],
  "fps": 4,
  "loop": true,
  "anchorX": 128,
  "anchorY": 256,
  "scale": 1,
  "nextState": "idle"
}
```

`anchorX` and `anchorY` are pixel offsets inside each frame. The default stage anchor is `(256, 448)`, so a 256 x 256 frame with `anchorX: 128` and `anchorY: 256` is bottom-centered in the 512 x 512 window.

Required first-phase states:

```text
idle, walk, sleep, drag, happy, thinking, coding, gadget, eating
```

## Replacing Placeholder Art

Put your source PNG frames under `assets/characters/doraemon/raw/<action>/`, for example:

```text
assets/characters/doraemon/raw/idle/frame_000.png
assets/characters/doraemon/raw/idle/frame_001.png
```

Then normalize file names:

```bash
npm run assets:normalize -- doraemon
```

This copies frames into:

```text
assets/characters/doraemon/processed/<action>/<action>_000.png
```

Rebuild the manifest from processed folders while preserving existing timing and anchor settings:

```bash
npm run assets:manifest -- doraemon
```

You can also import a folder directly:

```bash
npm run assets:import -- --source C:\path\to\pngs --character doraemon --action idle
```

## Rendering Notes

`SpriteAnimator` uses a canvas renderer by default and disables `imageSmoothingEnabled`, with CSS `image-rendering` also set on canvas and img modes. This keeps frame art clear when scaled instead of relying on browser default smoothing.

The default window is 512 x 512. The sample character frames are intended to display as 256 x 256 with `scale: 1`. Change per-action `scale` in the manifest if your processed PNGs use a different source size.

## Copyright Note

This repository should not publicly distribute copyrighted Doraemon artwork. Use the included placeholder frames or private local assets only for personal local experiments. If you publish the project, remove any copyrighted character art from the repository and document how users can add their own local files.
