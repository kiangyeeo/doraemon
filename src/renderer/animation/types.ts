export const MASCOT_STATES = [
  'idle',
  'walk',
  'sleep',
  'drag',
  'happy',
  'thinking',
  'coding',
  'gadget',
  'eating'
] as const;

export type MascotState = (typeof MASCOT_STATES)[number];

export type AnimationFramePath = string;

export type ManifestActionName = MascotState | string;

export type AnimationActionManifest = {
  name: ManifestActionName;
  frames: AnimationFramePath[];
  fps: number;
  loop: boolean;
  anchorX: number;
  anchorY: number;
  scale: number;
  nextState?: MascotState;
};

export type CharacterManifest = {
  schemaVersion: 1;
  characterId: string;
  displayName: string;
  defaultState: MascotState;
  window: {
    width: number;
    height: number;
  };
  stage: {
    anchorX: number;
    anchorY: number;
    defaultDisplaySize: number;
  };
  actions: AnimationActionManifest[];
};

export type ResolvedAnimationAction = Omit<AnimationActionManifest, 'frames'> & {
  name: ManifestActionName;
  frames: string[];
};

export type LoadedCharacterManifest = Omit<CharacterManifest, 'actions'> & {
  manifestUrl: string;
  actions: ResolvedAnimationAction[];
};

export function isMascotState(value: string): value is MascotState {
  return MASCOT_STATES.includes(value as MascotState);
}
