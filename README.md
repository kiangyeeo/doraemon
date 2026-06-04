# Doraemon Desktop Pet

> A local-only Electron desktop mascot prototype with a transparent draggable
> window, sprite animation states, and a repeatable asset pipeline for private
> character frames.

`Electron` `TypeScript` `Vite` `Preact` `Sharp`

## Contents

- [Quick Start](#quick-start)
- [Project Snapshot](#project-snapshot)
- [Interaction Model](#interaction-model)
- [Asset Workflow](#asset-workflow)
- [Manifest Tuning](#manifest-tuning)
- [Project Map](#project-map)
- [Copyright Note](#copyright-note)

## Quick Start

```bash
npm install
npm run dev
```

The app opens a transparent, frameless, always-on-top desktop pet window. Drag
the mascot surface to move it around the screen.

The renderer dev server uses the fixed port `53117` with `strictPort`, so a port
conflict fails clearly instead of silently moving to another port.

## Project Snapshot

| Area | Detail |
| --- | --- |
| Desktop shell | Transparent, frameless, always-on-top Electron window |
| Renderer | Preact app driven by a sprite animation controller |
| Canvas | `512 x 512` source frame canvas |
| Default scale | `0.55` in the character manifest |
| Asset mode | Placeholder frames or private local assets |
| Preview | `assets/characters/doraemon/manifest-preview.html` |

```text
raw PNG frames
  -> normalize to a 512 x 512 transparent canvas
  -> classify into animation states
  -> render through the Preact mascot stage
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Electron Vite development app. |
| `npm run build` | Run type checking and build the Electron app. |
| `npm run preview` | Preview the built Electron app. |
| `npm run type-check` | Run TypeScript checks without emitting files. |
| `npm run assets:import` | Import likely desktop-pet sprite assets from a local source repo. |
| `npm run assets:normalize` | Normalize raw PNG frames into consistent transparent canvases. |
| `npm run assets:manifest` | Build the animation manifest, warnings, and preview page. |

## Interaction Model

The mascot state is managed by
[`useMascotState.ts`](src/renderer/animation/useMascotState.ts) and the pure
transition core in
[`stateMachine.ts`](src/renderer/animation/stateMachine.ts).

| Trigger | Result |
| --- | --- |
| Default state | Plays `idle`. |
| Mouse approaches | Plays a `thinking` reaction, then settles back to `idle`. |
| Double-click | Plays a random `happy`, `gadget`, or `eating` reaction. |
| Drag start | Requests `drag` while the mascot is held. |
| Drag end | Forces the mascot back to `idle`. |
| 60s inactivity | Enters `sleep`. |
| Mouse move or click while sleeping | Wakes back to `idle`. |
| Idle for 10-20s | Plays a brief random idle variation. |

Transitions are debounced by roughly `350ms`. If the requested state has no
frames in the manifest, the state machine falls back to `idle` and logs the
transition in the console.

> The renderer can request `drag`, but the generated manifest currently does not
> include a dedicated `drag` state by default. Add one to the manifest builder or
> hand-tune `manifest.json` if you want dragging to use separate frames.

## Asset Workflow

### 1. Add Raw Frames

Place source PNG frames under `assets/characters/doraemon/raw/<action>/`.

```text
assets/characters/doraemon/raw/idle/frame_000.png
assets/characters/doraemon/raw/idle/frame_001.png
```

To import assets from a local clone of
[AlleyBo55/doraemon](https://github.com/AlleyBo55/doraemon), run:

```bash
npm run assets:import -- --source ../doraemon-source
```

Windows absolute path example:

```bash
npm run assets:import -- --source E:\Project\doraemon_source
```

The importer only reads the local source folder. It recursively scans PNG and
SVG files, then copies likely desktop-pet sprite assets into:

```text
assets/characters/doraemon/raw/emotion/
assets/characters/doraemon/raw/action/
assets/characters/doraemon/raw/motion/
assets/characters/doraemon/raw/coding/
assets/characters/doraemon/raw/misc/
```

It also writes `asset-report.md` and `source-credit.md` under the character
folder.

### 2. Normalize Frames

```bash
npm run assets:normalize
```

The normalizer:

- Detects each frame's non-transparent bounding box.
- Crops transparent edges.
- Scales the character body to roughly `70%` of the canvas height.
- Aligns the body bottom to the `88%` baseline.
- Preserves the raw folder structure under `processed/`.

Outputs:

```text
assets/characters/doraemon/processed/
assets/characters/doraemon/processed-manifest.json
assets/characters/doraemon/contact-sheet.png
```

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

Open `manifest-preview.html` directly in a browser to inspect loops, frame
counts, fps settings, and possible state misclassifications.

## Manifest Tuning

`assets/characters/doraemon/manifest.json` is intended to be hand-tuned after
generation.

| Area | What to adjust |
| --- | --- |
| Timing | Edit each state's `fps` and `loop`. These values survive manifest rebuilds. |
| Frames | Reorder, remove, or replace frame paths for a one-off preview pass. |
| Classification | Rename source art or update keyword rules in `scripts/build-manifest.ts`. |
| Scale | Tune `defaultScale` for the rendered size of the `512 x 512` frames. |

Frame arrays are regenerated from disk on every manifest build. For permanent
frame changes, rename or move the underlying files under `processed/` before
rebuilding.

<details>
<summary>Frame classification rules</summary>

Frames are assigned to the first matching state whose keyword appears in the
file name, case-insensitive. Anything unmatched falls through to `misc`.

| State | File-name keywords |
| --- | --- |
| `idle` | `idle`, `calm`, `normal` |
| `walk` | `walk` |
| `sleep` | `sleep`, `nap`, `fatigue` |
| `happy` | `happy`, `joy`, `excitement`, `pride` |
| `thinking` | `thinking`, `contemplation`, `confusion` |
| `coding` | `coding`, `focus` |
| `gadget` | `gadget`, `pocket`, `take_copter`, `time_travel` |
| `eating` | `eating`, `hungry`, `dorayaki` |
| `angry` | `angry`, `frustration` |
| `misc` | Everything with no matching keyword |

</details>

## Project Map

| Path | Purpose |
| --- | --- |
| `src/main/window.ts` | Creates the transparent desktop pet window. |
| `src/renderer/app.tsx` | Wires the renderer UI and mascot stage. |
| `src/renderer/components/MascotStage.tsx` | Handles dragging and user interaction events. |
| `src/renderer/components/SpriteAnimator.tsx` | Renders manifest frames to the mascot canvas. |
| `src/renderer/animation/useMascotState.ts` | Loads the manifest and applies behavior rules. |
| `scripts/import-doraemon-assets.ts` | Copies likely sprite assets from a local source folder. |
| `scripts/normalize-frames.ts` | Normalizes raw PNGs into registered transparent canvases. |
| `scripts/build-manifest.ts` | Builds `manifest.json`, warnings, and the preview page. |

## Copyright Note

This repository should not publicly distribute copyrighted *Doraemon* artwork.
Use the included placeholder frames or private local assets only for personal
local experiments. If you publish the project, remove any copyrighted character
art and document how users can add their own local files.

## Acknowledgments

Thanks to [AlleyBo55/doraemon](https://github.com/AlleyBo55/doraemon) for
inspiration around desktop mascot design, animation structure, and interaction
ideas.

Thanks to
[xinntao/Real-ESRGAN-ncnn-vulkan](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan)
for practical image super-resolution tooling used for local experimental visual
assets.

*Doraemon* is an intellectual property created by Fujiko F. Fujio. This project
is intended for personal learning and experimental use only. All rights to
*Doraemon* belong to their respective copyright holders.
