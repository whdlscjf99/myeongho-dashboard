'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

  // ── 범용 invoke (channel, ...args) ───────────────────────
  // window.electronAPI.invoke('comcigan:searchTeacher', {...}) 형태로 사용
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),

  // ── 상태 저장/로드 ──────────────────────────────────────
  loadState:     ()       => ipcRenderer.invoke('state:load'),
  saveState:     (data)   => ipcRenderer.invoke('state:save', data),
  loadSettings:  ()       => ipcRenderer.invoke('settings:load'),
  saveSettings:  (data)   => ipcRenderer.invoke('settings:save', data),

  // ── 온보딩 ───────────────────────────────────────────────
  onboardingIsCompleted: ()       => ipcRenderer.invoke('onboarding:isCompleted'),
  onboardingComplete:    (data)   => ipcRenderer.invoke('onboarding:complete', data),

  // ── 앱 정보 ──────────────────────────────────────────────
  getVersion:    ()       => ipcRenderer.invoke('app:version'),
  getDataPath:   ()       => ipcRenderer.invoke('app:dataPath'),

  // ── 창 제어 ──────────────────────────────────────────────
  showWindow:    ()       => ipcRenderer.invoke('window:show'),
  hideWindow:    ()       => ipcRenderer.invoke('window:hide'),
  pauseWidget:   ()       => ipcRenderer.invoke('widget:pause'),
  resumeWidget:  ()       => ipcRenderer.invoke('widget:resume'),
  moveWindow:    (dx, dy) => ipcRenderer.invoke('window:move', dx, dy),
  setOpacity:    (v)      => ipcRenderer.invoke('window:opacity', v),

  // ── 파일/URL ─────────────────────────────────────────────
  showDataFile:  ()             => ipcRenderer.invoke('shell:showDataFile'),
  openUrl:       (url, browser) => ipcRenderer.invoke('shell:openUrl', { url, browser }),

  // ── Anthropic API ────────────────────────────────────────
  anthropicRequest: (apiKey, body) => ipcRenderer.invoke('anthropic:request', { apiKey, body }),

  // ── 로그 ─────────────────────────────────────────────────
  logWrite:     (level, source, message, detail) =>
    ipcRenderer.invoke('log:write', { level, source, message, detail }),
  logGetRecent: () => ipcRenderer.invoke('log:getRecent'),

  // ── 업데이터 ─────────────────────────────────────────────
  updateCheck:    () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall:  () => ipcRenderer.invoke('update:install'),
  onUpdateAvailable:        (cb) => ipcRenderer.on('update-available',         (_, d) => cb(d)),
  onUpdateDownloadProgress: (cb) => ipcRenderer.on('update-download-progress', (_, d) => cb(d)),
  onUpdateDownloaded:       (cb) => ipcRenderer.on('update-downloaded',        ()    => cb()),

  // ── 위젯 이벤트 ──────────────────────────────────────────
  onWidgetMouseMove:  (cb) => ipcRenderer.on('widget-mousemove',  (_, d) => cb(d)),
  onWidgetMouseLeave: (cb) => ipcRenderer.on('widget-mouseleave', (_, d) => cb(d)),
  onWidgetClick:      (cb) => ipcRenderer.on('widget-click',      (_, d) => cb(d)),

  // ── 자동 로그인 ──────────────────────────────────────────
  autoLoginExecute:        (params) => ipcRenderer.invoke('autoLogin:execute', params),
  autoLoginLoadSettings:   ()       => ipcRenderer.invoke('autoLogin:loadSettings'),
  autoLoginSaveSettings:   (data)   => ipcRenderer.invoke('autoLogin:saveSettings', data),
  deleteAutoLoginSettings: ()       => ipcRenderer.invoke('autoLogin:deleteSettings'),
  onAutoLoginStatus: (cb) => {
    const handler = (_, d) => cb(d);
    ipcRenderer.on('autoLogin:status', handler);
    return () => ipcRenderer.removeListener('autoLogin:status', handler);
  },

  // ── 플로팅 메모 ──────────────────────────────────────────
  stickyNotesSave: (notes) => ipcRenderer.invoke('stickyNotes:save', notes),
  stickyNotesLoad: ()      => ipcRenderer.invoke('stickyNotes:load'),

  // ── 앱 종료 전 저장 신호 ──────────────────────────────────
  onBeforeQuit: (cb) => ipcRenderer.on('app:before-quit', () => cb()),

  isElectron: true
});
