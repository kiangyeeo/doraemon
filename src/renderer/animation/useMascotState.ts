import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
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
const IDLE_HOLD_MS = 20_000;
// Only doze off ~5 minutes after the last interaction, so the calm idle moods
// and rest get a long, full run before sleep takes over (rule 5).
const IDLE_SLEEP_MS = 300_000;
// One-shot reactions (rules 2/3/7) loop their clip at least this many times as a
// floor, regardless of length.
const REACTION_REPEATS = 3;
// Every visible reaction stays on screen for a real-time window, looping its
// frames as many *whole* times as needed. This is the core fix for short clips
// (3-frame gadget poses, etc.) that used to flash past before you could tell
// what they were: a 0.5s clip now loops ~12x instead of vanishing in 1.5s.
const MIN_VISIBLE_MS = 6_000;
const MAX_VISIBLE_MS = 14_000;
// Ambient scenes the mascot rotates through *on its own* (idle fidgets, rest)
// hold for at least this long, looping their frames in place, so nothing the
// user didn't trigger switches away in under half a minute.
const AUTO_HOLD_MS = 30_000;
// A double-click picks one activity and loops it for roughly this long, so the
// chosen scene actually plays out instead of flashing past.
const DOUBLE_CLICK_HOLD_MS = 15_000;
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
  'chatAnswer',
  'coding',
  'codingThinking',
  'codingIntense',
  'research',
  'protect'
]);

const LONG_CLIP_STATES = new Set<MascotState>(['copter', 'door', 'timeTravel']);

// Visually distinct single-click reactions. (The old connection/gratitude were
// byte-for-byte the same waving art as greeting, so clicks always looked the
// same; these three are genuinely different clips.)
const CLICK_STATES: MascotState[] = ['greeting', 'happy', 'curiosity'];
// Random reactions for a double-click (rule 3). Duplicate entries intentionally
// weight common reactions over rare desktop-pet set pieces. timeTravel is left
// out: its art is a single static frame, so looping it would just freeze.
const DOUBLE_CLICK_STATES: MascotState[] = [
  'happy',
  'gadgetUse',
  'eating',
  'eating',
  'copter',
  'door'
];
// Pool of calm idle "moods" (rule 7). Hand-picked so every entry is a VISUALLY
// DISTINCT clip — the asset set has many duplicate-art states (e.g. wonder==awe,
// contemplation/randomThought==curiosity, hope==greeting, satisfaction==rest),
// which are deliberately excluded so the rotation never repeats the same picture
// under a different name. Travelling set pieces (copter/door) are excluded too.
const VARIATION_STATES: MascotState[] = [
  'calm',
  'curiosity',
  'thinking',
  'longing',
  'awe',
  'confusion',
  'concern',
  'walk'
];

function randomFrom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
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
        //   idle breather -> rest -> a random mood -> another random mood
        // then the cycle repeats. Each non-idle scene loops its frames for
        // AUTO_HOLD_MS so it reads clearly, and the next scene starts only once
        // the current one ends. After IDLE_SLEEP_MS without interaction it dozes
        // off and the routine pauses until something wakes it.
        const buildCycle = (): MascotState[] => {
          let first = randomFrom(VARIATION_STATES);
          let second = randomFrom(VARIATION_STATES);
          if (VARIATION_STATES.length > 1) {
            while (second === first) {
              second = randomFrom(VARIATION_STATES);
            }
          }
          return ['idle', 'rest', first, second];
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
          doubleClick: () => {
            if (draggingRef.current) {
              return;
            }
            react(randomFrom(DOUBLE_CLICK_STATES), 'double-click', DOUBLE_CLICK_HOLD_MS);
          },
          // Rule 4: enter drag while held (falls back to idle if drag has no frames).
          beginDrag: () => {
            draggingRef.current = true;
            noteInteraction();
            clearAuto();
            clearTransient();
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
          }
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
      actionComplete
    }),
    [status, error, manifest, snapshot, proximity, activity, click, doubleClick, beginDrag, endDrag, actionComplete]
  );
}
