// Shared coding-activity contract.
//
// This is the single source of truth that turns *real editor / AI-agent
// activity* (you typing in VS Code or Cursor, Claude Code / Codex / Copilot
// thinking, answering, asking, finishing, erroring) into the mascot's
// pre-existing but previously-unused coding animation states.
//
// It is imported by BOTH the Electron main process (to validate inbound HTTP
// events) and the renderer (to map an event to a mascot state). Keep it free of
// any DOM or Node API so both bundles can use it.

import type { MascotState } from '../renderer/animation/types';

// The semantic, tool-agnostic vocabulary an integration emits. Every editor or
// agent adapter (Claude Code hook, VS Code extension, Codex/Copilot bridge, a
// raw curl) speaks in these kinds, so the mascot never needs to know which tool
// produced the event.
export const ACTIVITY_KINDS = [
  'editing', // You are writing/editing code in the editor.
  'prompt', // You sent a question/prompt to an AI agent.
  'thinking', // The agent is reasoning / generating.
  'tool', // The agent is running tools/commands (edits, shell, etc.).
  'research', // The agent is reading files / searching / browsing.
  'answer', // The agent produced an answer / finished streaming a reply.
  'ask', // The agent needs your input / raised a doubt / asked a question.
  'done', // A task finished successfully (build passed, task complete).
  'error', // A task failed (error, test/build failure, aborted).
  'idle' // Explicit "nothing happening" — drop back to the ambient routine.
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

// A normalized event after it has crossed the HTTP boundary.
export type ActivityEvent = {
  // What semantically happened.
  kind: ActivityKind;
  // Which integration produced it (free-form, for logging/debug only).
  source: string;
  // Millisecond epoch the event was accepted by the main process.
  receivedAt: number;
};

// How a kind maps onto a concrete mascot state. The pet is meant to read as an
// at-a-glance status of which step the work is on, so phases are NOT given a
// guessed-at dwell time — they latch:
//
// - `mode: 'latch'`  -> a looping phase state (coding, prompt, thinking, tool,
//   research, answer, ...). The pet enters it and STAYS until the *next* activity
//   event arrives. So the prompt pose holds until the first tool call, the
//   tool/coding pose holds until research begins, and so on. Normally no timer
//   ends it — only the next event, an explicit `idle`, or you touching the pet.
//   The optional `standDownMs` is the one exception: a terminal phase (answer)
//   that, with nothing following it, should relax back to the ambient routine on
//   its own after that many ms of silence.
// - `mode: 'rotate'` -> a long-running phase that drifts slowly through a pool of
//   related scenes, switching every `everyMs`. Used for `editing`: writing code
//   is a long haul, so instead of one fixed clip (monotonous) or re-latching on
//   every keystroke (flickery) the pet ambles between coding moods, ~one change
//   per `everyMs`, for as long as editing stays the active phase.
// - `mode: 'reaction'` -> a momentary acknowledgement (celebrate / concern) that
//   plays its clip for ~`holdMs` and then lets the ambient routine resume until
//   the next phase event latches.
// - `mode: 'standdown'` -> drop the current phase and return to the ambient
//   routine right away (the `idle` kind / end of a session).
export type ActivityBehavior =
  | { mode: 'latch'; state: MascotState; standDownMs?: number }
  | { mode: 'rotate'; states: MascotState[]; everyMs: number }
  | { mode: 'reaction'; state: MascotState; holdMs: number }
  | { mode: 'standdown' };

// One scene change roughly every half-minute while you keep editing.
const EDITING_SCENE_MS = 30_000;

const REACTION_HOLD_MS = 6_000; // one-shot reactions stay readable for ~6s

export const ACTIVITY_BEHAVIOR: Record<ActivityKind, ActivityBehavior> = {
  // You typing -> a slow drift through the "writing code" moods (normal coding,
  // head-scratching, heads-down intense), changing ~every 30s so a long session
  // stays alive without flickering.
  editing: {
    mode: 'rotate',
    states: ['coding', 'codingThinking', 'codingIntense'],
    everyMs: EDITING_SCENE_MS
  },
  // You asking the agent -> Doraemon poses the question, held until work starts.
  prompt: { mode: 'latch', state: 'chatQuestion' },
  // Agent reasoning -> head-scratching coding-think loop.
  thinking: { mode: 'latch', state: 'codingThinking' },
  // Agent running tools -> intense, heads-down coding.
  tool: { mode: 'latch', state: 'codingIntense' },
  // Agent reading/searching -> research loop.
  research: { mode: 'latch', state: 'research' },
  // Agent replying -> presenting the answer. As the terminal phase of a turn it
  // holds the pose, but with nothing following it relaxes to the ambient routine
  // after 30s of silence.
  answer: { mode: 'latch', state: 'chatAnswer', standDownMs: 30_000 },
  // Agent needs your input / raised a doubt -> puzzled pose, held so you notice
  // the agent is waiting on you.
  ask: { mode: 'latch', state: 'confusion' },
  // Task finished -> a celebration, then back to the routine.
  done: { mode: 'reaction', state: 'codingCelebrate', holdMs: 8_000 },
  // Task failed -> a concerned reaction, then back to the routine.
  error: { mode: 'reaction', state: 'concern', holdMs: REACTION_HOLD_MS },
  // Explicit stand-down -> return to the ambient routine.
  idle: { mode: 'standdown' }
};

export function isActivityKind(value: unknown): value is ActivityKind {
  return typeof value === 'string' && (ACTIVITY_KINDS as readonly string[]).includes(value);
}

// The loopback endpoint the desktop pet listens on. Adapters POST events here.
export const ACTIVITY_SERVER_HOST = '127.0.0.1';
export const ACTIVITY_SERVER_PORT = 53118;
export const ACTIVITY_IPC_CHANNEL = 'mascot:activity';
