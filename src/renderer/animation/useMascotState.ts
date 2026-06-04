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
const IDLE_SLEEP_MS = 60_000; // rule 5
const VARIATION_MIN_MS = 10_000; // rule 7
const VARIATION_MAX_MS = 20_000; // rule 7
// One-shot reactions (rules 2/3/7) play their full animation this many times
// before settling back to idle, so a short clip no longer flashes past.
const REACTION_REPEATS = 3;
// Grace added to the safety timer so it fires just after the final frame; the
// animation's own completion is what normally drives the return to idle.
const TRANSIENT_HOLD_BUFFER_MS = 250;
// Cycle length assumed only when an action reports no frames / zero fps.
const TRANSIENT_FALLBACK_CYCLE_MS = 2500;

// States that loop while active and never auto-return to idle on their own.
const PERSISTENT_STATES = new Set<MascotState>(['idle', 'sleep', 'drag']);

// Random reactions for a double-click (rule 3).
const DOUBLE_CLICK_STATES: MascotState[] = ['happy', 'gadget', 'eating'];
// Pool of brief "fidget" actions used for idle variations (rule 7).
const VARIATION_STATES: MascotState[] = ['walk', 'happy', 'thinking', 'eating', 'coding'];

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

        let sleepId = 0;
        let transientId = 0;
        let variationId = 0;

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

        // Play a one-shot reaction `repeats` times, then fall back to idle
        // (rules 2/3/7). The animation's own completion normally triggers the
        // return; this timer is a safety net sized to the real play duration.
        const playTransient = (
          next: MascotState,
          repeats: number,
          reason: string,
          options?: { force?: boolean }
        ) => {
          clearTransient();
          commit(next, { reason, force: options?.force }, repeats);
          const holdMs = Math.ceil(cycleMs(next) * repeats) + TRANSIENT_HOLD_BUFFER_MS;
          transientId = window.setTimeout(() => {
            transientId = 0;
            if (!draggingRef.current) {
              commit('idle', { reason: `${reason}-end` });
            }
          }, holdMs);
        };

        // Rule 5: sleep after IDLE_SLEEP_MS of inactivity. If we are mid-reaction
        // when the timer fires, retry shortly instead of resetting the full clock.
        const trySleep = () => {
          if (machine.state === 'idle') {
            commit('sleep', { reason: 'idle-timeout' });
          } else {
            sleepId = window.setTimeout(trySleep, 5000);
          }
        };
        const restartSleepTimer = () => {
          if (sleepId) {
            clearTimeout(sleepId);
          }
          sleepId = window.setTimeout(trySleep, IDLE_SLEEP_MS);
        };

        // Rule 7: every 10-20s, if idle, play a random variation, then reschedule.
        const scheduleVariation = () => {
          if (variationId) {
            clearTimeout(variationId);
          }
          variationId = window.setTimeout(() => {
            if (machine.state === 'idle' && !draggingRef.current) {
              playTransient(randomFrom(VARIATION_STATES), REACTION_REPEATS, 'idle-variation');
            }
            scheduleVariation();
          }, randomBetween(VARIATION_MIN_MS, VARIATION_MAX_MS));
        };

        controlsRef.current = {
          // Rule 2: mouse approaches -> thinking for 1.5s, then idle.
          proximity: () => {
            if (draggingRef.current) {
              return;
            }
            restartSleepTimer();
            playTransient('thinking', REACTION_REPEATS, 'proximity');
          },
          // Rule 6: any mouse move / click wakes from sleep and defers sleeping.
          activity: () => {
            if (draggingRef.current) {
              return;
            }
            restartSleepTimer();
            if (machine.state === 'sleep') {
              commit('idle', { force: true, reason: 'wake' });
            }
          },
          // Rule 3: double-click -> random happy / gadget / eating.
          doubleClick: () => {
            if (draggingRef.current) {
              return;
            }
            restartSleepTimer();
            playTransient(randomFrom(DOUBLE_CLICK_STATES), REACTION_REPEATS, 'double-click', {
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
            commit('idle', { force: true, reason: 'drag-end' });
            restartSleepTimer();
          },
          // A non-looping reaction finished on its own; settle back to idle.
          actionComplete: () => {
            const current = machine.state;
            if (current === 'idle' || current === 'drag' || current === 'sleep') {
              return;
            }
            clearTransient();
            commit('idle', { reason: 'action-complete' });
          }
        };

        restartSleepTimer();
        scheduleVariation();

        cleanup = () => {
          if (sleepId) clearTimeout(sleepId);
          if (transientId) clearTimeout(transientId);
          if (variationId) clearTimeout(variationId);
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
      doubleClick,
      beginDrag,
      endDrag,
      actionComplete
    }),
    [status, error, manifest, snapshot, proximity, activity, doubleClick, beginDrag, endDrag, actionComplete]
  );
}
