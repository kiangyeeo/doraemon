import { useCallback, useRef, useState } from 'preact/hooks';
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

type PressState = {
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
};

export function MascotStage({ manifestUrl }: MascotStageProps) {
  const controller = useMascotState(manifestUrl);
  const pressRef = useRef<PressState | null>(null);
  const [isDragging, setIsDragging] = useState(false);

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
