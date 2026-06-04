import { BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';

type ScreenPoint = {
  x: number;
  y: number;
};

type DragSession = {
  startCursor: ScreenPoint;
  startPosition: ScreenPoint;
};

const WINDOW_SIZE = 512;

let dragSession: DragSession | null = null;

function isScreenPoint(value: unknown): value is ScreenPoint {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const point = value as Record<string, unknown>;
  return (
    typeof point.x === 'number' &&
    typeof point.y === 'number' &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
}

function belongsToWindow(eventWindow: BrowserWindow | null, mascotWindow: BrowserWindow): boolean {
  return eventWindow !== null && eventWindow.id === mascotWindow.id && !mascotWindow.isDestroyed();
}

function registerDragHandlers(mascotWindow: BrowserWindow): void {
  ipcMain.handle('mascot-window:start-drag', (event, point: unknown) => {
    const eventWindow = BrowserWindow.fromWebContents(event.sender);
    if (!belongsToWindow(eventWindow, mascotWindow) || !isScreenPoint(point)) {
      return;
    }

    const [x, y] = mascotWindow.getPosition();
    dragSession = {
      startCursor: point,
      startPosition: { x, y }
    };
  });

  ipcMain.on('mascot-window:move-drag', (event, point: unknown) => {
    const eventWindow = BrowserWindow.fromWebContents(event.sender);
    if (!belongsToWindow(eventWindow, mascotWindow) || !dragSession || !isScreenPoint(point)) {
      return;
    }

    const nextX = Math.round(dragSession.startPosition.x + point.x - dragSession.startCursor.x);
    const nextY = Math.round(dragSession.startPosition.y + point.y - dragSession.startCursor.y);
    mascotWindow.setPosition(nextX, nextY, false);
  });

  ipcMain.on('mascot-window:end-drag', (event) => {
    const eventWindow = BrowserWindow.fromWebContents(event.sender);
    if (belongsToWindow(eventWindow, mascotWindow)) {
      dragSession = null;
    }
  });

  ipcMain.on('mascot-window:set-interactive', (event, interactive: unknown) => {
    const eventWindow = BrowserWindow.fromWebContents(event.sender);
    if (!belongsToWindow(eventWindow, mascotWindow)) {
      return;
    }

    // When not interactive, ignore mouse events but keep forwarding move events
    // so the renderer can still hit-test the cursor against the sprite.
    mascotWindow.setIgnoreMouseEvents(interactive !== true, { forward: true });
  });

  mascotWindow.on('blur', () => {
    dragSession = null;
  });
}

export function createMascotWindow(): BrowserWindow {
  const mascotWindow = new BrowserWindow({
    width: WINDOW_SIZE,
    height: WINDOW_SIZE,
    transparent: true,
    frame: false,
    resizable: false,
    movable: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mascotWindow.setAlwaysOnTop(true, 'screen-saver');
  mascotWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Start click-through: the transparent area around the sprite passes mouse
  // events to whatever is behind the window. The renderer flips this on while
  // the cursor is over the sprite's opaque pixels.
  mascotWindow.setIgnoreMouseEvents(true, { forward: true });
  registerDragHandlers(mascotWindow);

  if (process.env.ELECTRON_RENDERER_URL) {
    mascotWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mascotWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return mascotWindow;
}
