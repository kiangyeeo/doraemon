import { app } from 'electron';
import { startActivityServer } from './activityServer';
import { createMascotWindow } from './window';

app.setName('Desktop Pet');

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    let mascotWindow = createMascotWindow();

    // The loopback activity server forwards real coding/agent events to the
    // currently-live mascot window, even after it is recreated on `activate`.
    startActivityServer(() => mascotWindow);

    app.on('second-instance', () => {
      if (mascotWindow.isMinimized()) {
        mascotWindow.restore();
      }
      mascotWindow.focus();
    });

    app.on('activate', () => {
      if (mascotWindow.isDestroyed()) {
        mascotWindow = createMascotWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
