import { contextBridge, ipcRenderer } from 'electron';

type ScreenPoint = {
  x: number;
  y: number;
};

function normalizePoint(point: ScreenPoint): ScreenPoint {
  return {
    x: Math.round(point.x),
    y: Math.round(point.y)
  };
}

contextBridge.exposeInMainWorld('desktopPet', {
  startDrag(point: ScreenPoint) {
    return ipcRenderer.invoke('mascot-window:start-drag', normalizePoint(point));
  },
  moveDrag(point: ScreenPoint) {
    ipcRenderer.send('mascot-window:move-drag', normalizePoint(point));
  },
  endDrag() {
    ipcRenderer.send('mascot-window:end-drag');
  }
});
