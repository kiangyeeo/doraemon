import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ResolvedAnimationState } from '../animation/types';

type NormalizedAnchor = {
  x: number;
  y: number;
};

type SpriteAnimatorProps = {
  action: ResolvedAnimationState;
  stageWidth: number;
  stageHeight: number;
  // Global display scale applied to every frame (manifest.defaultScale).
  scale: number;
  // Normalized baseline (0..1) baked into each frame, aligned to the same point
  // on the stage so frames share a common floor line across scales.
  anchor: NormalizedAnchor;
  // How many full times to play the action before firing onComplete. Infinity
  // loops forever. Defaults to the action's own loop flag for backwards compat.
  repeat?: number;
  renderMode?: 'canvas' | 'img';
  onComplete?: () => void;
};

type LoadedFrame = {
  image: HTMLImageElement;
  src: string;
};

function loadFrame(src: string): Promise<LoadedFrame> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'sync';
    image.onload = () => resolve({ image, src });
    image.onerror = () => reject(new Error(`Failed to load sprite frame: ${src}`));
    image.src = src;
  });
}

function actionKey(action: ResolvedAnimationState): string {
  return `${action.name}:${action.frames.join('|')}`;
}

export function SpriteAnimator({
  action,
  stageWidth,
  stageHeight,
  scale,
  anchor,
  repeat,
  renderMode = 'canvas',
  onComplete
}: SpriteAnimatorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const completeRef = useRef(onComplete);
  const [frames, setFrames] = useState<LoadedFrame[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const currentActionKey = useMemo(() => actionKey(action), [action]);
  // Number of full plays before completion; falls back to the manifest loop flag.
  const playCount = repeat ?? (action.loop ? Number.POSITIVE_INFINITY : 1);

  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    let cancelled = false;
    setFrames([]);
    setFrameIndex(0);

    Promise.all(action.frames.map(loadFrame))
      .then((loadedFrames) => {
        if (!cancelled) {
          setFrames(loadedFrames);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error(error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentActionKey, action.frames]);

  useEffect(() => {
    if (frames.length === 0) {
      return;
    }

    let animationFrame = 0;
    let lastTick = performance.now();
    let elapsed = 0;
    let nextFrameIndex = 0;
    let completedCycles = 0;
    let completed = false;
    const frameDuration = 1000 / Math.max(0.1, action.fps);

    const tick = (now: number) => {
      elapsed += now - lastTick;
      lastTick = now;

      if (elapsed >= frameDuration) {
        const steps = Math.floor(elapsed / frameDuration);
        elapsed -= steps * frameDuration;
        nextFrameIndex += steps;

        if (nextFrameIndex >= frames.length) {
          // Tally however many full cycles we just crossed and stop once the
          // action has played playCount times (Infinity keeps looping).
          completedCycles += Math.floor(nextFrameIndex / frames.length);
          if (completedCycles >= playCount) {
            nextFrameIndex = frames.length - 1;
            completed = true;
          } else {
            nextFrameIndex %= frames.length;
          }
        }

        setFrameIndex(nextFrameIndex);
      }

      if (completed) {
        completeRef.current?.();
        return;
      }

      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animationFrame);
    };
  }, [action.fps, currentActionKey, frames.length, playCount]);

  useEffect(() => {
    if (renderMode !== 'canvas') {
      return;
    }

    const canvas = canvasRef.current;
    const currentFrame = frames[frameIndex];
    if (!canvas || !currentFrame) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(stageWidth * dpr);
    canvas.height = Math.round(stageHeight * dpr);
    canvas.style.width = `${stageWidth}px`;
    canvas.style.height = `${stageHeight}px`;

    // willReadFrequently: MascotStage samples pixel alpha on every mouse move to
    // hit-test the cursor against the sprite, so keep the backing store on the CPU.
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    const frameWidth = currentFrame.image.naturalWidth;
    const frameHeight = currentFrame.image.naturalHeight;
    const drawWidth = frameWidth * scale * dpr;
    const drawHeight = frameHeight * scale * dpr;
    // Map the frame's baked baseline anchor onto the matching point on the stage.
    const drawX = (stageWidth * anchor.x - frameWidth * anchor.x * scale) * dpr;
    const drawY = (stageHeight * anchor.y - frameHeight * anchor.y * scale) * dpr;

    context.drawImage(currentFrame.image, drawX, drawY, drawWidth, drawHeight);
  }, [anchor.x, anchor.y, scale, frameIndex, frames, renderMode, stageHeight, stageWidth]);

  if (renderMode === 'img') {
    const currentFrame = frames[frameIndex];
    const firstFrame = currentFrame?.image ?? frames[0]?.image;
    const naturalWidth = firstFrame?.naturalWidth ?? stageWidth;
    const naturalHeight = firstFrame?.naturalHeight ?? stageHeight;
    const width = naturalWidth * scale;
    const height = naturalHeight * scale;

    return (
      <img
        alt=""
        className="sprite-img"
        draggable={false}
        src={currentFrame?.src}
        style={{
          left: `${stageWidth * anchor.x - naturalWidth * anchor.x * scale}px`,
          top: `${stageHeight * anchor.y - naturalHeight * anchor.y * scale}px`,
          width: `${width}px`,
          height: `${height}px`
        }}
      />
    );
  }

  return <canvas ref={canvasRef} className="sprite-canvas" aria-hidden="true" />;
}
