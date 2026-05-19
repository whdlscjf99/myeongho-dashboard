/**
 * 배포용 빌드 스크립트
 * 개인 정보 제거 → 빌드 → 원본 복원
 * 
 * 사용법: npm run build:release
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;

// ── 제거할 localStorage 키 (개인 정보) ──────────────────────
// dashboard.html의 LocalStorage 초기화 코드에 반영
const CLEAR_LS_KEYS = [
  // 컴시간 교사 개인 정보 (학교코드는 유지 - 다른 선생님도 사용)
  'comcigan_teacher',
  'comcigan_teacher_fullname',
  'comcigan_teacher_idx',
  'comcigan_ip',
  'comcigan_port',
  // 시간표 개인 데이터
  'teacher_class_schedule',
  'timetable_grade',
  'timetable_class',
  'timetable_last_update',
  'timetable_last_timestamp',
  // 개인 캘린더 ID (공휴일 캘린더는 HARDCODED_CONFIG에 있으므로 유지)
  'teacher_gcal_work_calendar_id',
  'teacher_gcal_academic_calendar_id',
  'teacher_gcal_calendar_id',
  'teacher_gcal_api_key',
  // D-DAY (코드에 DEFAULT_DDAY_ITEM 기본값 있으므로 지워도 자동 복원됨)
  'teacher_dday_items',
  'teacher_dday_index',
  // 기타 개인 설정
  'gsheet_default_browser',
];

// ── 유지하는 localStorage 키 (공용/기본값) ──────────────────
// - teacher_meal_office_code  (C10 - 부산 교육청)
// - teacher_meal_school_code  (7201025 - 명호중)
// - teacher_meal_api_key      (NEIS OPEN API 공용 키)
// - comcigan_sccode            (명호중학교 학교코드 - 공용)
// - teacher_gcal_holiday_calendar_id (공휴일 캘린더)

// ── savedata.json 초기값 ────────────────────────────────────
const CLEAN_SAVEDATA = {
  memo_text: '',
  local_date_tasks: [],
  auto_checked: {},
  saved_at: '',
  onboardingCompleted: false,
  settings: {}
};

// ── dashboard.html에서 제거할 localStorage 초기화 코드 삽입 ─
// DOMContentLoaded 이전에 실행되는 초기화 스크립트로 삽입
const LS_CLEAR_SCRIPT = `
  <!-- 배포용: 개인 정보 localStorage 초기화 (빌드 시 삽입) -->
  <script>
  (function() {
    var keysToRemove = ${JSON.stringify(CLEAR_LS_KEYS, null, 4)};
    keysToRemove.forEach(function(k) { localStorage.removeItem(k); });
    console.log('[build] 개인 정보 localStorage 초기화 완료');
  })();
  </script>`;

// ── 파일 경로 ───────────────────────────────────────────────
const DATA_DIR = path.join(require('os').homedir(), 'AppData', 'Roaming', 'myeonho-dashboard');
const SAVEDATA_FILE   = path.join(ROOT, 'dashboard_savedata.json');
const HTML_FILE       = path.join(ROOT, 'renderer', 'dashboard.html');
const MAIN_FILE       = path.join(ROOT, 'main.js');
const SAVEDATA_BACKUP = path.join(ROOT, 'dashboard_savedata.backup.json');
const HTML_BACKUP     = path.join(ROOT, 'renderer', 'dashboard.html.backup');
const MAIN_BACKUP     = path.join(ROOT, 'main.js.backup');

// AppData 폴더의 개인정보 파일들
const AUTOLOGIN_FILE       = path.join(DATA_DIR, 'autologin_settings.json');
const APPDATA_SAVEDATA     = path.join(DATA_DIR, 'dashboard_savedata.json');
const AUTOLOGIN_BACKUP     = path.join(DATA_DIR, 'autologin_settings.json.bak');
const APPDATA_SAVEDATA_BAK = path.join(DATA_DIR, 'dashboard_savedata.json.bak');

function log(msg) { console.log(`[build-release] ${msg}`); }

function step1_backup() {
  log('1단계: 원본 파일 백업');
  
  // 프로젝트 파일 백업
  if (fs.existsSync(SAVEDATA_FILE)) {
    fs.copyFileSync(SAVEDATA_FILE, SAVEDATA_BACKUP);
    log('  ✅ savedata 백업');
  }
  fs.copyFileSync(HTML_FILE, HTML_BACKUP);
  log('  ✅ dashboard.html 백업');
  fs.copyFileSync(MAIN_FILE, MAIN_BACKUP);
  log('  ✅ main.js 백업');
  
  // AppData 폴더 개인정보 파일 백업
  if (fs.existsSync(AUTOLOGIN_FILE)) {
    fs.copyFileSync(AUTOLOGIN_FILE, AUTOLOGIN_BACKUP);
    log('  ✅ AppData autologin_settings.json 백업');
  }
  if (fs.existsSync(APPDATA_SAVEDATA)) {
    fs.copyFileSync(APPDATA_SAVEDATA, APPDATA_SAVEDATA_BAK);
    log('  ✅ AppData dashboard_savedata.json 백업');
  }
}

function step2_clean() {
  log('2단계: 개인 정보 제거');

  // 프로젝트 루트 savedata 초기화
  fs.writeFileSync(SAVEDATA_FILE, JSON.stringify(CLEAN_SAVEDATA, null, 2), 'utf-8');
  log('  ✅ dashboard_savedata.json 초기화');

  // AppData 폴더 개인정보 파일 임시 삭제
  if (fs.existsSync(AUTOLOGIN_FILE)) {
    fs.unlinkSync(AUTOLOGIN_FILE);
    log('  ✅ AppData autologin_settings.json 삭제');
  }
  if (fs.existsSync(APPDATA_SAVEDATA)) {
    fs.unlinkSync(APPDATA_SAVEDATA);
    log('  ✅ AppData dashboard_savedata.json 삭제');
  }

  // main.js DEFAULT_SCHOOL.sccode 제거 (명호중학교 학교코드는 첫 검색 시 자동 캐싱되므로 배포 시 null)
  let mainJs = fs.readFileSync(MAIN_FILE, 'utf-8');
  mainJs = mainJs.replace(
    /const DEFAULT_SCHOOL = \{ name: '명호중학교', sccode: .+? \};/,
    "const DEFAULT_SCHOOL = { name: '명호중학교', sccode: null };"
  );
  fs.writeFileSync(MAIN_FILE, mainJs, 'utf-8');
  log('  ✅ main.js DEFAULT_SCHOOL.sccode 초기화');

  // dashboard.html에 localStorage 초기화 스크립트 삽입
  let html = fs.readFileSync(HTML_FILE, 'utf-8');
  const insertBefore = '</head>';
  if (html.includes(insertBefore)) {
    html = html.replace(insertBefore, LS_CLEAR_SCRIPT + '\n' + insertBefore);
    fs.writeFileSync(HTML_FILE, html, 'utf-8');
    log(`  ✅ dashboard.html에 localStorage 초기화 스크립트 삽입 (${CLEAR_LS_KEYS.length}개 키)`);
  } else {
    log('  ⚠️  </head> 태그 없음 - 스크립트 삽입 실패');
  }
}

function step3_build() {
  log('3단계: 빌드 실행');
  try {
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
    log('  ✅ 빌드 완료');
  } catch(e) {
    log('  ❌ 빌드 실패 - 원본 복원 후 종료');
    step4_restore();
    process.exit(1);
  }
}

function step4_restore() {
  log('4단계: 원본 파일 복원');
  
  // 프로젝트 파일 복원
  if (fs.existsSync(SAVEDATA_BACKUP)) {
    fs.copyFileSync(SAVEDATA_BACKUP, SAVEDATA_FILE);
    fs.unlinkSync(SAVEDATA_BACKUP);
    log('  ✅ savedata 복원');
  }
  if (fs.existsSync(HTML_BACKUP)) {
    fs.copyFileSync(HTML_BACKUP, HTML_FILE);
    fs.unlinkSync(HTML_BACKUP);
    log('  ✅ dashboard.html 복원');
  }
  if (fs.existsSync(MAIN_BACKUP)) {
    fs.copyFileSync(MAIN_BACKUP, MAIN_FILE);
    fs.unlinkSync(MAIN_BACKUP);
    log('  ✅ main.js 복원');
  }
  
  // AppData 폴더 개인정보 파일 복원
  if (fs.existsSync(AUTOLOGIN_BACKUP)) {
    fs.copyFileSync(AUTOLOGIN_BACKUP, AUTOLOGIN_FILE);
    fs.unlinkSync(AUTOLOGIN_BACKUP);
    log('  ✅ AppData autologin_settings.json 복원');
  }
  if (fs.existsSync(APPDATA_SAVEDATA_BAK)) {
    fs.copyFileSync(APPDATA_SAVEDATA_BAK, APPDATA_SAVEDATA);
    fs.unlinkSync(APPDATA_SAVEDATA_BAK);
    log('  ✅ AppData dashboard_savedata.json 복원');
  }
}

function step5_backupAppData() {
  log('5단계: AppData 전체 백업 (테스트용)');
  
  const BACKUP_DIR = path.join(require('os').homedir(), 'Desktop', 'dashboard-backup');
  
  if (!fs.existsSync(DATA_DIR)) {
    log('  ⚠️  AppData 폴더 없음 - 백업 건너뜀');
    return;
  }
  
  try {
    // 백업 폴더가 이미 있으면 삭제
    if (fs.existsSync(BACKUP_DIR)) {
      fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
    }
    
    // 전체 복사
    fs.cpSync(DATA_DIR, BACKUP_DIR, { recursive: true });
    log(`  ✅ AppData 백업 완료: ${BACKUP_DIR}`);
  } catch(e) {
    log(`  ⚠️  백업 실패: ${e.message}`);
  }
}

function step6_cleanAppData() {
  log('6단계: AppData 완전 삭제 (초기 상태 테스트용)');
  
  if (!fs.existsSync(DATA_DIR)) {
    log('  ✅ AppData 폴더 없음 - 이미 깨끗함');
    return;
  }
  
  try {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    log('  ✅ AppData 완전 삭제 완료');
    log('  ℹ️  이제 설치 파일을 실행하면 완전 초기 상태로 테스트할 수 있습니다');
  } catch(e) {
    log(`  ⚠️  삭제 실패: ${e.message}`);
    log('  ℹ️  수동으로 삭제하거나 관리자 권한으로 실행하세요');
  }
}

// ── 실행 ──────────────────────────────────────────────────
(async () => {
  log('=== 배포용 빌드 시작 ===\n');
  log('【유지】급식코드/컴시간학교코드/공휴일캘린더/스프레드시트URL');
  log('【제거】교사이름/시간표/개인캘린더ID/메모/일정\n');

  try {
    step1_backup();
    step2_clean();
    step3_build();
  } finally {
    step4_restore();
  }
  
  // 빌드 성공 시에만 백업+삭제
  log('');
  step5_backupAppData();
  step6_cleanAppData();

  log('\n=== 완료! ===');
  log('📦 dist/ 폴더에 설치 파일 생성됨');
  log('💾 바탕화면/dashboard-backup에 데이터 백업됨');
  log('🗑️  AppData 삭제됨 (초기 상태)');
  log('\n다음 단계:');
  log('  1. dist/설치파일.exe 실행');
  log('  2. 앱 실행하여 초기 상태 확인');
  log('  3. restore-dashboard-data.bat 실행 (데이터 복원)');
})();
