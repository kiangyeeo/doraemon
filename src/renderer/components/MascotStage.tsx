import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { BASELINE_ANCHOR } from '../animation/types';
import { useMascotState } from '../animation/useMascotState';
import { SpriteAnimator } from './SpriteAnimator';

type MascotStageProps = {
  manifestUrl: string;
};

// A press only becomes a window drag once the pointer travels past this many
// screen pixels, so a plain click or double-click never flips into drag.
const DRAG_THRESHOLD_PX = 4;

// The cursor counts as "over the sprite" once the pixel under it is at least this
// opaque. Anything fainter is treated as empty space so the window stays
// click-through there.
const HIT_ALPHA_THRESHOLD = 12;

type PressState = {
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
};

export function MascotStage({ manifestUrl }: MascotStageProps) {
  const controller = useMascotState(manifestUrl);
  const pressRef = useRef<PressState | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Mirrors the window's click-through state so we only round-trip to the main
  // process when it actually changes.
  const interactiveRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const setInteractive = useCallback((next: boolean) => {
    if (interactiveRef.current === next) {
      return;
    }
    interactiveRef.current = next;
    window.desktopPet.setInteractive(next);
  }, []);

  // Returns true when the cursor sits over an opaque sprite pixel. Reads alpha
  // straight from the rendered canvas so the hit area tracks the visible sprite
  // for every frame and scale, instead of the full square window.
  const isOverSprite = useCallback((clientX: number, clientY: number): boolean => {
    const canvas = stageRef.current?.querySelector<HTMLCanvasElement>('canvas.sprite-canvas');
    if (!canvas) {
      return false;
    }

    const rect = canvas.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX >= rect.right ||
      clientY < rect.top ||
      clientY >= rect.bottom
    ) {
      return false;
    }

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return true; // Fail open: keep the sprite usable if we can't sample it.
    }

    // The canvas backing store is scaled by devicePixelRatio relative to its CSS
    // box, so map the client point into backing-store pixels before sampling.
    const px = Math.floor(((clientX - rect.left) / rect.width) * canvas.width);
    const py = Math.floor(((clientY - rect.top) / rect.height) * canvas.height);

    try {
      return context.getImageData(px, py, 1, 1).data[3] >= HIT_ALPHA_THRESHOLD;
    } catch {
      return true; // getImageData can throw on a tainted canvas; fail open.
    }
  }, []);

  // While the window is click-through, the OS still forwards move events, so this
  // listener fires everywhere over the window and decides where the sprite is.
  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      // Never drop interactivity mid-drag, even if the cursor briefly outruns
      // the sprite during a fast flick.
      if (pressRef.current) {
        setInteractive(true);
        return;
      }
      setInteractive(isOverSprite(event.clientX, event.clientY));
    };

    window.addEventListener('mousemove', handleMove);
    return () => {
      window.removeEventListener('mousemove', handleMove);
    };
  }, [isOverSprite, setInteractive]);

  const handlePointerEnter = useCallback(() => {
    controller.proximity();
  }, [controller]);

  const handlePointerDown = useCallback(
    (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || controller.status !== 'ready') {
        return;
      }

      pressRef.current = {
        pointerId: event.pointerId,
        startX: event.screenX,
        startY: event.screenY,
        dragging: false
      };

      event.currentTarget.setPointerCapture(event.pointerId);
      // Start the OS-level window move immediately; the drag *animation* only
      // kicks in once the pointer actually moves past the threshold.
      window.desktopPet.startDrag({ x: event.screenX, y: event.screenY }).catch(console.error);
    },
    [controller]
  );

  const handlePointerMove = useCallback(
    (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
      const press = pressRef.current;

      if (!press || press.pointerId !== event.pointerId) {
        // Hovering without a button held counts as nearby mouse activity.
        controller.activity();
        return;
      }

      const distance = Math.hypot(event.screenX - press.startX, event.screenY - press.startY);
      if (!press.dragging && distance > DRAG_THRESHOLD_PX) {
        press.dragging = true;
        setIsDragging(true);
        controller.beginDrag();
      }

      if (press.dragging) {
        window.desktopPet.moveDrag({ x: event.screenX, y: event.screenY });
      }
    },
    [controller]
  );

  const handlePointerUp = useCallback(
    (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
      const press = pressRef.current;

      if (!press || press.pointerId !== event.pointerId) {
        return;
      }

      pressRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      window.desktopPet.endDrag();

      if (press.dragging) {
        setIsDragging(false);
        controller.endDrag();
      } else {
        // A press that never moved is a click: treat it as waking activity.
        controller.activity();
      }
    },
    [controller]
  );

  const handleDoubleClick = useCallback(() => {
    controller.doubleClick();
  }, [controller]);

  if (controller.status === 'loading') {
    return <div className="mascot-stage" aria-label="Loading mascot" />;
  }

  if (controller.status === 'error' || !controller.manifest || !controller.action) {
    if (controller.error) {
      console.error(controller.error);
    }
    return <div className="mascot-stage mascot-stage-error" aria-label="Mascot failed to load" />;
  }

  const { manifest, action, state } = controller;

  return (
    <div
      ref={stageRef}
      className={`mascot-stage ${isDragging ? 'is-dragging' : ''}`}
      data-state={state ?? 'idle'}
      onDblClick={handleDoubleClick}
      onPointerCancel={handlePointerUp}
      onPointerDown={handlePointerDown}
      onPointerEnter={handlePointerEnter}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <SpriteAnimator
        action={action}
        anchor={BASELINE_ANCHOR}
        onComplete={controller.actionComplete}
        scale={manifest.defaultScale}
        stageHeight={manifest.canvas.height}
        stageWidth={manifest.canvas.width}
      />
    </div>
  );
}
