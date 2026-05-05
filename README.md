# 명호중 대시보드 — Electron 버전

Lively Wallpaper + Python 헬퍼 서버 구조를 Electron 단일 앱으로 이식한 버전입니다.

---

## 구조 변경 요약

| 항목 | 기존 (Lively) | Electron |
|------|-------------|---------|
| 실행 방법 | Lively Wallpaper + run_server.vbs 별도 실행 | .exe 하나만 실행 |
| 데이터 저장 | Python HTTP 서버 → dashboard_savedata.json | Node.js fs 직접 → AppData\Roaming\myeonho-dashboard\ |
| 시작프로그램 등록 | 시작프로그램_등록.vbs 수동 실행 | 설치 시 자동 (NSIS 인스톨러) |
| 트레이 상주 | 없음 | 있음 (닫기 → 트레이 최소화) |
| 배포 | 파일 폴더 복사 | 단일 .exe 인스톨러 |

---

## 개발 환경 설정

### 1. Node.js 설치

https://nodejs.org 에서 LTS 버전 설치 (v20 이상 권장)

### 2. 프로젝트 초기화

```bash
cd dashboard-electron
npm install
```

### 3. 개발 모드 실행

```bash
npm start
```

앱이 실행되면 우측 상단 트레이 아이콘도 함께 표시됩니다.

---

## 빌드 (배포용 .exe 생성)

```bash
npm run build
```

`dist/` 폴더에 `명호중 대시보드 Setup 1.0.0.exe` 인스톨러가 생성됩니다.

빌드 없이 폴더 형태로만 확인하려면:

```bash
npm run build:dir
```

---

## 프로젝트 파일 구조

```
dashboard-electron/
├── main.js                  ← Electron 메인 프로세스
│                               (앱 시작, 창 생성, IPC 핸들러, 트레이)
├── preload.js               ← contextBridge
│                               (renderer에 electronAPI 노출)
├── package.json             ← 프로젝트 설정 및 빌드 설정
├── README.md
└── renderer/
    ├── dashboard.html       ← 기존 HTML 최소 수정본
    └── icon.ico             ← 앱 아이콘 (선택사항)
```

---

## 데이터 저장 위치

앱 실행 중 저장 파일 위치:

```
C:\Users\[사용자명]\AppData\Roaming\myeonho-dashboard\dashboard_savedata.json
```

트레이 아이콘 우클릭 → **데이터 파일 위치 열기** 로도 바로 접근 가능합니다.

---

## HTML 수정 내용 (패치 설명)

기존 `dashboard_100_final.html` 대비 변경된 부분은 딱 **3곳**입니다.

### 변경 1 — IPC 브릿지 삽입 (~4179줄 전후)

`const HELPER_API_BASE` 선언 직전에 Electron 감지 + `helperRequest()` 오버라이드 코드 삽입.

- `IS_ELECTRON = !!(window.electronAPI?.isElectron)` 로 환경 감지
- `helperRequest()` 내부에서 IS_ELECTRON일 때 fetch 대신 `window.electronAPI.*` 호출
- Lively 환경에서는 `window.electronAPI`가 undefined이므로 기존 HTTP 방식 그대로 동작

### 변경 2 — helperConnected 초기값

```js
// 기존
let helperConnected = false;

// 변경
let helperConnected = IS_ELECTRON ? true : false;
```

Electron에서는 파일 I/O가 항상 가능하므로 초기부터 connected 상태로 처리.

### 변경 3 — initHelperWithRetry 분기

Electron 환경에서 HTTP 재시도 루프를 건너뛰고 IPC로 즉시 로드.

---

## 아이콘 추가 방법

`renderer/icon.ico` 파일을 배치하면 앱 아이콘과 트레이 아이콘으로 사용됩니다.  
없어도 앱 실행에는 지장 없습니다 (기본 Electron 아이콘 사용).

PNG → ICO 변환: https://convertio.co/png-ico/

---

## 자주 묻는 것

**Q. 기존 Lively 버전과 데이터를 공유할 수 있나요?**  
A. `dashboard_savedata.json` 파일을 복사하면 됩니다.  
기존 파일 위치(대시보드 폴더) → `%AppData%\myeonho-dashboard\` 에 붙여넣기.

**Q. 배경화면으로도 쓸 수 있나요?**  
A. 가능합니다. `main.js`에서 `frame: false`와 함께 `BrowserWindow`를 최하단 레이어로 설정하는 코드를 추가하면 됩니다. 다만 Lively Wallpaper처럼 바탕화면과 완전히 통합되지는 않습니다.

**Q. 자동 시작 설정은 어디서 하나요?**  
A. NSIS 인스톨러로 설치하면 시작 메뉴 등록은 자동입니다.  
Windows 시작프로그램 등록은 `app.setLoginItemSettings({ openAtLogin: true })`를 main.js에 추가하면 됩니다.
