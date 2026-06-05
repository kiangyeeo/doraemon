/// <reference types="vite/client" />

import type { ActivityEvent } from '../shared/activity';

type DesktopPetScreenPoint = {
  x: number;
  y: number;
};

// This file imports a type, so it is a module: the Window augmentation must go
// through `declare global` to stay a global, not a local interface.
declare global {
  interface Window {
    desktopPet: {
      startDrag(point: DesktopPetScreenPoint): Promise<void>;
      moveDrag(point: DesktopPetScreenPoint): void;
      endDrag(): void;
      setInteractive(interactive: boolean): void;
      onActivity(callback: (event: ActivityEvent) => void): () => void;
    };
  }
}

export {};
