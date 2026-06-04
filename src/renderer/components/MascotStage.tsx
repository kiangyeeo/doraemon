import { useCallback, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { useAnimationController } from '../animation/useAnimationController';
import { BASELINE_ANCHOR } from '../animation/types';
import { SpriteAnimator } from './SpriteAnimator';

type MascotStageProps = {
  manifestUrl: string;
};

type DragState = {
  pointerId: number;
  active: boolean;
};

function screenPointFromEvent(event: PointerEvent): { x: number; y: number } {
  return {
    x: event.screenX,
    y: event.screenY
  };
}

export function MascotStage({ manifestUrl }: MascotStageProps) {
  const controller = useAnimationController(manifestUrl);
  const dragStateRef = useRef<DragState | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handlePointerDown = useCallback(
    (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || controller.status !== 'ready') {
        return;
      }

      dragStateRef.current = {
        pointerId: event.pointerId,
        active: true
      };

      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDragging(true);
      controller.beginDrag();
      window.desktopPet.startDrag(screenPointFromEvent(event)).catch(console.error);
    },
    [controller]
  );

  const handlePointerMove = useCallback((event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;

    if (!dragState?.active || dragState.pointerId !== event.pointerId) {
      return;
    }

    window.desktopPet.moveDrag(screenPointFromEvent(event));
  }, []);

  const endDrag = useCallback(
    (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
      const dragState = dragStateRef.current;

      if (!dragState?.active || dragState.pointerId !== event.pointerId) {
        return;
      }

      dragStateRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      setIsDragging(false);
      window.desktopPet.endDrag();
      controller.endDrag();
    },
    [controller]
  );

  if (controller.status === 'loading') {
    return <div className="mascot-stage" aria-label="Loading mascot" />;
  }

  if (controller.status === 'error') {
    console.error(controller.error);
    return <div className="mascot-stage mascot-stage-error" aria-label="Mascot failed to load" />;
  }

  const { manifest, action, state } = controller;

  return (
    <div
      className={`mascot-stage ${isDragging ? 'is-dragging' : ''}`}
      data-state={state}
      onPointerCancel={endDrag}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
    >
      <SpriteAnimator
        action={action}
        anchor={BASELINE_ANCHOR}
        onComplete={controller.completeAction}
        scale={manifest.defaultScale}
        stageHeight={manifest.canvas.height}
        stageWidth={manifest.canvas.width}
      />
    </div>
  );
}
