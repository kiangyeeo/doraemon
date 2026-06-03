import { app } from 'electron';
import { createMascotWindow } from './window';

app.setName('Desktop Pet');

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    let mascotWindow = createMascotWindow();

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
