const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

let mainWindow;
let pwWindow = null;
const saveFilePath = path.join(app.getPath('userData'), 'dashboard_savedata.json');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, 'renderer/icon.ico')
  });

  mainWindow.loadFile('renderer/index.html');
}

app.whenReady().then(() => {
  createWindow();
  
  // 자동 업데이트 설정
  autoUpdater.checkForUpdatesAndNotify();
  
  autoUpdater.on('update-available', () => {
    dialog.showMessageBox({
      type: 'info',
      title: '업데이트 가능',
      message: '새로운 버전이 있습니다. 다운로드 중...',
      buttons: ['확인']
    });
  });
  
  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
      type: 'info',
      title: '업데이트 준비 완료',
      message: '업데이트가 다운로드되었습니다. 앱을 재시작하여 업데이트를 적용하시겠습니까?',
      buttons: ['재시작', '나중에']
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('save-data', async (event, data) => {
  try {
    fs.writeFileSync(saveFilePath, JSON.stringify(data, null, 2));
    return { success: true };
  } catch (error) {
    console.error('저장 실패:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-data', async () => {
  try {
    if (fs.existsSync(saveFilePath)) {
      const data = fs.readFileSync(saveFilePath, 'utf-8');
      return JSON.parse(data);
    }
    return null;
  } catch (error) {
    console.error('불러오기 실패:', error);
    return null;
  }
});

ipcMain.handle('open-playwright-window', async (event, config) => {
  if (pwWindow) {
    pwWindow.focus();
    return;
  }

  pwWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    parent: mainWindow,
    modal: false
  });

  pwWindow.loadFile('renderer/playwright.html');
  
  pwWindow.on('closed', () => {
    pwWindow = null;
  });
});

ipcMain.handle('execute-auto-login', async (event, config) => {
  try {
    const { executeAutoLogin } = require('./autoLogin');
    const result = await executeAutoLogin(config);
    return result;
  } catch (error) {
    console.error('자동 로그인 실행 오류:', error);
    return { success: false, error: error.message };
  }
});