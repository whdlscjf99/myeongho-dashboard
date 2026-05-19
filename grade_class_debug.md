# 학년반 저장 문제 디버깅 가이드

## 문제 증상
2학년 5반을 선택하고 저장해도 "1학년 7반으로 저장되었습니다"라고 표시됨

## 원인 분석

### 가능성 1: 브라우저 캐시
- 이전 HTML 파일이 캐시되어 있음
- **해결:** Ctrl+Shift+Delete → 캐시 삭제 → 앱 재시작

### 가능성 2: select 요소 렌더링 타이밍
- 모달이 열릴 때 select가 완전히 렌더링되기 전에 값을 읽음
- **해결:** 이미 `setTimeout` 적용됨

### 가능성 3: 이전 localStorage 값
- localStorage에 이미 `1학년 7반`이 저장되어 있음
- **해결:** localStorage 초기화

## 디버깅 방법

### 1단계: F12 Console 열기
앱 실행 → F12 → Console 탭

### 2단계: localStorage 확인
```javascript
console.log('저장된 학년:', localStorage.getItem('timetable_grade'));
console.log('저장된 반:', localStorage.getItem('timetable_class'));
```

### 3단계: localStorage 초기화
```javascript
localStorage.removeItem('timetable_grade');
localStorage.removeItem('timetable_class');
```

### 4단계: 다시 테스트
1. 시간표 설정 모달 열기
2. 2학년 5반 선택
3. 저장 버튼 클릭
4. Console에서 로그 확인:
```
[학년반 저장] grade: 2 classNum: 5
```

### 5단계: 실시간 확인
저장 버튼 클릭 후 즉시:
```javascript
console.log('저장된 학년:', localStorage.getItem('timetable_grade'));
console.log('저장된 반:', localStorage.getItem('timetable_class'));
```

## 예상 결과

### 정상인 경우:
```
[학년반 저장] gradeSelect: <select>
[학년반 저장] classSelect: <select>
[학년반 저장] grade: 2 classNum: 5
토스트: "2학년 5반으로 저장되었습니다"
```

### 문제가 있는 경우:
```
[학년반 저장] gradeSelect: <select>
[학년반 저장] classSelect: <select>
[학년반 저장] grade: 1 classNum: 7
토스트: "1학년 7반으로 저장되었습니다"
```
→ select의 `.value`가 실제 선택한 값이 아닌 기본값을 반환

## 해결책

### 임시 해결책: 직접 localStorage 설정
```javascript
localStorage.setItem('timetable_grade', '2');
localStorage.setItem('timetable_class', '5');
location.reload();
```

### 근본 해결책: 앱 완전 재시작
1. Ctrl+Q (앱 종료)
2. 파일 탐색기에서 dashboard.html 최신 버전 확인
3. `npm start` 재실행
4. Ctrl+Shift+Delete → 캐시 삭제
5. 다시 테스트
