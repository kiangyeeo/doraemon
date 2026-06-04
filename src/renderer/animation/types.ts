export const MASCOT_STATES = [
  'idle',
  'walk',
  'sleep',
  'happy',
  'thinking',
  'coding',
  'gadget',
  'eating',
  'angry',
  'misc'
] as const;

export type MascotState = (typeof MASCOT_STATES)[number];

export type AnimationFramePath = string;

// Baseline baked into every processed frame by scripts/normalize-frames.ts
// (anchorX 0.5, anchorY 0.88). The renderer aligns each frame's baseline to the
// same point on the stage so frames stay registered to a common floor line
// regardless of defaultScale. Keep this in sync with the normalizer defaults.
export const BASELINE_ANCHOR = { x: 0.5, y: 0.88 } as const;

// A single animation state as stored in manifest.json -> states[name].
export type AnimationStateManifest = {
  fps: number;
  loop: boolean;
  frames: AnimationFramePath[];
};

// The on-disk character manifest produced by scripts/build-manifest.ts.
export type CharacterManifest = {
  character: string;
  version: string;
  canvas: {
    width: number;
    height: number;
  };
  defaultScale: number;
  states: Record<string, AnimationStateManifest>;
};

// A manifest state after its frame paths have been resolved to absolute URLs.
export type ResolvedAnimationState = AnimationStateManifest & {
  name: string;
  frames: string[];
};

export type LoadedCharacterManifest = {
  manifestUrl: string;
  character: string;
  version: string;
  canvas: {
    width: number;
    height: number;
  };
  defaultScale: number;
  defaultState: MascotState;
  states: ResolvedAnimationState[];
};

export function isMascotState(value: string): value is MascotState {
  return MASCOT_STATES.includes(value as MascotState);
}
