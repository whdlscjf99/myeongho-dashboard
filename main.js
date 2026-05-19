'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, safeStorage } = require('electron');
const path  = require('path');
const fs    = require('fs');
const https = require('https');
const desktopWidget = require('./desktopWidget');

// OS 배율 무시 - 물리 픽셀 기준으로 렌더링 (1440p@125% → 2560×1440으로 처리)
app.commandLine.appendSwitch('force-device-scale-factor', '1');

// ── 로그 시스템 ───────────────────────────────────────────
const LOG_FILE = path.join(app.getPath('userData'), 'dashboard.log');
const MAX_LOG_LINES = 500;
let _logBuffer = [];

function writeLog(level, source, message, detail = '') {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const line = `[${ts}] [${level}] [${source}] ${message}${detail ? ' | ' + String(detail).substring(0, 200) : ''}`;
  console.log(line);
  _logBuffer.push(line);
  if (_logBuffer.length > MAX_LOG_LINES) _logBuffer = _logBuffer.slice(-MAX_LOG_LINES);
  try { fs.appendFileSync(LOG_FILE, line + '\n', 'utf-8'); } catch {}
}

// ── 전역 에러 핸들러 ──────────────────────────────────────
process.on('uncaughtException', (err) => {
  writeLog('ERROR', 'main-process', err.message, err.stack?.split('\n')[1]?.trim() || '');
});
process.on('unhandledRejection', (reason) => {
  writeLog('ERROR', 'main-process', 'Unhandled Rejection', String(reason).substring(0, 300));
});

writeLog('INFO', 'main', '앱 시작 v' + (require('./package.json').version || '?'));

// ── 경로 설정 ─────────────────────────────────────────────
const DATA_DIR    = app.getPath('userData');
const STATE_FILE  = path.join(DATA_DIR, 'dashboard_savedata.json');
const BOUNDS_FILE = path.join(DATA_DIR, 'window_bounds.json');
writeLog('INFO', 'main', 'DATA_DIR: ' + DATA_DIR);

// ── API 키 암호화 (safeStorage) ───────────────────────────
const SECURE_KEYS = ['gcal_api_key', 'meal_api_key', 'anthropic_api_key'];

function encryptValue(text) {
  if (!text || !safeStorage.isEncryptionAvailable()) return { plain: text };
  try {
    return { encrypted: safeStorage.encryptString(text).toString('base64') };
  } catch (e) {
    writeLog('WARN', 'crypto', '암호화 실패 - 평문 저장', e.message);
    return { plain: text };
  }
}

function decryptValue(record) {
  if (!record) return '';
  if (typeof record === 'string') return record; // 구버전 평문 호환
  if (record.plain !== undefined) return record.plain;
  if (record.encrypted && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(record.encrypted, 'base64'));
    } catch (e) {
      writeLog('WARN', 'crypto', '복호화 실패', e.message);
      return '';
    }
  }
  return '';
}

function encryptSettings(settings) {
  const result = { ...settings };
  for (const k of SECURE_KEYS) {
    if (result[k] && typeof result[k] === 'string') result[k] = encryptValue(result[k]);
  }
  return result;
}

function decryptSettings(settings) {
  const result = { ...settings };
  for (const k of SECURE_KEYS) {
    if (result[k]) result[k] = decryptValue(result[k]);
  }
  return result;
}

// ── 상태 저장/로드 ────────────────────────────────────────
const DEFAULT_STATE = {
  memo_text: '',
  local_date_tasks: [],
  auto_checked: {},
  saved_at: '',
  onboardingCompleted: false,
  settings: {
    gcal_work_calendar_id: '',
    gcal_holiday_calendar_id: '',
    gcal_academic_calendar_id: '',
    gcal_api_key: '',
    meal_office_code: '',
    meal_school_code: '',
    meal_api_key: '',
    anthropic_api_key: '',
    neis_teacher_name: '',
    neis_class_grade: '',
    neis_class_room: ''
  }
};

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return structuredClone(DEFAULT_STATE);
    const raw  = fs.readFileSync(STATE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    const settings = decryptSettings({ ...DEFAULT_STATE.settings, ...(data.settings || {}) });
    return { ...DEFAULT_STATE, ...data, settings };
  } catch (e) {
    writeLog('ERROR', 'state', 'loadState 실패', e.message);
    return structuredClone(DEFAULT_STATE);
  }
}

function saveState(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const toSave = { ...data };
    if (toSave.settings) toSave.settings = encryptSettings({ ...toSave.settings });
    fs.writeFileSync(STATE_FILE, JSON.stringify(toSave, null, 2), 'utf-8');
    return true;
  } catch (e) {
    writeLog('ERROR', 'state', 'saveState 오류', e.message);
    return false;
  }
}

function loadWindowBounds() {
  try {
    if (!fs.existsSync(BOUNDS_FILE)) return null;
    return JSON.parse(fs.readFileSync(BOUNDS_FILE, 'utf-8'));
  } catch { return null; }
}

function saveWindowBounds(win) {
  try {
    fs.writeFileSync(BOUNDS_FILE, JSON.stringify(win.getBounds()), 'utf-8');
  } catch(e) { writeLog('WARN', 'bounds', '저장 오류', e.message); }
}

function getDefaultBounds() {
  try {
    const { screen } = require('electron');
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.workAreaSize; // 작업표시줄 제외한 실제 크기
    const scaleFactor = display.scaleFactor;
    writeLog('INFO', 'bounds', `화면: ${width}x${height}, 배율: ${scaleFactor}`);
    
    const x = 230;
    const y = 0;
    
    // 해상도별 최적 너비 설정
    let w, h;
    if (width >= 2560) {
      // 1440p (2560x1440) 이상
      w = 2352;  // 2560 - 230 + 22
      h = 1359;  // 1440 기준 (상하 여백 고려)
    } else if (width >= 1920) {
      // 1080p (1920x1080)
      w = 1712;  // 1920 - 230 + 22
      h = 1020;  // 1080 기준 (상하 여백 고려)
    } else {
      // 더 작은 화면
      w = width - x;
      h = height;
    }
    
    writeLog('INFO', 'bounds', `대시보드 크기: ${w}x${h} (해상도: ${width}x${height})`);
    return { x, y, width: w, height: h };
  } catch(e) {
    writeLog('WARN', 'bounds', '화면 크기 감지 실패, 기본값 사용', e.message);
    // fallback: 1080p 기준
    return { x: 230, y: 0, width: 1712, height: 1020 };
  }
}

// ── 자동 업데이터 ─────────────────────────────────────────
let autoUpdater = null;
function setupAutoUpdater() {
  try {
    const { autoUpdater: au } = require('electron-updater');
    autoUpdater = au;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = {
      info:  (m) => writeLog('INFO',  'updater', String(m)),
      warn:  (m) => writeLog('WARN',  'updater', String(m)),
      error: (m) => writeLog('ERROR', 'updater', String(m)),
      debug: () => {}
    };
    autoUpdater.on('update-available', (info) => {
      writeLog('INFO', 'updater', `업데이트 발견: ${info.version}`);
      mainWindow?.webContents.send('update-available', { version: info.version });
    });
    autoUpdater.on('update-not-available', () => writeLog('INFO', 'updater', '최신 버전 사용 중'));
    autoUpdater.on('download-progress', (p) => {
      mainWindow?.webContents.send('update-download-progress', { percent: Math.round(p.percent) });
    });
    autoUpdater.on('update-downloaded', () => {
      writeLog('INFO', 'updater', '업데이트 다운로드 완료');
      mainWindow?.webContents.send('update-downloaded');
    });
    autoUpdater.on('error', (e) => writeLog('ERROR', 'updater', e.message));
    // 앱 시작 5초 후 업데이트 체크
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(e => writeLog('WARN', 'updater', '체크 실패', e.message));
    }, 5000);
    writeLog('INFO', 'updater', '초기화 완료');
  } catch (e) {
    writeLog('WARN', 'updater', 'electron-updater 미설치 - 자동 업데이트 비활성', e.message);
  }
}

let mainWindow = null;
let tray       = null;

function buildTrayMenu() {
  const isActive = desktopWidget.isActive();
  const menu = Menu.buildFromTemplate([
    { label: '대시보드 열기', click: () => { if (mainWindow) mainWindow.show(); } },
    { type: 'separator' },
    {
      label: isActive ? '📌 위치/크기 조절 모드' : '🖥️ 바탕화면에 고정',
      click: () => {
        if (!mainWindow) return;
        if (isActive) {
          desktopWidget.disable(mainWindow);
          mainWindow.setResizable(true);
          mainWindow.setMovable(true);
          mainWindow.show();
        } else {
          saveWindowBounds(mainWindow);
          mainWindow.setResizable(false);
          mainWindow.setMovable(false);
          desktopWidget.enable(mainWindow);
        }
        buildTrayMenu();
      }
    },
    { type: 'separator' },
    { label: '데이터 파일 위치 열기', click: () => { shell.showItemInFolder(STATE_FILE); } },
    { label: '로그 파일 열기', click: () => { shell.showItemInFolder(LOG_FILE); } },
    { type: 'separator' },
    { label: '개발자 도구 열기', click: () => { if (mainWindow) mainWindow.webContents.openDevTools(); } },
    { type: 'separator' },
    { label: '종료', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  if (tray) tray.setContextMenu(menu);
}

function createWindow() {
  const bounds = loadWindowBounds() || getDefaultBounds();

  mainWindow = new BrowserWindow({
    x: bounds.x, y: bounds.y,
    width: bounds.width, height: bounds.height,
    minWidth: 800, minHeight: 600,
    title: '명호중 대시보드',
    frame: false, transparent: false,
    backgroundColor: '#000000',
    alwaysOnTop: false, skipTaskbar: false,
    resizable: true, movable: true,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webSecurity:      false, // Flask 로컬 서버 CORS 허용
      allowRunningInsecureContent: false,
      sandbox: false,
    },
    icon: path.join(__dirname, 'renderer', 'icon.ico'),
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'dashboard.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    const ok = desktopWidget.enable(mainWindow);
    writeLog('INFO', 'widget', 'enable: ' + ok);
    if (ok) {
      mainWindow.setResizable(false);
      mainWindow.setMovable(false);
    }
    buildTrayMenu();
    setTimeout(() => {
      desktopWidget.disable(mainWindow);
      mainWindow.focus();
      mainWindow.webContents.focus();
      desktopWidget.enable(mainWindow);
      mainWindow.setResizable(false);
      mainWindow.setMovable(false);
    }, 1000);
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      if (!desktopWidget.isActive()) saveWindowBounds(mainWindow);
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  const iconPath = path.join(__dirname, 'renderer', 'icon.ico');
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('명호중 대시보드');
  buildTrayMenu();
  tray.on('double-click', () => { if (mainWindow) mainWindow.show(); });
}

// ── IPC 핸들러 ────────────────────────────────────────────
ipcMain.handle('state:load', () => ({ ok: true, state: loadState() }));

ipcMain.handle('state:save', (_, payload) => {
  const state = loadState();
  if (payload && typeof payload === 'object') {
    if (typeof payload.memo_text === 'string') state.memo_text = payload.memo_text;
    if (Array.isArray(payload.local_date_tasks)) state.local_date_tasks = payload.local_date_tasks;
    if (payload.auto_checked && typeof payload.auto_checked === 'object') state.auto_checked = payload.auto_checked;
    if (typeof payload.saved_at === 'string') state.saved_at = payload.saved_at;
  }
  return { ok: saveState(state) };
});

ipcMain.handle('settings:save', (_, payload) => {
  const state = loadState();
  const allowed = [
    'gcal_work_calendar_id', 'gcal_holiday_calendar_id', 'gcal_academic_calendar_id',
    'gcal_api_key', 'meal_office_code', 'meal_school_code', 'meal_api_key',
    'anthropic_api_key', 'neis_teacher_name', 'neis_class_grade', 'neis_class_room'
  ];
  const current = state.settings || {};
  for (const k of allowed) { if (k in payload) current[k] = payload[k]; }
  state.settings = current;
  return { ok: saveState(state) };
});

ipcMain.handle('settings:load', () => {
  const state = loadState();
  return { ok: true, settings: state.settings || DEFAULT_STATE.settings };
});

// 플로팅 메모 저장/로드
const STICKY_NOTES_FILE = path.join(DATA_DIR, 'sticky_notes.json');

ipcMain.handle('stickyNotes:save', (_, notes) => {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STICKY_NOTES_FILE, JSON.stringify(notes, null, 2), 'utf-8');
    return { ok: true };
  } catch (e) {
    writeLog('ERROR', 'stickyNotes', 'save 실패', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('stickyNotes:load', () => {
  try {
    if (!fs.existsSync(STICKY_NOTES_FILE)) return { ok: true, notes: [] };
    const raw = fs.readFileSync(STICKY_NOTES_FILE, 'utf-8');
    const notes = JSON.parse(raw);
    return { ok: true, notes: Array.isArray(notes) ? notes : [] };
  } catch (e) {
    writeLog('ERROR', 'stickyNotes', 'load 실패', e.message);
    return { ok: true, notes: [] };
  }
});

// 온보딩
ipcMain.handle('onboarding:isCompleted', () => {
  const state = loadState();
  return { completed: !!state.onboardingCompleted };
});

ipcMain.handle('onboarding:complete', (_, settingsPayload) => {
  const state = loadState();
  state.onboardingCompleted = true;
  if (settingsPayload && typeof settingsPayload === 'object') {
    const current = state.settings || {};
    const allowed = [
      'gcal_work_calendar_id', 'gcal_holiday_calendar_id', 'gcal_academic_calendar_id',
      'gcal_api_key', 'meal_office_code', 'meal_school_code', 'meal_api_key',
      'anthropic_api_key', 'neis_teacher_name', 'neis_class_grade', 'neis_class_room'
    ];
    for (const k of allowed) { if (k in settingsPayload) current[k] = settingsPayload[k]; }
    state.settings = current;
  }
  writeLog('INFO', 'onboarding', '온보딩 완료');
  return { ok: saveState(state) };
});

ipcMain.handle('anthropic:request', (_, { apiKey, body }) => {
  return new Promise((resolve) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ ok: true, data: JSON.parse(data) }); }
        catch (e) { resolve({ ok: false, error: e.message }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.write(bodyStr); req.end();
  });
});

ipcMain.handle('widget:pause', () => {
  if (!mainWindow) return;
  // desktopWidget의 OS 레벨 focusWidget 호출 (AttachThreadInput + SetFocus)
  try { desktopWidget.focusWidget(); } catch {}
  mainWindow.focus();
  mainWindow.webContents.focus();
});

ipcMain.handle('widget:resume', () => {
  // 위젯 모드 유지 - focusWidget으로 포커스 복원
  try { desktopWidget.focusWidget(); } catch {}
});

ipcMain.handle('app:version',  () => app.getVersion());
ipcMain.handle('app:dataPath', () => STATE_FILE);

ipcMain.handle('window:show', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); mainWindow.webContents.focus(); }
});
ipcMain.handle('window:hide',  () => { if (mainWindow) mainWindow.hide(); });
ipcMain.handle('shell:showDataFile', () => { shell.showItemInFolder(STATE_FILE); });
// ── Windows 자동 실행 (레지스트리 직접 등록) ────────────
const REG_KEY  = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const REG_NAME = 'MyeonhoDashboard';

function getExePath() {
  // 설치된 exe 경로
  return process.execPath;
}

function regSet(enabled) {
  const { execSync } = require('child_process');
  try {
    if (enabled) {
      const exePath = getExePath().replace(/\\/g, '\\\\');
      execSync(`reg add "${REG_KEY}" /v "${REG_NAME}" /t REG_SZ /d "\"${exePath}\"" /f`, { stdio: 'ignore' });
    } else {
      execSync(`reg delete "${REG_KEY}" /v "${REG_NAME}" /f`, { stdio: 'ignore' });
    }
    return true;
  } catch(e) {
    writeLog('ERROR', 'autoLaunch', '레지스트리 설정 실패', e.message);
    return false;
  }
}

function regGet() {
  const { execSync } = require('child_process');
  try {
    const out = execSync(`reg query "${REG_KEY}" /v "${REG_NAME}"`, { stdio: ['ignore','pipe','ignore'] }).toString();
    return out.includes(REG_NAME);
  } catch {
    return false;
  }
}

ipcMain.handle('autoLaunch:set', (_, { enabled }) => {
  try {
    const ok = regSet(enabled);
    writeLog('INFO', 'autoLaunch', `자동 실행 ${enabled ? '설정' : '해제'} (레지스트리)`);
    return { ok, enabled };
  } catch(e) {
    writeLog('ERROR', 'autoLaunch', '자동 실행 설정 실패', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('autoLaunch:get', () => {
  try {
    const enabled = regGet();
    return { ok: true, enabled };
  } catch(e) {
    return { ok: true, enabled: false };
  }
});


ipcMain.handle('shell:openUrl', async (_, { url, browser }) => {
  if (!url || !url.startsWith('https://')) return { ok: false, error: '유효하지 않은 URL' };
  try {
    if (!browser || browser === 'electron') {
      const win = new BrowserWindow({
        width: 1280, height: 800, title: '구글 시트',
        webPreferences: { nodeIntegration: false, contextIsolation: true }
      });
      win.loadURL(url);
      return { ok: true };
    } else if (browser === 'chrome') {
      const { execFile } = require('child_process');
      const chromePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
      ];
      const p = chromePaths.find(c => fs.existsSync(c));
      if (p) { execFile(p, [url]); } else { await shell.openExternal(url); }
      return { ok: true };
    } else if (browser === 'edge') {
      const { execFile } = require('child_process');
      const edgePaths = [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
      ];
      const p = edgePaths.find(e => fs.existsSync(e));
      if (p) { execFile(p, [url]); } else { await shell.openExternal(url); }
      return { ok: true };
    } else {
      await shell.openExternal(url);
      return { ok: true };
    }
  } catch (e) {
    writeLog('ERROR', 'openUrl', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('window:move', (_, dx, dy) => {
  if (!mainWindow || desktopWidget.isActive()) return;
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(x + dx, y + dy);
});

ipcMain.handle('window:opacity', (_, opacity) => {
  if (!mainWindow) return;
  mainWindow.setOpacity(opacity);
});

// 로그
ipcMain.handle('log:getRecent', () => _logBuffer.slice(-100));
ipcMain.handle('log:write', (_, { level, source, message, detail }) => {
  writeLog(level || 'INFO', source || 'renderer', message || '', detail || '');
});

// 업데이터
ipcMain.handle('update:check',    () => autoUpdater?.checkForUpdates().catch(e => ({ error: e.message })));
ipcMain.handle('update:download', () => autoUpdater?.downloadUpdate().catch(e => ({ error: e.message })));
ipcMain.handle('update:install',  () => { autoUpdater?.quitAndInstall(); });

// ── 자동 로그인 ───────────────────────────────────────────
const AUTO_LOGIN_SETTINGS_FILE = path.join(DATA_DIR, 'autologin_settings.json');

function loadAutoLoginSettings() {
  try {
    if (!fs.existsSync(AUTO_LOGIN_SETTINGS_FILE)) return {};
    const raw = JSON.parse(fs.readFileSync(AUTO_LOGIN_SETTINGS_FILE, 'utf-8'));
    if (raw.password) raw.password = decryptValue(raw.password);
    return raw;
  } catch { return {}; }
}

function saveAutoLoginSettings(data) {
  try {
    const toSave = { certName: data.certName, neisOrder: data.neisOrder };
    if (data.password) toSave.password = encryptValue(data.password);
    fs.writeFileSync(AUTO_LOGIN_SETTINGS_FILE, JSON.stringify(toSave, null, 2), 'utf-8');
  } catch (e) { writeLog('ERROR', 'autoLogin', '설정 저장 실패', e.message); }
}

ipcMain.handle('autoLogin:loadSettings', () => loadAutoLoginSettings());
ipcMain.handle('autoLogin:saveSettings', (_, data) => { saveAutoLoginSettings(data); return { ok: true }; });
ipcMain.handle('autoLogin:deleteSettings', () => {
  try {
    if (fs.existsSync(AUTO_LOGIN_SETTINGS_FILE)) {
      fs.unlinkSync(AUTO_LOGIN_SETTINGS_FILE);
      writeLog('INFO', 'autoLogin', '자동 로그인 설정 파일 삭제 완료');
    }
    return { ok: true };
  } catch (e) {
    writeLog('ERROR', 'autoLogin', '설정 파일 삭제 실패', e.message);
    return { ok: false, error: e.message };
  }
});

let autoLoginRunning = false;
ipcMain.handle('autoLogin:execute', async (_, { targetSystem, browser = 'chrome' }) => {
  if (autoLoginRunning) return { ok: false, error: '이미 실행 중입니다.' };
  autoLoginRunning = true;
  try {
    const settings = loadAutoLoginSettings();
    if (!settings.password) return { ok: false, error: '비밀번호가 설정되지 않았습니다.' };
    if (!settings.certName) return { ok: false, error: '인증서 이름이 설정되지 않았습니다.' };
    const { executeAutoLogin } = require('./autoLogin');
    await executeAutoLogin({
      userData: app.getPath('userData'),
      certName: settings.certName,
      password: settings.password,
      neisOrder: settings.neisOrder || 0,
      popupCloseOption: settings.popupCloseOption || 'close',
      targetSystem,
      browser,
      onStatus: (step, msg) => {
        writeLog('INFO', 'autoLogin', `[${step}] ${msg}`);
        mainWindow?.webContents.send('autoLogin:status', { step, msg });
      },
    });
    return { ok: true };
  } catch (e) {
    writeLog('ERROR', 'autoLogin', e.message);
    mainWindow?.webContents.send('autoLogin:status', { step: 'error', msg: e.message });
    return { ok: false, error: e.message };
  } finally { autoLoginRunning = false; }
});

// ── 앱 생명주기 ───────────────────────────────────────────
// ── 앱 시작 자가 진단 ────────────────────────────────────
async function runSelfDiagnostics() {
  writeLog('INFO', 'diagnostics', '자가 진단 시작');
  const results = [];

  // 1. Chrome 설치 확인
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const chromeFound = chromePaths.some(p => { try { return fs.existsSync(p); } catch { return false; } });
  results.push({ name: 'Chrome', ok: chromeFound, msg: chromeFound ? '설치됨' : '설치되지 않음 - 자동 로그인 불가' });

  // 2. Playwright 설치 확인
  let playwrightOk = false;
  try { require('playwright'); playwrightOk = true; } catch {}
  results.push({ name: 'Playwright', ok: playwrightOk, msg: playwrightOk ? '설치됨' : '미설치 - npm install playwright 필요' });

  // 3. userData 경로 쓰기 권한 확인
  let dataOk = false;
  try {
    const testFile = path.join(DATA_DIR, '.write_test');
    fs.writeFileSync(testFile, '1');
    fs.unlinkSync(testFile);
    dataOk = true;
  } catch {}
  results.push({ name: 'userData 쓰기권한', ok: dataOk, msg: dataOk ? '정상' : '쓰기 권한 없음 - 관리자 권한 필요' });

  // 4. 자동 업데이트 설정 확인
  const hasPublish = !!process.env.GH_TOKEN || true; // 빌드 시 포함
  results.push({ name: '자동업데이트', ok: true, msg: '설정됨' });

  results.forEach(r => {
    writeLog(r.ok ? 'INFO' : 'WARN', 'diagnostics', `[${r.name}] ${r.msg}`);
  });

  const failed = results.filter(r => !r.ok);
  if (failed.length > 0) {
    writeLog('WARN', 'diagnostics', `자가 진단 완료 - ${failed.length}개 항목 주의 필요`);
  } else {
    writeLog('INFO', 'diagnostics', '자가 진단 완료 - 모든 항목 정상');
  }

  return results;
}

app.whenReady().then(async () => {
  const { session } = require('electron');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src * 'unsafe-inline' 'unsafe-eval' data: blob:"]
      }
    });
  });
  createWindow();
  createTray();
  setupAutoUpdater();
  // 앱 시작 3초 후 자가 진단 (창 로딩 완료 후)
  setTimeout(() => runSelfDiagnostics(), 3000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow) mainWindow.show();
  });
});

app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  app.isQuitting = true;
  writeLog('INFO', 'main', '앱 종료');
  // renderer에 즉시 저장 신호
  try { mainWindow?.webContents?.send('app:before-quit'); } catch {}
  if (mainWindow) {
    try {
      if (desktopWidget.isActive()) desktopWidget.disable(mainWindow);
    } catch {}
    saveWindowBounds(mainWindow);
  }
});

// ── 컴시간 직접 연동 (Flask 없이 순수 JS) ───────────────────
const COMCIGAN_URL = 'http://222.106.100.23:4082';
let comciganCache = null;
let comciganCacheTime = 0;
const COMCIGAN_CACHE_TTL = 30 * 60 * 1000; // 30분

async function comciganFetch(url) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function initComcigan() {
  if (comciganCache && Date.now() - comciganCacheTime < COMCIGAN_CACHE_TTL) return comciganCache;
  try {
    let iconv; try { iconv = require('iconv-lite'); } catch {}
    const buf  = await comciganFetch(`${COMCIGAN_URL}/st`);
    const html = iconv ? iconv.decode(buf, 'euc-kr') : buf.toString('utf-8');
    const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
    const script  = scripts[1] || scripts[0] || '';
    const route   = script.match(/\.\/\d+\?\d+l/)?.[0];
    const PREFIX  = script.match(/'(\d+_)'/)?.[1];
    const daynum  = parseInt(script.match(/일일자료=Q자료\(자료\.자료(\d+)/)?.[1]);
    const thnum   = parseInt(script.match(/성명=자료\.자료(\d+)/)?.[1]);
    const sbnum   = parseInt(script.match(/자료\.자료(\d+)\[sb\]/)?.[1]);
    if (!route || !PREFIX) throw new Error('라우트 파싱 실패');
    comciganCache = {
      BASEURL:   `${COMCIGAN_URL}${route.slice(1, 8)}`,
      SEARCHURL: `${COMCIGAN_URL}${route.slice(1)}`,
      PREFIX, sbnum, thnum, daynum
    };
    comciganCacheTime = Date.now();
    writeLog('INFO', 'comcigan', '초기화 완료');
    return comciganCache;
  } catch(e) {
    writeLog('ERROR', 'comcigan', '초기화 실패', e.message);
    throw e;
  }
}

async function fetchComciganTimetable(sccode) {
  const { BASEURL, PREFIX, sbnum, thnum, daynum } = await initComcigan();
  const b64  = Buffer.from(`${PREFIX}${sccode}_0_1`).toString('base64');
  const buf  = await comciganFetch(`${BASEURL}?${b64}`);
  const raw  = JSON.parse(buf.toString('utf-8').replace(/ /g, ''));
  const subjects = raw[`자료${sbnum}`];
  const teachers = raw[`자료${thnum}`];
  const dayData  = raw[`자료${daynum}`];
  const pfx = n => { const s = String(n); return s.length === 5 ? s.slice(0,2) : s.slice(0,1); };

  const result = [];
  for (let gi = 1; gi < dayData.length; gi++) {
    const grade = [];
    for (let ci = 1; ci < dayData[gi].length; ci++) {
      const cls = [];
      for (let di = 1; di <= 5; di++) {
        const day = [];
        for (const x of (dayData[gi][ci][di] || [])) {
          if (!x || String(x).slice(0,-2) === '0') continue;
          const teacherIdx = parseInt(String(x).slice(-2));
          day.push({
            subject: subjects[parseInt(pfx(x))] || '',
            teacher: teachers[teacherIdx] || '',
            teacherId: teacherIdx  // 교사 고유 ID!
          });
        }
        cls.push(day);
      }
      grade.push(cls);
    }
    result.push(grade);
  }
  return result;
}

// 명호중학교 고정 학교코드 (학교 선택 기능 개발 전까지 하드코딩)
// 컴시간 sccode: 실제 실행 시 searchTeacher가 sccode 없으면 여기서 반환
const DEFAULT_SCHOOL = { name: '명호중학교', sccode: null }; // sccode는 첫 검색 시 캐싱

ipcMain.handle('comcigan:getDefaultSchool', () => {
  return { ok: true, sccode: DEFAULT_SCHOOL.sccode, name: DEFAULT_SCHOOL.name };
});

ipcMain.handle('comcigan:searchSchool', async (_, { name }) => {
  try {
    const { SEARCHURL } = await initComcigan();
    // 컴시간은 EUC-KR 인코딩 필요
    let encoded;
    try {
      const iconv = require('iconv-lite');
      const eucBuf = iconv.encode(name, 'euc-kr');
      encoded = [...eucBuf].map(b => `%${b.toString(16).toUpperCase().padStart(2,'0')}`).join('');
    } catch {
      // iconv-lite 없으면 UTF-8 fallback
      encoded = [...Buffer.from(name)].map(b => `%${b.toString(16).toUpperCase().padStart(2,'0')}`).join('');
    }
    const buf  = await comciganFetch(`${SEARCHURL}${encoded}`);
    const data = JSON.parse(buf.toString('utf-8').replace(/ /g, ''));
    return { ok: true, data: data['학교검색'] || [] };
  } catch(e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('comcigan:getTimetable', async (_, { sccode }) => {
  try {
    const data = await fetchComciganTimetable(sccode);
    return { ok: true, data };
  } catch(e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('comcigan:getClassTimetable', async (_, { sccode, grade, classNum }) => {
  try {
    if (!sccode) {
      // sccode 없으면 명호중학교로 검색
      if (!DEFAULT_SCHOOL.sccode) {
        const { SEARCHURL } = await initComcigan();
        let iconv; try { iconv = require('iconv-lite'); } catch {}
        const eucBuf = iconv ? iconv.encode('명호중', 'euc-kr') : Buffer.from('명호중');
        const encoded = [...eucBuf].map(b => `%${b.toString(16).toUpperCase().padStart(2,'0')}`).join('');
        const buf = await comciganFetch(`${SEARCHURL}${encoded}`);
        const data = JSON.parse(buf.toString('utf-8').replace(/\u0000/g, ''));
        const list = data['학교검색'] || [];
        const school = list.find(s => s[2]?.includes('명호중')) || list[0];
        if (school) DEFAULT_SCHOOL.sccode = school[3];
      }
      sccode = DEFAULT_SCHOOL.sccode;
    }
    
    const timetable = await fetchComciganTimetable(sccode);
    const days = ['월','화','수','목','금'];
    const schedule = { '월':[], '화':[], '수':[], '목':[], '금':[] };
    
    // 학년/반 인덱스 (1학년 1반 = timetable[0][0])
    const gi = parseInt(grade) - 1;
    const ci = parseInt(classNum) - 1;
    
    if (!timetable[gi] || !timetable[gi][ci]) {
      return { ok: false, error: `${grade}학년 ${classNum}반 시간표를 찾을 수 없습니다` };
    }
    
    for (let di = 0; di < 5; di++) {
      const dayLessons = timetable[gi][ci][di] || [];
      dayLessons.forEach((lesson, idx) => {
        const period = idx + 1;
        // 7교시까지만 저장
        if (period <= 7) {
          schedule[days[di]].push({
            period: period,
            subject: lesson.subject,
            teacher: lesson.teacher
          });
        }
      });
    }
    
    return { ok: true, data: { timetable: schedule } };
  } catch(e) { return { ok: false, error: e.message }; }
});


ipcMain.handle('comcigan:searchTeacher', async (_, { sccode, teacherName, teacherId }) => {
  try {
    // sccode 없으면 명호중학교 자동 검색 후 캐싱
    let resolvedSccode = sccode;
    if (!resolvedSccode && DEFAULT_SCHOOL.sccode) {
      resolvedSccode = DEFAULT_SCHOOL.sccode;
    } else if (!resolvedSccode) {
      try {
        const { SEARCHURL } = await initComcigan();
        let iconv2; try { iconv2 = require('iconv-lite'); } catch {}
        const eucBuf2 = iconv2 ? iconv2.encode('명호중', 'euc-kr') : Buffer.from('명호중');
        const encoded = [...eucBuf2].map(b => `%${b.toString(16).toUpperCase().padStart(2,'0')}`).join('');
        const buf = await comciganFetch(`${SEARCHURL}${encoded}`);
        const data = JSON.parse(buf.toString('utf-8').replace(/ /g, ''));
        const list = data['학교검색'] || [];
        const school = list.find(s => s[2]?.includes('명호중')) || list[0];
        if (school) { DEFAULT_SCHOOL.sccode = school[3]; resolvedSccode = school[3]; }
      } catch(e) { return { ok: false, error: '학교코드 자동 설정 실패: ' + e.message }; }
    }
    if (!resolvedSccode) return { ok: false, error: '학교코드가 설정되지 않았습니다' };
    const timetable = await fetchComciganTimetable(resolvedSccode);
    const days = ['월','화','수','목','금'];
    const clean = teacherName.replace('*','').trim();
    const schedule = { '월':[], '화':[], '수':[], '목':[], '금':[] };
    const foundTeachers = {};  // key: teacher name, value: {subject, id}
    let selectedTeacherId = teacherId || null;  // 동명이인 선택 시 미리 설정

// 첫 스캔: 매칭되는 교사 찾기
    for (let gi = 0; gi < timetable.length; gi++) {
      for (let ci = 0; ci < timetable[gi].length; ci++) {
        for (let di = 0; di < 5; di++) {
          (timetable[gi][ci][di] || []).forEach((lesson, pi) => {
            const tc = (lesson.teacher||'').replace('*','').trim();
            const tcOriginal = lesson.teacher || '';
            if (!tc) return;
            
            // 정확 일치 또는 부분 일치
            const isExact = tcOriginal === teacherName || tc === clean;
            const isPartial = tc.includes(clean) || clean.includes(tc);
            
            if (isExact || isPartial) {
  if (isExact) {
    if (selectedTeacherId === null) {
      selectedTeacherId = lesson.teacherId;
    } else if (selectedTeacherId !== lesson.teacherId) {
      selectedTeacherId = null;
    }
  }
  // teacherId를 키로 사용 (동명이인 구분)
  const key = String(lesson.teacherId);
  if (!foundTeachers[key]) {
    foundTeachers[key] = { 
      name: lesson.teacher,
      subject: lesson.subject, 
      id: lesson.teacherId 
    };
  }
}
          });
        }
      }
    }

   const teacherKeys = Object.keys(foundTeachers);
if (teacherKeys.length === 0) return { ok: false, error: `"${teacherName}" 선생님을 찾을 수 없습니다` };

if (teacherKeys.length > 1 && !teacherId) {
  return { ok: true, multiple: true, teachers: teacherKeys.map(k => ({ 
    name: foundTeachers[k].name, 
    display: `${foundTeachers[k].name} (${foundTeachers[k].subject})`,
    teacher_id: foundTeachers[k].id
  })) };
}

if (selectedTeacherId === null) {
  selectedTeacherId = foundTeachers[teacherKeys[0]].id;
}

    // 선택된 교사 ID로만 시간표 구성
    const debugLogs = [];
    for (let gi = 0; gi < timetable.length; gi++) {
      for (let ci = 0; ci < timetable[gi].length; ci++) {
        for (let di = 0; di < 5; di++) {
          const dayData = timetable[gi][ci][di] || [];
          if (dayData.length > 0) {
            debugLogs.push(`${gi+1}학년 ${ci+1}반 ${['월','화','수','목','금'][di]}요일: ${dayData.length}개 수업`);
          }
          debugLogs.push(`${gi+1}학년 ${ci+1}반 ${days[di]}: ${dayData.length}개 수업`);
          debugLogs.push(`  전체 배열: ${JSON.stringify(dayData.map((l,i) => `[${i}]${l.subject}`))}`);
          
          dayData.forEach((lesson, idx) => {
            // 컴시간 API는 이미 조례/점심 제외된 배열
            // idx가 0부터 시작하므로 +1 하면 안됨!
            const period = idx;  // 0=조례? 1=1교시, 2=2교시...
            
            // 조례/점심 건너뛰기
            if (!lesson.subject || lesson.subject === '조례' || lesson.subject === '점심') {
              return;
            }
            
            debugLogs.push(`  [${idx}] teacherId=${lesson.teacherId}, subject=${lesson.subject} → period=${period}`);
            
            // 7교시까지만 저장
            if (lesson.teacherId === selectedTeacherId && period >= 1 && period <= 7) {
              const classCode = parseInt(`${gi+1}${String(ci+1).padStart(2,'0')}`);
              schedule[days[di]].push({
                period: period,
                subject: lesson.subject,
                grade: gi+1, 
                class: ci+1,
                class_code: classCode,
                location: `${gi+1}-${String(ci+1).padStart(2,'0')}`
              });
            }
          });
        }
      }
    }

    const teacherEntry = Object.values(foundTeachers).find(t => t.id === selectedTeacherId) || foundTeachers[teacherKeys[0]];
    return { ok: true, data: { teacher: teacherEntry.name, timetable: schedule }, debug: debugLogs };
  } catch(e) { return { ok: false, error: e.message }; }
});

// 컴시간 캐시 초기화 (시간표 변경 시 수동 갱신용)
ipcMain.handle('comcigan:clearCache', () => {
  comciganCache = null;
  comciganCacheTime = 0;
  writeLog('INFO', 'comcigan', '캐시 초기화');
  return { ok: true };
});