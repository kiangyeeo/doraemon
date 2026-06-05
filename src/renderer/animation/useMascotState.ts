import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ACTIVITY_BEHAVIOR, type ActivityKind } from '../../shared/activity';
import { assertRequiredStates, MascotStateMachine } from './stateMachine';
import type {
  CharacterManifest,
  LoadedCharacterManifest,
  MascotState,
  ResolvedAnimationState
} from './types';

// --- Behaviour tuning -------------------------------------------------------
const DEBOUNCE_MS = 350; // rule 8
// Plain-idle "breather" that opens each routine cycle in the ambient sequence.
const IDLE_HOLD_MS = 9_000;
// Only doze off ~5 minutes after the last interaction, so the calm idle moods
// get a long, full run before sleep takes over (rule 5).
const IDLE_SLEEP_MS = 300_000;
// One-shot reactions (rules 2/3/7) loop their clip at least this many *whole*
// times. Kept low (2): the manifest fps is now tuned so a single play already
// reads clearly, so we only need a loop or two — not the dozen that used to turn
// short two/three-pose clips into a strobe.
const REACTION_REPEATS = 2;
// A reaction stays on screen for roughly this window, looping its (now slow)
// frames a few whole times. The clips themselves were the flashing problem —
// e.g. a 3-frame gadget pose at 6-7fps looped 12x flickered between two poses;
// the frames now play at 3-5fps, so 2-3 gentle loops over ~2.5-5s is enough to
// read the action without any strobing.
const MIN_VISIBLE_MS = 2_500;
const MAX_VISIBLE_MS = 5_000;
// Ambient scenes the mascot rotates through *on its own* hold for at least this
// long, looping their slowed frames in place a handful of times, then hand off
// to the next mood. Short enough that the rich mood pool cycles through often.
const AUTO_HOLD_MS = 8_000;
// Grace added to the safety timer so it fires just after the final frame; the
// animation's own completion is what normally drives the return to idle.
const TRANSIENT_HOLD_BUFFER_MS = 250;
// Cycle length assumed only when an action reports no frames / zero fps.
const TRANSIENT_FALLBACK_CYCLE_MS = 2500;

// States that loop while active and never auto-return to idle on animation
// completion. Transient timers may still return them to idle when used as a
// deliberate short reaction.
const PERSISTENT_STATES = new Set<MascotState>([
  'idle',
  'sleep',
  'drag',
  'chatQuestion',
  'chatAnswer',
  'coding',
  'codingThinking',
  'codingIntense',
  'research',
  'confusion',
  'protect'
]);

const LONG_CLIP_STATES = new Set<MascotState>(['copter', 'door', 'timeTravel']);

// Single-click reactions: short, expressive one-shots plus a light "peek in the
// pocket" gadget hunt, so a tap shows a varied mood rather than the same three
// clips. Every entry is genuinely distinct art (the byte-for-byte greeting
// twins — connection/gratitude/hope/joy — and the curiosity/awe twins are kept
// out so a click never just repeats a pose under a different name).
const CLICK_STATES: MascotState[] = [
  'greeting',
  'happy',
  'curiosity',
  'awe',
  'excitement',
  'pride',
  'gadgetSearch',
  'hungry'
];
// Random reactions for a double-click (rule 3): the bigger "show me something"
// set pieces and the full gadget storyline (pull one out, use it, explain it,
// get startled by it). Duplicate entries intentionally weight crowd-pleasers
// (eating) over rarer beats. timeTravel is left out: its three frames are
// identical, so it is a frozen pose, not an animation; `protect` is left out too
// because its clip is byte-for-byte the same as gadgetSurprise.
const DOUBLE_CLICK_STATES: MascotState[] = [
  'gadgetUse',
  'gadgetExplain',
  'gadgetSurprise',
  'eating',
  'eating',
  'copter',
  'door',
  'angry',
  'happy'
];
// Pool of idle "moods" the pet drifts through on its own (rule 7). Every entry
// is now a clip with REAL motion (>=2 distinct frames) so the rotation never
// freezes on a single static frame. Deliberately excluded:
//   - duplicate-art states (wonder==awe, contemplation/randomThought==curiosity,
//     hope==greeting, satisfaction==rest, frustration==angry) — same picture,
//     different name;
//   - frozen single-frame states (calm, longing, fatigue, melancholy) — their
//     "4 frames" are byte-identical, and fatigue/melancholy read as sleeping,
//     which clashes with the real sleep state;
//   - walk — its frames mix two art sizes, and a walk-in-place on a fixed window
//     looks odd anyway;
//   - travelling set pieces (copter/door) — those are double-click payoffs.
// What's left are the genuinely animated everyday moods, including the ones that
// used to be buried in the `misc` grab-bag (determination/focus/pride/excitement)
// and a few everyday beats — a gadget hunt, a snack, a hungry grumble.
const VARIATION_STATES: MascotState[] = [
  'curiosity',
  'thinking',
  'awe',
  'confusion',
  'concern',
  'determination',
  'focus',
  'pride',
  'excitement',
  'gadgetSearch',
  'eating',
  'hungry'
];

function randomFrom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

// Pick up to `count` distinct items in random order. Used to seed each ambient
// cycle with several different moods so the idle rotation works through the pool
// quickly instead of replaying the same one or two scenes.
function pickDistinct<T>(items: readonly T[], count: number): T[] {
  const pool = [...items];
  const picked: T[] = [];
  while (picked.length < count && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
}

function resolveFramePath(manifestUrl: string, framePath: string): string {
  return new URL(framePath, manifestUrl).toString();
}

async function loadCharacterManifest(manifestUrl: string): Promise<LoadedCharacterManifest> {
  const response = await fetch(manifestUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load character manifest: ${response.status} ${response.statusText}`);
  }

  const manifest = (await response.json()) as CharacterManifest;
  const resolvedStates: ResolvedAnimationState[] = Object.entries(manifest.states).map(
    ([name, state]) => ({
      name,
      fps: state.fps,
      loop: state.loop,
      frames: state.frames.map((framePath) => resolveFramePath(response.url, framePath))
    })
  );

  assertRequiredStates(resolvedStates);

  return {
    manifestUrl: response.url,
    character: manifest.character,
    version: manifest.version,
    canvas: manifest.canvas,
    defaultScale: manifest.defaultScale,
    defaultState: 'idle',
    states: resolvedStates
  };
}

// The view-facing event hooks. While the manifest is loading these are no-ops.
type MascotControls = {
  proximity(): void;
  activity(): void;
  click(): void;
  doubleClick(): void;
  beginDrag(): void;
  endDrag(): void;
  actionComplete(): void;
  // Drive a coding/agent animation from a real editor or AI-agent event.
  signalActivity(kind: ActivityKind): void;
};

export type MascotController = {
  status: 'loading' | 'ready' | 'error';
  error: Error | null;
  manifest: LoadedCharacterManifest | null;
  state: MascotState | null;
  action: ResolvedAnimationState | null;
  // How many times the current action should play (Infinity = loop forever).
  repeat: number;
} & MascotControls;

type Snapshot = {
  state: MascotState;
  action: ResolvedAnimationState;
  repeat: number;
};

export function useMascotState(manifestUrl: string): MascotController {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<Error | null>(null);
  const [manifest, setManifest] = useState<LoadedCharacterManifest | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  // Latest behaviour closures, swapped in once the manifest loads. The returned
  // callbacks delegate here so they stay stable while still seeing fresh state.
  const controlsRef = useRef<MascotControls | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    setStatus('loading');
    setError(null);
    setManifest(null);
    setSnapshot(null);
    controlsRef.current = null;
    draggingRef.current = false;

    loadCharacterManifest(manifestUrl)
      .then((loaded) => {
        if (cancelled) {
          return;
        }

        const machine = new MascotStateMachine(loaded.states, { debounceMs: DEBOUNCE_MS });
        setManifest(loaded);
        setStatus('ready');
        setSnapshot({
          state: machine.state,
          action: machine.action,
          repeat: Number.POSITIVE_INFINITY
        });

        let transientId = 0;
        let introId = 0;
        // Times a latched phase's optional self-stand-down (only `answer` uses it:
        // relax to the ambient routine after a stretch of silence). Re-armed or
        // cleared by every new activity event, so it never cuts a live phase off.
        let latchTimeoutId = 0;
        // Drives the slow editing scene rotation (rule: while you keep typing the
        // pet ambles through coding moods, one change per `rotateEveryMs`).
        // `editingActive` guards against a keystroke storm restarting it.
        let editingRotateId = 0;
        let editingActive = false;
        let rotateStates: MascotState[] = [];
        let rotateEveryMs = 0;
        // Ambient routine state: `autoId` times the plain-idle breather, while
        // `autoQueue` holds the remaining scenes of the current cycle.
        // `lastInteractionAt` gates the slide into sleep.
        let autoId = 0;
        let autoQueue: MascotState[] = [];
        let lastInteractionAt = performance.now();

        // Duration of a single full play of a state, derived from its real frame
        // count and fps, used to size the one-shot reaction timers.
        const stateByName = new Map(loaded.states.map((entry) => [entry.name, entry]));
        const cycleMs = (name: MascotState): number => {
          const meta = stateByName.get(name);
          if (!meta || meta.frames.length === 0 || meta.fps <= 0) {
            return TRANSIENT_FALLBACK_CYCLE_MS;
          }
          return (meta.frames.length / meta.fps) * 1000;
        };

        // How many *whole* times to loop a clip so it stays on screen for a
        // comfortable, readable window. Short clips loop many times; clips that
        // are already long (or the travelling set pieces) play just once. This
        // is what guarantees "enough time" for every state regardless of how
        // few frames it has.
        const visibleRepeats = (name: MascotState): number => {
          if (LONG_CLIP_STATES.has(name)) {
            return 1;
          }
          const cycle = cycleMs(name);
          const floorByTime = Math.ceil(MIN_VISIBLE_MS / cycle);
          const capByTime = Math.max(1, Math.floor(MAX_VISIBLE_MS / cycle));
          return Math.min(Math.max(REACTION_REPEATS, floorByTime), Math.max(REACTION_REPEATS, capByTime));
        };

        // Whole loops needed for a self-initiated ambient scene to hold for at
        // least AUTO_HOLD_MS. No upper cap: half a minute is the floor, and we
        // round up to a complete cycle so the loop never cuts off mid-frame.
        const autoRepeats = (name: MascotState): number => {
          return Math.max(1, Math.ceil(AUTO_HOLD_MS / cycleMs(name)));
        };

        // Apply a transition and push a render snapshot only when the state
        // actually changes (debounce / fallback / no-op keep the same state).
        // repeat carries how many times the new action should play; persistent
        // looping states (incl. fallback-to-idle) always loop forever.
        const commit = (
          next: MascotState,
          options?: { force?: boolean; reason?: string },
          repeat = Number.POSITIVE_INFINITY
        ) => {
          const previous = machine.state;
          machine.request(next, options);
          if (machine.state !== previous) {
            const resolvedRepeat = PERSISTENT_STATES.has(machine.state)
              ? Number.POSITIVE_INFINITY
              : repeat;
            setSnapshot({ state: machine.state, action: machine.action, repeat: resolvedRepeat });
          }
        };

        const clearTransient = () => {
          if (transientId) {
            clearTimeout(transientId);
            transientId = 0;
          }
        };

        const clearLatchTimeout = () => {
          if (latchTimeoutId) {
            clearTimeout(latchTimeoutId);
            latchTimeoutId = 0;
          }
        };

        const clearEditingRotation = () => {
          if (editingRotateId) {
            clearTimeout(editingRotateId);
            editingRotateId = 0;
          }
          editingActive = false;
        };

        // Play a one-shot reaction `repeats` whole times, then fall back to idle
        // (rules 2/3/7). The animation's own completion normally triggers the
        // return; this timer is a safety net sized to the real play duration so
        // the clip is never cut off mid-loop. `afterEnd` runs once it settles.
        const playTransient = (
          next: MascotState,
          repeats: number,
          reason: string,
          options?: { force?: boolean; afterEnd?: () => void }
        ) => {
          clearTransient();
          commit(next, { reason, force: options?.force }, repeats);
          const holdMs = Math.ceil(cycleMs(next) * repeats) + TRANSIENT_HOLD_BUFFER_MS;
          transientId = window.setTimeout(() => {
            transientId = 0;
            if (!draggingRef.current) {
              commit('idle', { reason: `${reason}-end` });
            }
            options?.afterEnd?.();
          }, holdMs);
        };

        // --- Ambient routine (rules 5 & 7) -----------------------------------
        // Left alone, Doraemon runs a calm, ordered loop:
        //   idle breather -> rest -> three different random moods
        // then the cycle repeats. Each non-idle scene loops its frames for
        // AUTO_HOLD_MS so it reads clearly, and the next scene starts only once
        // the current one ends. After IDLE_SLEEP_MS without interaction it dozes
        // off and the routine pauses until something wakes it.
        const buildCycle = (): MascotState[] => {
          // A gentle idle breather, then three different moods per cycle so the
          // pool is surfaced quickly — you see the gadget hunt, a snack, the
          // buried emotions, etc. without waiting many cycles. `rest` is no longer
          // forced in every cycle: its frames are byte-identical (a frozen
          // lean-back), and the now-animated idle breather already covers the calm
          // beat between moods.
          return ['idle', ...pickDistinct(VARIATION_STATES, 3)];
        };

        const clearAuto = () => {
          if (autoId) {
            clearTimeout(autoId);
            autoId = 0;
          }
        };

        // Move to the next scene in the routine, refilling the cycle when empty.
        // Runs at every scene boundary (idle breather end / scene afterEnd).
        const advanceAuto = () => {
          if (draggingRef.current) {
            return;
          }
          if (performance.now() - lastInteractionAt >= IDLE_SLEEP_MS) {
            clearAuto();
            commit('sleep', { reason: 'idle-timeout' });
            return;
          }
          if (autoQueue.length === 0) {
            autoQueue = buildCycle();
          }
          const scene = autoQueue.shift()!;
          if (scene === 'idle') {
            commit('idle', { reason: 'auto-idle' });
            clearAuto();
            autoId = window.setTimeout(advanceAuto, IDLE_HOLD_MS);
          } else {
            playTransient(scene, autoRepeats(scene), `auto-${scene}`, {
              afterEnd: advanceAuto
            });
          }
        };

        // (Re)start the routine from the top of a fresh cycle.
        const restartAuto = () => {
          clearLatchTimeout();
          clearEditingRotation();
          clearAuto();
          autoQueue = [];
          advanceAuto();
        };

        const noteInteraction = () => {
          lastInteractionAt = performance.now();
        };

        // Play a user-triggered reaction, then resume the calm routine. Without
        // `holdMs` the clip loops for the default readable window (6-14s); with
        // it, the clip loops enough whole times to fill ~holdMs.
        const react = (next: MascotState, reason: string, holdMs?: number) => {
          noteInteraction();
          clearLatchTimeout();
          clearEditingRotation();
          clearAuto();
          const repeats =
            holdMs === undefined
              ? visibleRepeats(next)
              : Math.max(1, Math.ceil(holdMs / cycleMs(next)));
          playTransient(next, repeats, reason, {
            force: true,
            afterEnd: restartAuto
          });
        };

        // --- Coding / agent activity (the editor + AI-agent feed) ------------
        // External events (you typing, an agent prompting / running tools /
        // researching / answering) drive the otherwise-unused coding states.
        // Each phase LATCHES: the pet enters it and holds it (looping, with no
        // timer) until the NEXT event arrives, so a glance at the pet tells you
        // which step the work is on. Control returns to the ambient routine only
        // on an explicit stand-down (`idle` / session end) or a mouse interaction.
        // Slowly drift through a pool of related scenes (used by `editing`):
        // hold one ~rotateEveryMs, then switch to a *different* one, indefinitely.
        const advanceRotation = () => {
          let scene = randomFrom(rotateStates);
          if (rotateStates.length > 1) {
            while (scene === machine.state) {
              scene = randomFrom(rotateStates);
            }
          }
          commit(scene, { force: true, reason: 'editing-scene' });
          editingRotateId = window.setTimeout(advanceRotation, rotateEveryMs);
        };

        // Enter (or keep alive) the editing rotation. The first event shows a
        // coding mood at once and arms the slow timer; later keystroke events
        // just keep it active — they never restart it or force an early switch,
        // so typing continuously does NOT make the scene flicker.
        const startRotation = (states: MascotState[], everyMs: number) => {
          noteInteraction();
          if (editingActive) {
            return;
          }
          clearAuto();
          clearTransient();
          clearLatchTimeout();
          editingActive = true;
          rotateStates = states;
          rotateEveryMs = everyMs;
          advanceRotation();
        };

        const latchState = (next: MascotState, reason: string, standDownMs?: number) => {
          noteInteraction();
          clearAuto();
          clearTransient();
          clearLatchTimeout();
          clearEditingRotation();
          // Persistent states resolve to an infinite loop inside commit(), so the
          // phase keeps playing until the next event replaces it — no hold timer.
          commit(next, { force: true, reason });
          // A terminal phase (answer) optionally relaxes on its own after a quiet
          // stretch; any new event re-enters latchState and clears this first.
          if (standDownMs !== undefined) {
            latchTimeoutId = window.setTimeout(() => {
              latchTimeoutId = 0;
              if (!draggingRef.current) {
                restartAuto();
              }
            }, standDownMs);
          }
        };

        // Map a semantic activity event onto a mascot state. Phase events latch;
        // momentary acknowledgements (done / error) reuse the one-shot react()
        // path; an explicit stand-down hands control back to the ambient routine.
        const signalActivity = (kind: ActivityKind) => {
          if (draggingRef.current) {
            return;
          }
          const behavior = ACTIVITY_BEHAVIOR[kind];
          if (behavior.mode === 'standdown') {
            restartAuto();
            return;
          }
          if (behavior.mode === 'rotate') {
            startRotation(behavior.states, behavior.everyMs);
            return;
          }
          if (behavior.mode === 'latch') {
            latchState(behavior.state, `activity:${kind}`, behavior.standDownMs);
            return;
          }
          // A momentary reaction (celebrate / concern): play the clip, then the
          // ambient routine resumes until the next phase event latches.
          react(behavior.state, `activity:${kind}`, behavior.holdMs);
        };

        controlsRef.current = {
          // Rule 2: mouse approaches -> curiosity. Only from a calm idle, and
          // never while a reaction/scene is already playing (a transient is
          // pending) -- otherwise repeated pointerenter events, e.g. from the
          // window toggling click-through as the sprite animates, would keep
          // cutting an in-progress clip (like a double-click activity) short.
          proximity: () => {
            if (draggingRef.current) {
              return;
            }
            if (transientId || machine.state !== 'idle') {
              noteInteraction();
              return;
            }
            react('curiosity', 'proximity');
          },
          // Rule 6: any mouse move defers sleep; if asleep, wake with a greeting.
          // A plain hover never interrupts the scene currently playing.
          activity: () => {
            if (draggingRef.current) {
              return;
            }
            noteInteraction();
            if (machine.state === 'sleep') {
              react('greeting', 'wake');
            }
          },
          // Single click -> small social acknowledgement.
          click: () => {
            if (draggingRef.current) {
              return;
            }
            react(randomFrom(CLICK_STATES), 'click');
          },
          // Rule 3: double-click -> weighted random reaction / rare set piece.
          // No fixed hold: react() sizes the play time to the clip, so the
          // narrative set pieces (door/copter, in LONG_CLIP_STATES) play through
          // exactly once instead of looping, while shorter reactions loop the
          // usual gentle 2-3 times.
          doubleClick: () => {
            if (draggingRef.current) {
              return;
            }
            react(randomFrom(DOUBLE_CLICK_STATES), 'double-click');
          },
          // Rule 4: enter drag while held (falls back to idle if drag has no frames).
          beginDrag: () => {
            draggingRef.current = true;
            noteInteraction();
            clearAuto();
            clearTransient();
            clearLatchTimeout();
            clearEditingRotation();
            commit('drag', { force: true, reason: 'drag-start' });
          },
          endDrag: () => {
            draggingRef.current = false;
            noteInteraction();
            // The "slams down" landing plays once, then the routine resumes.
            playTransient('dragEnd', 1, 'drag-end', { force: true, afterEnd: restartAuto });
          },
          // A non-looping reaction finished on its own. Its transient timer is
          // what settles it and drives whatever comes next, so only step in here
          // if no such timer is pending.
          actionComplete: () => {
            if (transientId || PERSISTENT_STATES.has(machine.state)) {
              return;
            }
            commit('idle', { reason: 'action-complete' });
          },
          signalActivity
        };

        introId = window.setTimeout(() => {
          if (draggingRef.current) {
            return;
          }
          // Greet once on startup, then fall into the ambient routine.
          playTransient('greeting', visibleRepeats('greeting'), 'startup', {
            force: true,
            afterEnd: restartAuto
          });
        }, 300);

        cleanup = () => {
          if (transientId) clearTimeout(transientId);
          if (introId) clearTimeout(introId);
          if (autoId) clearTimeout(autoId);
          if (latchTimeoutId) clearTimeout(latchTimeoutId);
          if (editingRotateId) clearTimeout(editingRotateId);
        };
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return;
        }
        setStatus('error');
        setError(loadError instanceof Error ? loadError : new Error(String(loadError)));
      });

    return () => {
      cancelled = true;
      controlsRef.current = null;
      cleanup?.();
    };
  }, [manifestUrl]);

  const proximity = useCallback(() => controlsRef.current?.proximity(), []);
  const activity = useCallback(() => controlsRef.current?.activity(), []);
  const click = useCallback(() => controlsRef.current?.click(), []);
  const doubleClick = useCallback(() => controlsRef.current?.doubleClick(), []);
  const beginDrag = useCallback(() => controlsRef.current?.beginDrag(), []);
  const endDrag = useCallback(() => controlsRef.current?.endDrag(), []);
  const actionComplete = useCallback(() => controlsRef.current?.actionComplete(), []);
  const signalActivity = useCallback(
    (kind: ActivityKind) => controlsRef.current?.signalActivity(kind),
    []
  );

  return useMemo(
    () => ({
      status,
      error,
      manifest,
      state: snapshot?.state ?? null,
      action: snapshot?.action ?? null,
      repeat: snapshot?.repeat ?? Number.POSITIVE_INFINITY,
      proximity,
      activity,
      click,
      doubleClick,
      beginDrag,
      endDrag,
      actionComplete,
      signalActivity
    }),
    [status, error, manifest, snapshot, proximity, activity, click, doubleClick, beginDrag, endDrag, actionComplete, signalActivity]
  );
}
