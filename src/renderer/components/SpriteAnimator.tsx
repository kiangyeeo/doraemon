import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ResolvedAnimationAction } from '../animation/types';

type StageAnchor = {
  x: number;
  y: number;
};

type SpriteAnimatorProps = {
  action: ResolvedAnimationAction;
  stageWidth: number;
  stageHeight: number;
  stageAnchor: StageAnchor;
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

function actionKey(action: ResolvedAnimationAction): string {
  return `${action.name}:${action.frames.join('|')}`;
}

export function SpriteAnimator({
  action,
  stageWidth,
  stageHeight,
  stageAnchor,
  renderMode = 'canvas',
  onComplete
}: SpriteAnimatorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const completeRef = useRef(onComplete);
  const [frames, setFrames] = useState<LoadedFrame[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const currentActionKey = useMemo(() => actionKey(action), [action]);

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
    let completed = false;
    const frameDuration = 1000 / Math.max(1, action.fps);

    const tick = (now: number) => {
      elapsed += now - lastTick;
      lastTick = now;

      if (elapsed >= frameDuration) {
        const steps = Math.floor(elapsed / frameDuration);
        elapsed -= steps * frameDuration;
        nextFrameIndex += steps;

        if (nextFrameIndex >= frames.length) {
          if (action.loop) {
            nextFrameIndex %= frames.length;
          } else {
            nextFrameIndex = frames.length - 1;
            completed = true;
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
  }, [action.fps, action.loop, currentActionKey, frames.length]);

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

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = false;

    const drawWidth = currentFrame.image.naturalWidth * action.scale * dpr;
    const drawHeight = currentFrame.image.naturalHeight * action.scale * dpr;
    const drawX = stageAnchor.x * dpr - action.anchorX * action.scale * dpr;
    const drawY = stageAnchor.y * dpr - action.anchorY * action.scale * dpr;

    context.drawImage(currentFrame.image, drawX, drawY, drawWidth, drawHeight);
  }, [action.anchorX, action.anchorY, action.scale, frameIndex, frames, renderMode, stageAnchor.x, stageAnchor.y, stageHeight, stageWidth]);

  if (renderMode === 'img') {
    const currentFrame = frames[frameIndex];
    const firstFrame = currentFrame?.image ?? frames[0]?.image;
    const naturalWidth = firstFrame?.naturalWidth ?? 256;
    const naturalHeight = firstFrame?.naturalHeight ?? 256;
    const width = naturalWidth * action.scale;
    const height = naturalHeight * action.scale;

    return (
      <img
        alt=""
        className="sprite-img"
        draggable={false}
        src={currentFrame?.src}
        style={{
          left: `${stageAnchor.x - action.anchorX * action.scale}px`,
          top: `${stageAnchor.y - action.anchorY * action.scale}px`,
          width: `${width}px`,
          height: `${height}px`
        }}
      />
    );
  }

  return <canvas ref={canvasRef} className="sprite-canvas" aria-hidden="true" />;
}
