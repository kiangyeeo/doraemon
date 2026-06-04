import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { assertRequiredStates, MascotStateMachine } from './stateMachine';
import type {
  CharacterManifest,
  LoadedCharacterManifest,
  MascotState,
  ResolvedAnimationState
} from './types';

type ControllerState =
  | {
      status: 'loading';
      manifest: null;
      action: null;
      state: null;
      error: null;
    }
  | {
      status: 'ready';
      manifest: LoadedCharacterManifest;
      action: ResolvedAnimationState;
      state: MascotState;
      error: null;
    }
  | {
      status: 'error';
      manifest: null;
      action: null;
      state: null;
      error: Error;
    };

type AnimationController = ControllerState & {
  requestState(nextState: MascotState): void;
  beginDrag(): void;
  endDrag(): void;
  completeAction(): void;
};

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
    // assertRequiredStates guarantees a non-empty idle state to fall back to.
    defaultState: 'idle',
    states: resolvedStates
  };
}

export function useAnimationController(manifestUrl: string): AnimationController {
  const [controllerState, setControllerState] = useState<ControllerState>({
    status: 'loading',
    manifest: null,
    action: null,
    state: null,
    error: null
  });
  const stateMachineRef = useRef<MascotStateMachine | null>(null);

  useEffect(() => {
    let cancelled = false;

    setControllerState({
      status: 'loading',
      manifest: null,
      action: null,
      state: null,
      error: null
    });

    loadCharacterManifest(manifestUrl)
      .then((manifest) => {
        if (cancelled) {
          return;
        }

        const stateMachine = new MascotStateMachine(manifest.defaultState, manifest.states);
        stateMachineRef.current = stateMachine;
        setControllerState({
          status: 'ready',
          manifest,
          action: stateMachine.action,
          state: stateMachine.state,
          error: null
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setControllerState({
          status: 'error',
          manifest: null,
          action: null,
          state: null,
          error: error instanceof Error ? error : new Error(String(error))
        });
      });

    return () => {
      cancelled = true;
    };
  }, [manifestUrl]);

  const updateFromMachine = useCallback(() => {
    const stateMachine = stateMachineRef.current;
    if (!stateMachine) {
      return;
    }

    setControllerState((previous) => {
      if (previous.status !== 'ready') {
        return previous;
      }

      return {
        ...previous,
        action: stateMachine.action,
        state: stateMachine.state
      };
    });
  }, []);

  const requestState = useCallback(
    (nextState: MascotState) => {
      const stateMachine = stateMachineRef.current;
      if (!stateMachine) {
        return;
      }

      stateMachine.enter(nextState);
      updateFromMachine();
    },
    [updateFromMachine]
  );

  // The new manifest has no dedicated drag animation, so picking the mascot up
  // plays a brief "happy" reaction; dropping it settles back to idle.
  const beginDrag = useCallback(() => {
    requestState('happy');
  }, [requestState]);

  const endDrag = useCallback(() => {
    requestState('idle');
  }, [requestState]);

  const completeAction = useCallback(() => {
    const stateMachine = stateMachineRef.current;
    if (!stateMachine) {
      return;
    }

    stateMachine.completeCurrentAction();
    updateFromMachine();
  }, [updateFromMachine]);

  return useMemo(
    () => ({
      ...controllerState,
      requestState,
      beginDrag,
      endDrag,
      completeAction
    }),
    [beginDrag, completeAction, controllerState, endDrag, requestState]
  );
}
