# 컴시간 API 테스트 가이드

## ✅ 최종 통합 완료!

dashboard.html이 Flask API를 사용하도록 수정되었습니다.

## 테스트 방법

### 1단계: 필요 패키지 설치
```bash
pip install flask flask-cors comcigan
```

### 2단계: Flask 서버 실행
```bash
python comcigan_api.py
```

서버가 정상 실행되면:
```
컴시간 시간표 API 서버 시작...
포트: 5001
 * Running on http://127.0.0.1:5001
```

### 3단계: dashboard.html 열기
브라우저에서 `dashboard.html` 파일을 엽니다.

### 4단계: 컴시간 검색 테스트
1. 시간표 설정 → 컴시간 연동 설정
2. 성함 입력 (예: "조인")
3. 🔍 버튼 클릭
4. 시간표가 표시되어야 함

## 수정된 내용

### JavaScript 함수 변경
- `searchComciganTeacher()`: Flask API 호출로 변경
- `showTeacherSelectionFromAPI()`: 동명이인 선택 UI
- `selectTeacherFromAPI()`: 선택된 교사 시간표 조회
- `displayTimetableFromAPI()`: 시간표 테이블 렌더링

### API 엔드포인트
- `GET http://127.0.0.1:5001/api/timetable/teacher?name=교사명`

### 응답 형식
```javascript
// 단일 결과
{
  "success": true,
  "data": {
    "school": "명호중학교",
    "teacher": "조인철",
    "timetable": {
      "월": [{"period": 1, "subject": "기술", "location": "101"}, ...],
      ...
    }
  }
}

// 동명이인
{
  "success": true,
  "multiple": true,
  "teachers": [
    {"name": "조인철", "display": "조인철 (기술)"},
    {"name": "조인*", "display": "조인* (과학)"}
  ]
}
```

## 문제 해결

### CORS 에러 발생 시
→ Flask 서버가 실행 중인지 확인 (`python comcigan_api.py`)

### "교사를 찾을 수 없습니다" 에러
→ 컴시간 서버에 등록된 정확한 이름으로 검색 (예: "조인철" 전체 또는 "조인" 일부)

### Flask 서버 연결 실패
→ 방화벽에서 5001 포트 허용 또는 비활성화
