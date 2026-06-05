import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { ACTIVITY_IPC_CHANNEL, type ActivityEvent } from '../shared/activity';

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
  },
  setInteractive(interactive: boolean) {
    ipcRenderer.send('mascot-window:set-interactive', interactive === true);
  },
  // Subscribe to coding/agent activity events forwarded from the loopback
  // activity server. Returns an unsubscribe function.
  onActivity(callback: (event: ActivityEvent) => void) {
    const listener = (_event: IpcRendererEvent, payload: ActivityEvent) => callback(payload);
    ipcRenderer.on(ACTIVITY_IPC_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(ACTIVITY_IPC_CHANNEL, listener);
    };
  }
});
