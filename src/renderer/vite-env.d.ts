/// <reference types="vite/client" />

type DesktopPetScreenPoint = {
  x: number;
  y: number;
};

interface Window {
  desktopPet: {
    startDrag(point: DesktopPetScreenPoint): Promise<void>;
    moveDrag(point: DesktopPetScreenPoint): void;
    endDrag(): void;
    setInteractive(interactive: boolean): void;
  };
}
