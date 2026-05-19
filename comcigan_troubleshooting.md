# 컴시간 검색 문제 해결 가이드

## 문제 1: "Flask 서버가 실행 중인지 확인하세요" 알림

### 원인
Electron 환경에서도 `fetch()`는 CORS 정책을 따릅니다.
Flask 서버가 실행 중이어도, Electron → localhost:5001 요청 시 CORS 에러가 발생할 수 있습니다.

### 해결 방법 1: Flask 서버 CORS 헤더 확인
`comcigan_api.py`에 다음이 있는지 확인:
```python
from flask_cors import CORS
app = Flask(__name__)
CORS(app)  # 이 줄이 있어야 함
```

### 해결 방법 2: Flask 서버 실행 확인
1. CMD에서 Flask 서버 실행:
```bash
python comcigan_api.py
```

2. 서버가 실행되면 다음 메시지가 나타남:
```
 * Running on http://127.0.0.1:5001
```

3. 브라우저에서 테스트:
```
http://127.0.0.1:5001/api/health
```
→ `{"success": true, "status": "running"}` 응답이 와야 함

### 해결 방법 3: main.js에서 CORS 우회 (권장)

`main.js`에 다음 코드 추가:

```javascript
// BrowserWindow 생성 부분에 추가
const mainWindow = new BrowserWindow({
  // ... 기존 설정
  webPreferences: {
    webSecurity: false,  // CORS 비활성화 (개발 중에만)
    // ... 나머지 설정
  }
});

// 또는 session에서 CORS 헤더 추가
const { session } = require('electron');
session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Access-Control-Allow-Origin': ['*']
    }
  });
});
```

---

## 문제 2: IP설정/학교설정 버튼 폰트 크기

### 현재 상태
코드 확인 결과, **이미 수정되어 있습니다:**
```html
<button style="font-size:1em; display:flex; gap:6px;">
  <span style="font-size:0.95em;">⚙️</span>
  <span>IP 설정</span>
</button>
```

### 확인 방법
1. 앱 **완전 재시작** (Ctrl+Q 후 다시 실행)
2. 캐시 삭제 (Ctrl+Shift+Delete)
3. 최신 dashboard.html 파일이 적용되었는지 확인

---

## 테스트 순서

### 1단계: Flask 서버 실행
```bash
cd C:\Users\user\Desktop\dashboard-electron
python comcigan_api.py
```

### 2단계: 서버 작동 확인
브라우저에서:
```
http://127.0.0.1:5001/api/health
http://127.0.0.1:5001/api/timetable/teacher?name=조인
```

### 3단계: Electron 앱 실행
```bash
npm start
```

### 4단계: 컴시간 검색
- 시간표 설정 → 컴시간 연동
- "조인" 입력 → 🔍 클릭

---

## 에러 메시지별 해결

### "Failed to fetch"
→ Flask 서버가 실행되지 않음
→ `python comcigan_api.py` 실행

### "CORS 에러"
→ `comcigan_api.py`에 `CORS(app)` 추가
→ 또는 main.js에서 `webSecurity: false`

### "교사를 찾을 수 없습니다"
→ 컴시간 서버에 등록된 정확한 이름 입력
→ 예: "조인철" 전체 또는 "조인" 부분

---

## 임시 해결책 (빠른 테스트)

main.js 수정:
```javascript
webPreferences: {
  webSecurity: false,  // 이 줄 추가
  nodeIntegration: false,
  contextIsolation: true,
  // ...
}
```

저장 후 `npm start` 재실행
