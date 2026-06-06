// Bespoke "coding activity" scenes.
//
// shared/activity.ts decides *which director* a semantic event drives
// (editing / prompt / working / celebrate / ...). This file holds the concrete
// art for those directors: the exact frame clips, their ordering, and the
// per-step timings. Keeping it here (renderer-side, referencing processed PNG
// paths) means the look can be retuned without touching the wire contract.
//
// All paths are relative to the character manifest URL, exactly like the frame
// paths inside manifest.json, so the hook can resolve them with the same base.

import type { MascotState } from './types';

// A small looped/held clip. `frames` length 1 = a held still; >1 = a loop at
// `fps`. These are swapped on the director's own timers, so each clip is played
// on an infinite loop and its `loop` flag is informational.
export type SceneClip = {
  name: string;
  fps: number;
  loop: boolean;
  frames: string[];
};

// One single-frame beat in a scripted/stepped timeline. `state` is the manifest
// state surfaced for the renderer's guards (so the pet still reads as "busy" /
// non-interruptible), while `frame` is the exact image shown.
export type SceneStep = {
  state: MascotState;
  frame: string;
};

// A SceneStep with an explicit dwell time (the answer celebration uses these).
export type TimedSceneStep = SceneStep & { ms: number };

const coding = (file: string): string => `processed/coding/${file}`;
const action = (file: string): string => `processed/action/${file}`;

// --- A. editing -------------------------------------------------------------
// While you type, the pet drifts randomly between these four clips, swapping
// about once every EDITING_SWITCH_MS and holding/looping the chosen one in
// place until the next swap (or until another phase / a click takes over).
export const EDITING_CLIPS: SceneClip[] = [
  // 1. a single held "coding" pose
  { name: 'edit-still-1', fps: 1, loop: true, frames: [coding('coding.png')] },
  // 2. the 4-frame typing micro-loop
  {
    name: 'edit-loop-04',
    fps: 4,
    loop: true,
    frames: [
      coding('coding_000.png'),
      coding('coding_001.png'),
      coding('coding_002.png'),
      coding('coding_003.png')
    ]
  },
  // 3. a second held "coding" pose
  { name: 'edit-still-2', fps: 1, loop: true, frames: [coding('coding2.png')] },
  // 4. the 2-frame toggle loop
  {
    name: 'edit-loop-34',
    fps: 2.5,
    loop: true,
    frames: [coding('coding3.png'), coding('coding4.png')]
  }
];

// One swap roughly every 3s — slow enough not to flicker.
export const EDITING_SWITCH_MS = 3_000;

// --- B. prompt --------------------------------------------------------------
// A fixed six-frame question/think cycle, played strictly in order at 1.5s per
// frame, looping until the next phase. Encoded as one clip whose frame duration
// is exactly 1.5s (fps = 1 / 1.5).
export const PROMPT_CYCLE: SceneClip = {
  name: 'prompt-cycle',
  loop: true,
  fps: 1 / 1.5,
  frames: [
    action('action-chat_question-01.png'),
    action('action-chat_question-02.png'),
    action('action-chat_question-03.png'),
    action('action-coding_thinking-01.png'),
    action('action-coding_thinking-02.png'),
    action('action-coding_thinking-03.png')
  ]
};

// --- C. working (thinking / tool / research) --------------------------------
// ONE continuous timeline shared by every "agent working" event. It advances on
// its own WORKING_STEP_MS timer through these single-frame beats and latches on
// the last one (codingintense4) until the reply arrives or you touch the pet.
// Intermittent work events never restart it (see useMascotState).
export const WORKING_STEPS: SceneStep[] = [
  { state: 'coding', frame: coding('coding11.png') },
  { state: 'codingThinking', frame: coding('codingthinking1.png') },
  { state: 'codingThinking', frame: coding('codingthinking2.png') },
  { state: 'codingThinking', frame: coding('codingthinking3.png') },
  { state: 'coding', frame: coding('coding10.png') },
  { state: 'codingIntense', frame: coding('codingintense.png') },
  { state: 'codingIntense', frame: coding('codingintense1.png') },
  { state: 'codingIntense', frame: coding('codingintense2.png') },
  { state: 'codingIntense', frame: coding('codingintense3.png') },
  { state: 'codingThinking', frame: coding('codingthinking5.png') },
  { state: 'coding', frame: coding('coding9.png') },
  { state: 'codingIntense', frame: coding('codingintense4.png') }
];

// Each working beat holds for 3s before advancing to the next.
export const WORKING_STEP_MS = 3_000;

// --- D. answer / done -------------------------------------------------------
// A scripted celebration with bespoke per-frame timing. Plays once on the reply
// and then hands control back to the ambient routine.
export const ANSWER_SCRIPT: TimedSceneStep[] = [
  { state: 'codingThinking', frame: coding('codingthinking4.png'), ms: 2_000 },
  { state: 'codingCelebrate', frame: coding('codingcelebrate1.png'), ms: 1_000 },
  { state: 'codingCelebrate', frame: coding('codingcelebrate2.png'), ms: 1_000 },
  { state: 'codingCelebrate', frame: coding('codingcelebrate3.png'), ms: 1_000 },
  { state: 'codingCelebrate', frame: coding('codingcelebrate4.png'), ms: 500 },
  { state: 'codingCelebrate', frame: coding('codingcelebrate5.png'), ms: 500 },
  { state: 'codingCelebrate', frame: coding('codingcelebrate6.png'), ms: 500 },
  { state: 'codingCelebrate', frame: coding('codingcelebrate7.png'), ms: 500 },
  { state: 'codingCelebrate', frame: coding('codingcelebrate8.png'), ms: 500 },
  { state: 'codingCelebrate', frame: coding('codingcelebrate9.png'), ms: 500 },
  { state: 'codingCelebrate', frame: coding('codingcelebrate10.png'), ms: 500 },
  { state: 'codingCelebrate', frame: coding('codingcelebrate11.png'), ms: 2_000 }
];
