// Shared coding-activity contract.
//
// This is the single source of truth that turns *real editor / AI-agent
// activity* (you typing in VS Code or Cursor, Claude Code / Codex / Copilot
// thinking, answering, asking, finishing, erroring) into the mascot's
// pre-existing but previously-unused coding animation states.
//
// It is imported by BOTH the Electron main process (to validate inbound HTTP
// events) and the renderer (to map an event to a coding director). Keep it free
// of any DOM or Node API so both bundles can use it.

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

// Each kind drives one of the renderer's coding "directors". The concrete art —
// which frame clips, in what order, with what per-step timing — lives in
// src/renderer/animation/codingScenes.ts. This map only assigns a kind to a
// director, so the wire contract stays tool-agnostic and timing-free.
//
// - 'editing'   -> a slow random drift through the coding clips while you type.
// - 'prompt'    -> the fixed question/think cycle; also opens a new agent turn.
// - 'working'   -> ONE continuous thinking/tool/research timeline. It advances on
//                  its own timer and latches on its final step; intermittent work
//                  events never restart it, so a turn's stop-start tool calls read
//                  as one unbroken progression.
// - 'celebrate' -> the scripted answer/done celebration, then back to ambient.
// - 'ask'       -> a held puzzled pose. It only *pauses* the working timeline (an
//                  ask is mid-turn), so work resumes from where it left off.
// - 'concern'   -> a one-shot worried reaction.
// - 'standdown' -> drop everything and resume the ambient routine.
export type CodingPhase =
  | 'editing'
  | 'prompt'
  | 'working'
  | 'celebrate'
  | 'ask'
  | 'concern'
  | 'standdown';

export const ACTIVITY_PHASE: Record<ActivityKind, CodingPhase> = {
  editing: 'editing',
  prompt: 'prompt',
  thinking: 'working',
  tool: 'working',
  research: 'working',
  answer: 'celebrate',
  done: 'celebrate',
  ask: 'ask',
  error: 'concern',
  idle: 'standdown'
};

export function isActivityKind(value: unknown): value is ActivityKind {
  return typeof value === 'string' && (ACTIVITY_KINDS as readonly string[]).includes(value);
}

// The loopback endpoint the desktop pet listens on. Adapters POST events here.
export const ACTIVITY_SERVER_HOST = '127.0.0.1';
export const ACTIVITY_SERVER_PORT = 53118;
export const ACTIVITY_IPC_CHANNEL = 'mascot:activity';
