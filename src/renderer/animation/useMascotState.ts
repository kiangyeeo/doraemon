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
const IDLE_REST_MS = 45_000;
const IDLE_SLEEP_MS = 90_000; // rule 5
// Gap of plain idle between two idle "fidget" scenes (rule 7). Long enough that
// the mascot is calm most of the time instead of constantly switching.
const VARIATION_MIN_MS = 30_000;
const VARIATION_MAX_MS = 50_000;
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

const CLICK_STATES: MascotState[] = ['greeting', 'connection', 'gratitude'];
// Random reactions for a double-click (rule 3). Duplicate entries intentionally
// weight common reactions over rare desktop-pet set pieces.
const DOUBLE_CLICK_STATES: MascotState[] = [
  'happy',
  'happy',
  'gadgetUse',
  'eating',
  'eating',
  'copter',
  'door',
  'timeTravel'
];
// Pool of calm, single-source idle "moods" (rule 7). Each is now one coherent
// clip that loops cleanly, so the rotation reads as "Doraemon settles into a
// mood, holds it for a while, then drifts into another" instead of flickering.
// Deliberately excludes travelling set pieces (copter/door) and busy poses.
const VARIATION_STATES: MascotState[] = [
  'calm',
  'curiosity',
  'thinking',
  'longing',
  'wonder',
  'contemplation',
  'hope',
  'awe',
  'satisfaction',
  'randomThought',
  'walk'
];

function randomFrom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
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

        let restId = 0;
        let sleepId = 0;
        let transientId = 0;
        let variationId = 0;
        let introId = 0;

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

        // Rule 5: rest first, then sleep after longer inactivity. If we are
        // mid-reaction when a timer fires, retry shortly instead of resetting
        // the full clock.
        const tryRest = () => {
          if (machine.state === 'idle') {
            playTransient('rest', autoRepeats('rest'), 'idle-rest');
          } else {
            restId = window.setTimeout(tryRest, 5000);
          }
        };
        const trySleep = () => {
          if (machine.state === 'idle') {
            commit('sleep', { reason: 'idle-timeout' });
          } else {
            sleepId = window.setTimeout(trySleep, 5000);
          }
        };
        const restartIdleTimers = () => {
          if (restId) {
            clearTimeout(restId);
          }
          if (sleepId) {
            clearTimeout(sleepId);
          }
          restId = window.setTimeout(tryRest, IDLE_REST_MS);
          sleepId = window.setTimeout(trySleep, IDLE_SLEEP_MS);
        };

        // Rule 7: wait a calm gap, then play one readable idle fidget that loops
        // its frames enough whole times to be clearly seen before returning to
        // idle. The next wait only starts once that scene ends.
        const scheduleVariation = () => {
          if (variationId) {
            clearTimeout(variationId);
          }
          variationId = window.setTimeout(() => {
            if (machine.state === 'idle' && !draggingRef.current) {
              const variation = randomFrom(VARIATION_STATES);
              playTransient(variation, autoRepeats(variation), 'idle-variation', {
                afterEnd: scheduleVariation
              });
              return;
            }
            scheduleVariation();
          }, randomBetween(VARIATION_MIN_MS, VARIATION_MAX_MS));
        };

        controlsRef.current = {
          // Rule 2: mouse approaches -> curiosity, then idle.
          proximity: () => {
            if (draggingRef.current) {
              return;
            }
            restartIdleTimers();
            playTransient('curiosity', visibleRepeats('curiosity'), 'proximity');
          },
          // Rule 6: any mouse move / click wakes from sleep and defers sleeping.
          activity: () => {
            if (draggingRef.current) {
              return;
            }
            restartIdleTimers();
            if (machine.state === 'sleep') {
              playTransient('greeting', visibleRepeats('greeting'), 'wake', {
                force: true
              });
            }
          },
          // Single click -> small social acknowledgement.
          click: () => {
            if (draggingRef.current) {
              return;
            }
            restartIdleTimers();
            const reaction = randomFrom(CLICK_STATES);
            playTransient(reaction, visibleRepeats(reaction), 'click', {
              force: true
            });
          },
          // Rule 3: double-click -> weighted random reaction / rare set piece.
          doubleClick: () => {
            if (draggingRef.current) {
              return;
            }
            restartIdleTimers();
            const reaction = randomFrom(DOUBLE_CLICK_STATES);
            playTransient(reaction, visibleRepeats(reaction), 'double-click', {
              force: true
            });
          },
          // Rule 4: enter drag while held (falls back to idle if drag has no frames).
          beginDrag: () => {
            draggingRef.current = true;
            clearTransient();
            commit('drag', { force: true, reason: 'drag-start' });
          },
          endDrag: () => {
            draggingRef.current = false;
            // The "slams down" landing plays exactly once, not on a loop.
            playTransient('dragEnd', 1, 'drag-end', { force: true });
            restartIdleTimers();
          },
          // A non-looping reaction finished on its own; settle back to idle.
          actionComplete: () => {
            const current = machine.state;
            if (PERSISTENT_STATES.has(current)) {
              return;
            }
            clearTransient();
            commit('idle', { reason: 'action-complete' });
          }
        };

        restartIdleTimers();
        scheduleVariation();
        introId = window.setTimeout(() => {
          if (machine.state === 'idle' && !draggingRef.current) {
            playTransient('greeting', visibleRepeats('greeting'), 'startup', { force: true });
          }
        }, 300);

        cleanup = () => {
          if (restId) clearTimeout(restId);
          if (sleepId) clearTimeout(sleepId);
          if (transientId) clearTimeout(transientId);
          if (variationId) clearTimeout(variationId);
          if (introId) clearTimeout(introId);
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
