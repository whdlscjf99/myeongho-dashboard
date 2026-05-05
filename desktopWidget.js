'use strict';

// 스쿨보드(School Board)의 desktopWidget 모듈을 CommonJS로 변환
// 원본: app.asar/out/main/desktopWidget.js

const { screen } = require('electron');
const koffi = require('koffi');

let user32, kernel32, api, kernel;
let originalWallpaper = '';
let widgetActive = false;
let savedStyle = null;
let savedExStyle = null;
let mouseHook = null;
let hookCbRef = null;
let boundsTimer = null;
let healthCheckTimer = null;
let widgetScaleFactor = 1;
let onDetachCallback = null;
let healthCheckFailureCount = 0;
let pendingWorkerChangeHwnd = null;
let pendingWorkerChangeCount = 0;

const HEALTH_CHECK_MS = 500;
const HEALTH_CHECK_FAIL_THRESHOLD = 2;
const HEALTH_CHECK_WORKER_CHANGE_THRESHOLD = 2;

let widgetHwnd = null;
let winRef = null;
let progmanHwnd = null;
let workerWHwnd = null;
let defViewHwnd = null;
let listViewHwnd = null;
let explorerProcessHandle = null;
let remoteHitTestInfo = null;
let widgetRect = { left: 0, top: 0, right: 0, bottom: 0 };
let widgetHovering = false;
let widgetCapturing = false;
let widgetFocused = false;
let externalDrag = false;
let buttonMask = 0;
let lastPostTs = 0;
let lastHoverX = null;
let lastHoverY = null;
let lastHitTest = { x: null, y: null, result: false, ts: 0 };

const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const SW_SHOW = 5;
const WH_MOUSE_LL = 14;
const WM_MOUSEMOVE = 512;
const WM_LBUTTONDOWN = 513;
const WM_LBUTTONUP = 514;
const WM_RBUTTONDOWN = 516;
const WM_RBUTTONUP = 517;
const WM_MOUSEWHEEL = 522;
const WM_MOUSELEAVE = 675;
const MK_LBUTTON = 1;
const MK_RBUTTON = 2;
const LVM_FIRST = 4096;
const LVM_HITTEST = LVM_FIRST + 18;
const PROCESS_VM_OPERATION = 8;
const PROCESS_VM_READ = 16;
const PROCESS_VM_WRITE = 32;
const MEM_COMMIT = 4096;
const MEM_RESERVE = 8192;
const MEM_RELEASE = 32768;
const PAGE_READWRITE = 4;
const HWND_TOP = 0;
const SWP_NOSIZE = 1;
const SWP_NOMOVE = 2;
const SWP_NOACTIVATE = 16;
const HITTEST_BUFFER_SIZE = 24;
const POINT_BUFFER_SIZE = 8;
const BOUNDS_REFRESH_MS = 120;
const POST_THROTTLE_MS = 8;
const HITTEST_CACHE_MS = 12;

function init() {
  if (api) return true;
  try {
    koffi.proto('intptr __stdcall LLHookProc(int nCode, uintptr wParam, void* lParam)');
    user32 = koffi.load('user32.dll');
    kernel32 = koffi.load('kernel32.dll');
    api = {
      FindWindowW: user32.func('intptr __stdcall FindWindowW(str16, str16)'),
      FindWindowExW: user32.func('intptr __stdcall FindWindowExW(intptr, intptr, str16, str16)'),
      SetParent: user32.func('intptr __stdcall SetParent(intptr, intptr)'),
      ShowWindow: user32.func('bool __stdcall ShowWindow(intptr, int)'),
      SendMessageW: user32.func('intptr __stdcall SendMessageW(intptr, uint, uintptr, intptr)'),
      PostMessageW: user32.func('bool __stdcall PostMessageW(intptr, uint, uintptr, intptr)'),
      GetWindowLongPtrW: user32.func('intptr __stdcall GetWindowLongPtrW(intptr, int)'),
      SetWindowLongPtrW: user32.func('intptr __stdcall SetWindowLongPtrW(intptr, int, intptr)'),
      ScreenToClient: user32.func('bool __stdcall ScreenToClient(intptr, void*)'),
      GetForegroundWindow: user32.func('intptr __stdcall GetForegroundWindow()'),
      GetWindowThreadProcessId: user32.func('uint __stdcall GetWindowThreadProcessId(intptr, void*)'),
      SetFocus: user32.func('intptr __stdcall SetFocus(intptr)'),
      SetForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(intptr)'),
      SetCapture: user32.func('intptr __stdcall SetCapture(intptr)'),
      ReleaseCapture: user32.func('bool __stdcall ReleaseCapture()'),
      AttachThreadInput: user32.func('bool __stdcall AttachThreadInput(uint, uint, bool)'),
      SetWindowsHookExW: user32.func('intptr __stdcall SetWindowsHookExW(int, LLHookProc*, intptr, uint)'),
      UnhookWindowsHookEx: user32.func('bool __stdcall UnhookWindowsHookEx(intptr)'),
      CallNextHookEx: user32.func('intptr __stdcall CallNextHookEx(intptr, int, uintptr, void*)'),
      WindowFromPoint: user32.func('intptr __stdcall WindowFromPoint(int64)'),
      MoveWindow: user32.func('bool __stdcall MoveWindow(intptr, int, int, int, int, bool)'),
      SetWindowPos: user32.func('bool __stdcall SetWindowPos(intptr, intptr, int, int, int, int, uint)'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(intptr, void*)'),
      GetDpiForWindow: user32.func('uint __stdcall GetDpiForWindow(intptr)'),
      IsWindow: user32.func('bool __stdcall IsWindow(intptr)')
    };
    kernel = {
      GetCurrentThreadId: kernel32.func('uint __stdcall GetCurrentThreadId()'),
      OpenProcess: kernel32.func('intptr __stdcall OpenProcess(uint, bool, uint)'),
      VirtualAllocEx: kernel32.func('intptr __stdcall VirtualAllocEx(intptr, intptr, uintptr, uint, uint)'),
      VirtualFreeEx: kernel32.func('bool __stdcall VirtualFreeEx(intptr, intptr, uintptr, uint)'),
      WriteProcessMemory: kernel32.func('bool __stdcall WriteProcessMemory(intptr, intptr, void*, uintptr, intptr)'),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(intptr)')
    };
    return true;
  } catch (e) {
    console.error('desktopWidget: Win32 API 초기화 실패:', e);
    return false;
  }
}

function getHwnd(win) {
  if (!isWindowObjectUsable(win)) return null;
  try {
    return win.getNativeWindowHandle().readInt32LE(0);
  } catch {
    return null;
  }
}

function isWindowObjectUsable(win) {
  return !!win && typeof win.isDestroyed === 'function' && !win.isDestroyed();
}

function clearWidgetRuntimeState() {
  widgetActive = false;
  onDetachCallback = null;
  widgetHovering = false;
  widgetCapturing = false;
  widgetFocused = false;
  externalDrag = false;
  buttonMask = 0;
  resetHealthCheckFailures();
  widgetHwnd = null;
  winRef = null;
  progmanHwnd = null;
  workerWHwnd = null;
  defViewHwnd = null;
  listViewHwnd = null;
  savedStyle = null;
  widgetScaleFactor = 1;
  savedExStyle = null;
  lastHoverX = null;
  lastHoverY = null;
  lastPostTs = 0;
  lastHitTest = { x: null, y: null, result: false, ts: 0 };
}

function isHandleValid(hwnd) {
  if (!hwnd || !api) return false;
  try { return !!api.IsWindow(hwnd); } catch { return false; }
}

function getWindowRectBounds(hwnd) {
  if (!hwnd || !api) return null;
  try {
    const rect = Buffer.alloc(16);
    if (!api.GetWindowRect(hwnd, rect)) return null;
    const left = rect.readInt32LE(0);
    const top = rect.readInt32LE(4);
    const right = rect.readInt32LE(8);
    const bottom = rect.readInt32LE(12);
    return { x: left, y: top, width: right - left, height: bottom - top };
  } catch { return null; }
}

function convertScreenRectToDip(win, rect, fallbackScaleFactor = 1) {
  if (!rect) return null;
  try {
    if (typeof screen?.screenToDipRect === 'function') {
      return screen.screenToDipRect(win || null, rect);
    }
  } catch {}
  const sf = fallbackScaleFactor || 1;
  return {
    x: Math.round(rect.x / sf),
    y: Math.round(rect.y / sf),
    width: Math.round(rect.width / sf),
    height: Math.round(rect.height / sf)
  };
}

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width <= 0 || height <= 0) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function findListView(defView) {
  if (!defView) return null;
  return api.FindWindowExW(defView, 0, 'SysListView32', 'FolderView') ||
    api.FindWindowExW(defView, 0, 'SysListView32', null) || null;
}

function getDesktopHandleSnapshot({ ensureWorkerLayer = false } = {}) {
  const progman = api.FindWindowW('Progman', null);
  if (!progman) return null;
  if (ensureWorkerLayer) {
    api.SendMessageW(progman, 1324, 13, 1);
  }
  let resolvedDefView = api.FindWindowExW(progman, 0, 'SHELLDLL_DefView', null) || null;
  let resolvedListView = findListView(resolvedDefView);
  let shellWorkerW = null;
  let resolvedWorker = null;
  let workerSource = 'unresolved';
  let hwnd = 0;
  while (true) {
    hwnd = api.FindWindowExW(0, hwnd, 'WorkerW', null);
    if (!hwnd) break;
    const workerDefView = api.FindWindowExW(hwnd, 0, 'SHELLDLL_DefView', null);
    if (!workerDefView) continue;
    shellWorkerW = hwnd;
    if (workerDefView && !resolvedDefView) {
      resolvedDefView = workerDefView;
      resolvedListView = findListView(workerDefView);
    }
    resolvedWorker = api.FindWindowExW(0, hwnd, 'WorkerW', null) || null;
    if (resolvedWorker) { workerSource = 'after-defview'; break; }
  }
  if (!resolvedWorker) {
    resolvedWorker = api.FindWindowExW(progman, 0, 'WorkerW', null) || null;
    if (resolvedWorker) workerSource = 'progman-child';
  }
  if (!resolvedDefView && shellWorkerW) {
    resolvedDefView = api.FindWindowExW(shellWorkerW, 0, 'SHELLDLL_DefView', null) || null;
    resolvedListView = findListView(resolvedDefView);
  }
  return { progmanHwnd: progman, workerWHwnd: resolvedWorker, defViewHwnd: resolvedDefView, listViewHwnd: resolvedListView, workerSource };
}

function applyDesktopHandles(handles) {
  progmanHwnd = handles?.progmanHwnd || null;
  workerWHwnd = handles?.workerWHwnd || null;
  defViewHwnd = handles?.defViewHwnd || null;
  listViewHwnd = handles?.listViewHwnd || null;
}

function resolveDesktopHandles() {
  const handles = getDesktopHandleSnapshot({ ensureWorkerLayer: true });
  if (!handles?.progmanHwnd) return false;
  applyDesktopHandles(handles);
  return !!workerWHwnd;
}

function resetHealthCheckFailures() {
  healthCheckFailureCount = 0;
  pendingWorkerChangeHwnd = null;
  pendingWorkerChangeCount = 0;
}

function trackPendingWorkerChange(workerHwnd) {
  if (!workerHwnd) { pendingWorkerChangeHwnd = null; pendingWorkerChangeCount = 0; return 0; }
  if (pendingWorkerChangeHwnd !== workerHwnd) { pendingWorkerChangeHwnd = workerHwnd; pendingWorkerChangeCount = 1; }
  else { pendingWorkerChangeCount += 1; }
  return pendingWorkerChangeCount;
}

function bringWidgetToTop() {
  if (!widgetHwnd || !api?.SetWindowPos) return;
  try { api.SetWindowPos(widgetHwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE); } catch {}
}

function ensureHitTestResources() {
  if (!listViewHwnd) return false;
  if (explorerProcessHandle && remoteHitTestInfo) return true;
  const pidBuffer = Buffer.alloc(4);
  api.GetWindowThreadProcessId(listViewHwnd, pidBuffer);
  const pid = pidBuffer.readUInt32LE(0);
  if (!pid) return false;
  explorerProcessHandle = kernel.OpenProcess(PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE, false, pid);
  if (!explorerProcessHandle) { explorerProcessHandle = null; return false; }
  remoteHitTestInfo = kernel.VirtualAllocEx(explorerProcessHandle, 0, HITTEST_BUFFER_SIZE, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
  if (!remoteHitTestInfo) { kernel.CloseHandle(explorerProcessHandle); explorerProcessHandle = null; return false; }
  return true;
}

function cleanupHitTestResources() {
  if (remoteHitTestInfo && explorerProcessHandle) kernel.VirtualFreeEx(explorerProcessHandle, remoteHitTestInfo, 0, MEM_RELEASE);
  if (explorerProcessHandle) kernel.CloseHandle(explorerProcessHandle);
  explorerProcessHandle = null;
  remoteHitTestInfo = null;
}

function refreshBounds() {
  if (!widgetHwnd || !api) return;
  try {
    const rect = Buffer.alloc(16);
    if (api.GetWindowRect(widgetHwnd, rect)) {
      widgetRect.left = rect.readInt32LE(0);
      widgetRect.top = rect.readInt32LE(4);
      widgetRect.right = rect.readInt32LE(8);
      widgetRect.bottom = rect.readInt32LE(12);
    }
  } catch {}
}

function isPointInWidget(x, y) {
  return x >= widgetRect.left && x < widgetRect.right && y >= widgetRect.top && y < widgetRect.bottom;
}

function canRouteDesktopInput() {
  const fg = api.GetForegroundWindow();
  return !fg || fg === progmanHwnd || fg === workerWHwnd || fg === widgetHwnd;
}

function isDesktopOrWidgetHwnd(hwnd) {
  if (!hwnd) return true;
  if (hwnd === progmanHwnd || hwnd === workerWHwnd || hwnd === widgetHwnd) return true;
  if (hwnd === defViewHwnd || hwnd === listViewHwnd) return true;
  return false;
}

function createPointBuffer(x, y) {
  const point = Buffer.alloc(POINT_BUFFER_SIZE);
  point.writeInt32LE(x, 0);
  point.writeInt32LE(y, 4);
  return point;
}

function packPoint(x, y) {
  return ((y & 65535) << 16 | x & 65535) >>> 0;
}

function toClientPoint(hwnd, screenX, screenY) {
  const point = createPointBuffer(screenX, screenY);
  const ok = api.ScreenToClient(hwnd, point);
  if (!ok) return null;
  return { x: point.readInt32LE(0), y: point.readInt32LE(4) };
}

function isDesktopIconAtPoint(screenX, screenY) {
  if (!listViewHwnd) return false;
  if (!ensureHitTestResources()) return false;
  const now = Date.now();
  if (lastHitTest.x === screenX && lastHitTest.y === screenY && now - lastHitTest.ts < HITTEST_CACHE_MS) return lastHitTest.result;
  const clientPoint = toClientPoint(listViewHwnd, screenX, screenY);
  if (!clientPoint) return false;
  const hitTestInfo = Buffer.alloc(HITTEST_BUFFER_SIZE);
  hitTestInfo.writeInt32LE(clientPoint.x, 0);
  hitTestInfo.writeInt32LE(clientPoint.y, 4);
  const wrote = kernel.WriteProcessMemory(explorerProcessHandle, remoteHitTestInfo, hitTestInfo, HITTEST_BUFFER_SIZE, 0);
  if (!wrote) return false;
  const hitIndex = Number(api.SendMessageW(listViewHwnd, LVM_HITTEST, 0, remoteHitTestInfo));
  const result = hitIndex >= 0;
  lastHitTest = { x: screenX, y: screenY, result, ts: now };
  return result;
}

function focusWidget() {
  try {
    if (!widgetHwnd || !api) return;
    // 이미 포그라운드 윈도우면 SetFocus만
    const fg = api.GetForegroundWindow ? api.GetForegroundWindow() : 0;
    if (fg === widgetHwnd) {
      try { api.SetFocus(widgetHwnd); } catch {}
      winRef?.webContents?.focus();
      return;
    }
    // OS 레벨 키보드 포커스: explorer thread attach 후 SetFocus
    if (listViewHwnd) {
      try {
        const explorerTid = api.GetWindowThreadProcessId(listViewHwnd, null);
        const myTid = kernel.GetCurrentThreadId();
        if (explorerTid && myTid && explorerTid !== myTid) {
          api.AttachThreadInput(myTid, explorerTid, true);
          api.SetFocus(widgetHwnd);
          api.AttachThreadInput(myTid, explorerTid, false);
        } else {
          api.SetFocus(widgetHwnd);
        }
      } catch {
        try { api.SetFocus(widgetHwnd); } catch {}
      }
    }
    winRef?.focus();
    winRef?.webContents?.focus();
  } catch {}
}

function sendMouseLeave() {
  if (!widgetHwnd) return;
  lastHoverX = null;
  lastHoverY = null;
  setImmediate(() => {
    try { winRef?.webContents?.send('widget-mouseleave', {}); } catch {}
  });
}

function updateButtonMaskOnDown(msg) {
  if (msg === WM_LBUTTONDOWN) buttonMask |= MK_LBUTTON;
  if (msg === WM_RBUTTONDOWN) buttonMask |= MK_RBUTTON;
}

function updateButtonMaskOnUp(msg) {
  if (msg === WM_LBUTTONUP) buttonMask &= ~MK_LBUTTON;
  if (msg === WM_RBUTTONUP) buttonMask &= ~MK_RBUTTON;
}

function postWidgetMouse(msg, screenX, screenY, mouseData = 0) {
  if (!widgetHwnd) return;
  if (msg === WM_MOUSEWHEEL) {
    const rawDelta = mouseData >>> 16 & 65535;
    const deltaY = rawDelta > 32767 ? rawDelta - 65536 : rawDelta;
    const clientPoint2 = toClientPoint(widgetHwnd, screenX, screenY);
    if (!clientPoint2) return;
    setImmediate(() => {
      try { winRef?.webContents?.send('widget-wheel', { x: clientPoint2.x, y: clientPoint2.y, deltaY }); } catch {}
    });
    return;
  }
  if (msg === WM_MOUSEMOVE) {
    const clientPoint2 = toClientPoint(widgetHwnd, screenX, screenY);
    if (!clientPoint2) return;
    setImmediate(() => {
      try { winRef?.webContents?.send('widget-mousemove', { x: clientPoint2.x, y: clientPoint2.y }); } catch {}
    });
    return;
  }
  const clientPoint = toClientPoint(widgetHwnd, screenX, screenY);
  if (!clientPoint) return;
  // LBUTTONDOWN 시 renderer에 좌표 알려서 click 이벤트 직접 dispatch
  // → 주석: PostMessageW로 이미 클릭 전달하므로 widget-click IPC는 불필요 (중복 실행 방지)
  // if (msg === WM_LBUTTONDOWN) {
  //   setImmediate(() => {
  //     try {
  //       winRef?.webContents?.send('widget-click', { x: clientPoint.x, y: clientPoint.y });
  //     } catch {}
  //   });
  // }
  api.PostMessageW(widgetHwnd, msg, buttonMask & 65535, packPoint(clientPoint.x, clientPoint.y));
}

function callNextMouseHook(nCode, wParam, lParam) {
  try { return api.CallNextHookEx(mouseHook, nCode, wParam, lParam); } catch { return 0; }
}

function attachToWorkerLayer() {
  if (!widgetHwnd) return false;
  if (!workerWHwnd && !resolveDesktopHandles()) {
    // WorkerW 없음 → Progman에 직접 붙이기 (폴백)
    if (!progmanHwnd) return false;
    try {
      api.SetParent(widgetHwnd, progmanHwnd);
      api.ShowWindow(widgetHwnd, SW_SHOW);
      bringWidgetToTop();
      workerWHwnd = progmanHwnd; // 이후 코드에서 progmanHwnd를 workerWHwnd로 사용
      console.log('[desktopWidget] Progman 폴백으로 부착');
      return true;
    } catch(e) {
      console.error('desktopWidget: Progman 폴백 실패:', e);
      return false;
    }
  }
  try {
    api.SetParent(widgetHwnd, workerWHwnd);
    api.ShowWindow(widgetHwnd, SW_SHOW);
    bringWidgetToTop();
    return true;
  } catch (e) {
    console.error('desktopWidget: WorkerW 삽입 실패:', e);
    return false;
  }
}

function installMouseHook() {
  if (mouseHook) return;
  const hookFn = (nCode, wParam, lParam) => {
    if (nCode < 0 || !widgetActive || !widgetHwnd) return callNextMouseHook(nCode, wParam, lParam);
    try {
      const msg = Number(wParam);
      const relevant = msg === WM_MOUSEMOVE || msg === WM_LBUTTONDOWN || msg === WM_LBUTTONUP ||
        msg === WM_RBUTTONDOWN || msg === WM_RBUTTONUP || msg === WM_MOUSEWHEEL;
      if (!relevant) return callNextMouseHook(nCode, wParam, lParam);
      const screenX = koffi.decode(lParam, 0, 'int32');
      const screenY = koffi.decode(lParam, 4, 'int32');
      const mouseData = Number(koffi.decode(lParam, 8, 'uint32'));
      const inWidget = isPointInWidget(screenX, screenY);
      const isDown = msg === WM_LBUTTONDOWN || msg === WM_RBUTTONDOWN;
      const isUp = msg === WM_LBUTTONUP || msg === WM_RBUTTONUP;
      if (isDown) updateButtonMaskOnDown(msg);
      if (isUp) updateButtonMaskOnUp(msg);
      if (isUp && externalDrag) { externalDrag = false; return callNextMouseHook(nCode, wParam, lParam); }
      if (externalDrag) return callNextMouseHook(nCode, wParam, lParam);
      if (msg === WM_MOUSEWHEEL) {
        if (inWidget) {
          const wfp = api.WindowFromPoint((screenY >>> 0) * 4294967296 + (screenX >>> 0));
          if (!isDesktopOrWidgetHwnd(wfp)) return callNextMouseHook(nCode, wParam, lParam);
          postWidgetMouse(msg, screenX, screenY, mouseData);
          return 1;
        }
        return callNextMouseHook(nCode, wParam, lParam);
      }
      if (widgetCapturing) {
        if (msg === WM_MOUSEMOVE) {
          const now = Date.now();
          if (now - lastPostTs >= POST_THROTTLE_MS) {
            lastPostTs = now;
            const cp = toClientPoint(widgetHwnd, screenX, screenY);
            if (cp) api.PostMessageW(widgetHwnd, msg, buttonMask & 65535, packPoint(cp.x, cp.y));
          }
          return callNextMouseHook(nCode, wParam, lParam);
        }
        if (isUp) {
          postWidgetMouse(msg, screenX, screenY, mouseData);
          if (!buttonMask) {
            widgetCapturing = false;
            try { api.ReleaseCapture(); } catch {}
            if (widgetFocused) {
              widgetFocused = false;
              try { api.PostMessageW(widgetHwnd, WM_MOUSELEAVE, 0, 0); } catch {}
            }
            if (!inWidget) { widgetHovering = false; sendMouseLeave(); }
          }
          return 1;
        }
        postWidgetMouse(msg, screenX, screenY, mouseData);
        return 1;
      }
      if (msg === WM_MOUSEMOVE) {
        if (inWidget) {
          widgetHovering = true;
          const dx = lastHoverX !== null ? Math.abs(screenX - lastHoverX) : Infinity;
          const dy = lastHoverY !== null ? Math.abs(screenY - lastHoverY) : Infinity;
          if (dx > 2 || dy > 2) {
            if (lastHoverX !== null) {
              const now = Date.now();
              if (now - lastPostTs >= POST_THROTTLE_MS) {
                lastPostTs = now;
                lastHoverX = screenX;
                lastHoverY = screenY;
                postWidgetMouse(msg, screenX, screenY, mouseData);
              }
            } else { lastHoverX = screenX; lastHoverY = screenY; }
          }
        } else if (widgetHovering) { widgetHovering = false; sendMouseLeave(); }
        return callNextMouseHook(nCode, wParam, lParam);
      }
      if (!inWidget || !canRouteDesktopInput()) {
        if (isDown) { externalDrag = true; widgetFocused = false; }
        if (widgetHovering) { widgetHovering = false; sendMouseLeave(); }
        return callNextMouseHook(nCode, wParam, lParam);
      }
      if (isDesktopIconAtPoint(screenX, screenY)) {
        if (isDown) { externalDrag = true; widgetFocused = false; }
        if (widgetHovering) { widgetHovering = false; sendMouseLeave(); }
        return callNextMouseHook(nCode, wParam, lParam);
      }
      if (isDown) {
        const hwndAtPoint = api.WindowFromPoint((screenY >>> 0) * 4294967296 + (screenX >>> 0));
        if (!isDesktopOrWidgetHwnd(hwndAtPoint)) {
          externalDrag = true;
          widgetFocused = false;
          if (widgetHovering) { widgetHovering = false; sendMouseLeave(); }
          return callNextMouseHook(nCode, wParam, lParam);
        }
      }
      widgetHovering = true;
      if (isDown) {
        widgetCapturing = true;
        widgetFocused = true;
        sendMouseLeave();
        lastHoverX = null;
        lastHoverY = null;
        focusWidget();
        try { api.SetCapture(widgetHwnd); } catch {}
        postWidgetMouse(msg, screenX, screenY, mouseData);
        return 1;
      }
      if (isUp) { postWidgetMouse(msg, screenX, screenY, mouseData); return 1; }
      if (msg === WM_MOUSEWHEEL) { postWidgetMouse(msg, screenX, screenY, mouseData); return 1; }
      return callNextMouseHook(nCode, wParam, lParam);
    } catch { return callNextMouseHook(nCode, wParam, lParam); }
  };
  hookCbRef = koffi.register(hookFn, koffi.pointer('LLHookProc'));
  mouseHook = api.SetWindowsHookExW(WH_MOUSE_LL, hookCbRef, 0, 0);
  if (!mouseHook) {
    console.error('desktopWidget: 마우스 훅 설치 실패');
    if (hookCbRef) { koffi.unregister(hookCbRef); hookCbRef = null; }
    return;
  }
  boundsTimer = setInterval(refreshBounds, BOUNDS_REFRESH_MS);
}

function uninstallMouseHook() {
  if (widgetCapturing) { try { api.ReleaseCapture(); } catch {} widgetCapturing = false; }
  if (boundsTimer) { clearInterval(boundsTimer); boundsTimer = null; }
  if (mouseHook) { api.UnhookWindowsHookEx(mouseHook); mouseHook = null; }
  if (hookCbRef) { koffi.unregister(hookCbRef); hookCbRef = null; }
}

function stopHealthCheck() {
  if (healthCheckTimer) { clearInterval(healthCheckTimer); healthCheckTimer = null; }
  resetHealthCheckFailures();
}

function startHealthCheck() {
  stopHealthCheck();
  resetHealthCheckFailures();
  healthCheckTimer = setInterval(() => {
    if (!widgetActive || !widgetHwnd) return;

    // 마우스 훅 유실 감지 - 핸들이 있어도 실제로 유효한지 확인
    if (!mouseHook) {
      console.warn('[desktopWidget] 마우스 훅 유실 감지 - 재등록 시도');
      try { installMouseHook(); } catch(e) { console.error('[desktopWidget] 훅 재등록 실패:', e.message); }
      return;
    }

    const latestHandles = getDesktopHandleSnapshot();
    const latestWorker = latestHandles?.workerWHwnd || null;
    const currentWorkerValid = isHandleValid(workerWHwnd);
    const widgetHandleValid = isHandleValid(widgetHwnd);
    const workerChangeThreshold = latestHandles?.workerSource === 'progman-child' ? 1 : HEALTH_CHECK_WORKER_CHANGE_THRESHOLD;
    if (!widgetHandleValid) return;
    if (latestWorker && latestWorker !== workerWHwnd) {
      const changeCount = trackPendingWorkerChange(latestWorker);
      if (changeCount >= workerChangeThreshold) { resetHealthCheckFailures(); reattachToDesktop(); }
      return;
    }
    trackPendingWorkerChange(null);
    if (!currentWorkerValid) {
      if (latestWorker) {
        const changeCount = trackPendingWorkerChange(latestWorker);
        if (changeCount >= workerChangeThreshold) { resetHealthCheckFailures(); reattachToDesktop(); }
        return;
      }
      healthCheckFailureCount += 1;
      if (healthCheckFailureCount >= HEALTH_CHECK_FAIL_THRESHOLD) { resetHealthCheckFailures(); reattachToDesktop(); }
      return;
    }
    if (!latestHandles) return;
    const listViewChanged = latestHandles.listViewHwnd !== listViewHwnd;
    const handlesChanged = latestHandles.progmanHwnd !== progmanHwnd || latestHandles.defViewHwnd !== defViewHwnd || listViewChanged;
    if (handlesChanged) {
      applyDesktopHandles(latestHandles);
      if (listViewChanged) { cleanupHitTestResources(); ensureHitTestResources(); }
    }
    resetHealthCheckFailures();
  }, HEALTH_CHECK_MS);
}

function reattachToDesktop() {
  if (!widgetActive || !widgetHwnd || !winRef) return;
  const hwnd = widgetHwnd;
  const win = winRef;
  const savedPos = { left: widgetRect.left, top: widgetRect.top, right: widgetRect.right, bottom: widgetRect.bottom };
  const savedW = savedPos.right - savedPos.left;
  const savedH = savedPos.bottom - savedPos.top;
  uninstallMouseHook();
  cleanupHitTestResources();
  try { api.SetParent(hwnd, 0); } catch {}
  progmanHwnd = null; workerWHwnd = null; defViewHwnd = null; listViewHwnd = null;
  if (!resolveDesktopHandles()) {
    console.error('desktopWidget: 재부착 실패');
    widgetActive = false; widgetHwnd = null; winRef = null;
    if (onDetachCallback) { try { onDetachCallback(); } catch {} }
    return;
  }
  if (!attachToWorkerLayer()) {
    console.error('desktopWidget: 재부착 실패 - WorkerW 삽입 실패');
    widgetActive = false; widgetHwnd = null; winRef = null;
    if (onDetachCallback) { try { onDetachCallback(); } catch {} }
    return;
  }
  const point = createPointBuffer(savedPos.left, savedPos.top);
  if (api.ScreenToClient(workerWHwnd, point)) {
    api.MoveWindow(hwnd, point.readInt32LE(0), point.readInt32LE(4), savedW, savedH, true);
    bringWidgetToTop();
  }
  refreshBounds();
  ensureHitTestResources();
  installMouseHook();
  startHealthCheck();
  console.log('desktopWidget: 재부착 성공');
}

function enable(win, options = {}) {
  if (!init()) { console.error('desktopWidget: init() 실패'); return false; }
  // 배경화면 저장 후 검정으로 변경
try {
  const SystemParametersInfoW = user32.func('__stdcall', 'SystemParametersInfoW', 'bool', ['uint32', 'uint32', 'void*', 'uint32']);
  const SPI_GETDESKWALLPAPER = 0x0073;
  const SPI_SETDESKWALLPAPER = 0x0014;
  const SPIF_UPDATEINIFILE   = 0x0001;
  const SPIF_SENDCHANGE      = 0x0002;
  const buf = Buffer.alloc(520);
  SystemParametersInfoW(SPI_GETDESKWALLPAPER, 260, buf, 0);
  originalWallpaper = buf.toString('utf16le').replace(/\0/g, '');
  console.log('[desktopWidget] 기존 배경화면:', originalWallpaper);
  const emptyBuf = Buffer.from('\0\0', 'binary');
  SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, emptyBuf, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE);
  console.log('[desktopWidget] 배경화면 검정으로 변경');
} catch(e) {
  console.warn('[desktopWidget] 배경화면 변경 실패:', e.message);
}
  if (widgetActive) return true;
  if (!isWindowObjectUsable(win)) return false;
  try {
    if (!resolveDesktopHandles()) {
      console.error('desktopWidget: 데스크탑 레이어를 찾을 수 없음');
      return false;
    }
    const hwnd = getHwnd(win);
    savedStyle = Number(api.GetWindowLongPtrW(hwnd, GWL_STYLE));
    savedExStyle = Number(api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
    widgetHwnd = hwnd;
    winRef = win;
    widgetActive = true;
    console.log('[desktopWidget] widgetActive 설정됨:', widgetActive);
    onDetachCallback = options.onDetach || null;
    widgetHovering = false; widgetCapturing = false; widgetFocused = false;
    externalDrag = false; resetHealthCheckFailures(); buttonMask = 0; lastPostTs = 0;
    lastHitTest = { x: null, y: null, result: false, ts: 0 };
    refreshBounds();
    ensureHitTestResources();
    const rawScreenBoundsBeforeAttach = getWindowRectBounds(hwnd);
    const preservedBounds = normalizeBounds(options.preservedBounds);
    const boundsBeforeAttach = preservedBounds || win.getBounds();
    widgetScaleFactor = getScaleFactor();
    if (!attachToWorkerLayer()) {
      console.error('desktopWidget: WorkerW 삽입 실패');
      widgetActive = false; widgetHwnd = null; winRef = null;
      cleanupHitTestResources();
      return false;
    }
    const sf = widgetScaleFactor;
    const targetScreenBounds = rawScreenBoundsBeforeAttach || {
      x: boundsBeforeAttach.x, y: boundsBeforeAttach.y,
      width: Math.round(boundsBeforeAttach.width),
      height: Math.round(boundsBeforeAttach.height)
    };
    const point = createPointBuffer(targetScreenBounds.x, targetScreenBounds.y);
    if (api.ScreenToClient(workerWHwnd, point)) {
      api.MoveWindow(hwnd, point.readInt32LE(0), point.readInt32LE(4), targetScreenBounds.width, targetScreenBounds.height, true);
      bringWidgetToTop();
    }
    refreshBounds();
    installMouseHook();
    startHealthCheck();
    console.log('[desktopWidget] 바탕화면 위젯 활성화 완료');
    return true;
  } catch (e) {
    console.error('desktopWidget: 활성화 실패:', e);
    cleanupHitTestResources();
    return false;
  }
}

function disable(win) {
  if (!widgetActive || !api) return false;
  try {
    stopHealthCheck();
    uninstallMouseHook();
    cleanupHitTestResources();
    if (!isWindowObjectUsable(win)) { clearWidgetRuntimeState(); return false; }
    const hwnd = getHwnd(win);
    if (!hwnd) { clearWidgetRuntimeState(); return false; }
    const sf = widgetScaleFactor;
    const rect = Buffer.alloc(16);
    let screenBounds = null;
    if (api.GetWindowRect(hwnd, rect)) {
      const rawRect = {
        x: rect.readInt32LE(0), y: rect.readInt32LE(4),
        width: rect.readInt32LE(8) - rect.readInt32LE(0),
        height: rect.readInt32LE(12) - rect.readInt32LE(4)
      };
      screenBounds = convertScreenRectToDip(win, rawRect, sf);
    }
    api.SetParent(hwnd, 0);
	// 배경화면 복원
try {
  const SystemParametersInfoW = user32.func('__stdcall', 'SystemParametersInfoW', 'bool', ['uint32', 'uint32', 'void*', 'uint32']);
  const SPI_SETDESKWALLPAPER = 0x0014;
  const SPIF_UPDATEINIFILE   = 0x0001;
  const SPIF_SENDCHANGE      = 0x0002;
  if (originalWallpaper) {
    const wpBuf = Buffer.from(originalWallpaper + '\0', 'utf16le');
    SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, wpBuf, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE);
    console.log('[desktopWidget] 배경화면 복원:', originalWallpaper);
  }
} catch(e) {
  console.warn('[desktopWidget] 배경화면 복원 실패:', e.message);
}
    if (savedStyle !== null) api.SetWindowLongPtrW(hwnd, GWL_STYLE, savedStyle);
    if (savedExStyle !== null) api.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, savedExStyle);
    api.ShowWindow(hwnd, SW_SHOW);
    if (screenBounds) win.setBounds(screenBounds);
    clearWidgetRuntimeState();
    console.log('[desktopWidget] 위젯 모드 해제');
    return true;
  } catch (e) {
    console.error('desktopWidget: 해제 실패:', e);
    clearWidgetRuntimeState();
    return false;
  }
}

function isActive() { return widgetActive; }

function getScaleFactor() {
  if (widgetActive && widgetScaleFactor !== 1) return widgetScaleFactor;
  if (!widgetHwnd || !api) return 1;
  try {
    const dpi = api.GetDpiForWindow(widgetHwnd);
    return dpi > 0 ? dpi / 96 : 1;
  } catch { return 1; }
}

module.exports = { enable, disable, isActive, getScaleFactor, focusWidget };
