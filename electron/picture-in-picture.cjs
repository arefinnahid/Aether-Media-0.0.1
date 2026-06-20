const { screen } = require('electron');

let originalBounds = null;
let wasMaximized = false;

function setupCustomPip(ipcMain, win) {
  ipcMain.on('toggle-custom-pip', (event, isEntering, videoWidth, videoHeight) => {
    if (isEntering) {
      wasMaximized = win.isMaximized();
      if (wasMaximized) {
        win.unmaximize();
      }
      originalBounds = win.getBounds();

      // Use the actual video aspect ratio to size the PiP window
      const aspectRatio = (videoWidth && videoHeight) ? videoWidth / videoHeight : 16 / 9;
      const pipWidth = 400;
      const pipHeight = Math.round(pipWidth / aspectRatio);

      // Place in bottom-right of the current display's work area
      const currentDisplay = screen.getDisplayMatching(originalBounds);
      const x = currentDisplay.workArea.x + currentDisplay.workArea.width - pipWidth - 20;
      const y = currentDisplay.workArea.y + currentDisplay.workArea.height - pipHeight - 20;

      win.setBounds({ x, y, width: pipWidth, height: pipHeight }, true);
      win.setAlwaysOnTop(true, 'floating');
      win.setVisibleOnAllWorkspaces(true);

      // Lock the aspect ratio so manual resizing keeps it correct
      win.setAspectRatio(aspectRatio);

      if (win.setHasShadow) win.setHasShadow(false);

      win.webContents.send('custom-pip-state', true);
    } else {
      win.setAlwaysOnTop(false);
      win.setVisibleOnAllWorkspaces(false);
      if (win.setHasShadow) win.setHasShadow(true);

      // Unlock aspect ratio
      win.setAspectRatio(0);

      if (wasMaximized) {
        // Wait for the maximize to actually complete before telling the renderer
        win.once('maximize', () => {
          // Give one extra frame for the layout to settle
          setTimeout(() => {
            win.webContents.send('custom-pip-state', false);
          }, 150);
        });
        win.maximize();
      } else if (originalBounds) {
        win.setBounds(originalBounds, true);
        // setBounds with animate=true takes time. Give OS animation time to settle.
        setTimeout(() => {
          win.webContents.send('custom-pip-state', false);
        }, 300);
      } else {
        win.webContents.send('custom-pip-state', false);
      }
    }
  });
}

module.exports = { setupCustomPip };
