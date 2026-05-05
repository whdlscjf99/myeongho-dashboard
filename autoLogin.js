'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const CHROME_USER_DATA = path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
const EDGE_USER_DATA   = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data');
const PORTAL_URL       = 'https://pen.eduptl.kr/';
const TOTAL_TIMEOUT_MS = 3 * 60 * 1000; // 전체 3분 타임아웃

const TARGET_CONFIG = {
  neis:    {
    menuText: '나이스',
    label: '나이스',
    popupHandler: handleNeisPopups,
    finalUrl: 'pen.neis.go.kr/jsp/main.jsp',
    waitSelector: '#wrap, #container, .main-content, #gnb',
  },
  edufine: {
    menuText: 'K-에듀파인',
    label: 'K-에듀파인',
    popupHandler: handleEdufinePopups,
    finalUrl: null,
    waitSelector: '#mainframe, .MainFrame, iframe',
  },
};

// ── 프로필 복사 ───────────────────────────────────────────
function copyBrowserProfile(userData, browser = 'chrome') {
  const srcUserData = browser === 'edge' ? EDGE_USER_DATA : CHROME_USER_DATA;
  const profileDir  = browser === 'edge' ? 'edge-profile' : 'chrome-profile';
  const tempProfile = path.join(userData, 'profiles', profileDir);
  const srcDefault  = path.join(srcUserData, 'Default');
  const dstDefault  = path.join(tempProfile, 'Default');

  if (!fs.existsSync(srcUserData))
    throw new Error(`${browser === 'edge' ? 'Edge' : 'Chrome'} User Data 경로를 찾을 수 없습니다:\n${srcUserData}`);

  const isFirst = !fs.existsSync(dstDefault);
  if (isFirst) {
    fs.mkdirSync(dstDefault, { recursive: true });
    const localState = path.join(srcUserData, 'Local State');
    if (fs.existsSync(localState)) {
      try { fs.copyFileSync(localState, path.join(tempProfile, 'Local State')); } catch {}
    }
    for (const f of ['Cookies', 'Login Data', 'Web Data', 'Preferences', 'Secure Preferences', 'Bookmarks']) {
      const src = path.join(srcDefault, f);
      if (fs.existsSync(src)) try { fs.copyFileSync(src, path.join(dstDefault, f)); } catch {}
    }
  } else {
    for (const f of ['Preferences', 'Secure Preferences']) {
      const src = path.join(srcDefault, f);
      if (fs.existsSync(src)) try { fs.copyFileSync(src, path.join(dstDefault, f)); } catch {}
    }
  }

  // 락 파일 전체 제거 (비정상 종료 후 재실행 대비)
  for (const lock of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lockfile']) {
    try { fs.rmSync(path.join(tempProfile, lock), { force: true }); } catch {}
    try { fs.rmSync(path.join(dstDefault, lock), { force: true }); } catch {}
  }

  // exit_type 정상 처리
  for (const f of ['Preferences', 'Secure Preferences']) {
    const p = path.join(dstDefault, f);
    if (!fs.existsSync(p)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      data.profile = { ...(data.profile || {}), exit_type: 'Normal', exited_cleanly: true };
      fs.writeFileSync(p, JSON.stringify(data));
    } catch {}
  }

  return tempProfile;
}

// ── 팝업 핸들러 ──────────────────────────────────────────
async function handleNeisPopups(page) {
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const closeSelectors = [
      '.cl-dialog-close', '.cl-popup-close', '.ui-dialog-titlebar-close',
      'button[title="닫기"]', 'button[aria-label="닫기"]', '.popClose', '.btn-close',
    ];
    for (let i = 0; i < 10; i++) {
      let closed = false;
      for (const sel of closeSelectors) {
        try {
          const btn = await page.$(sel);
          if (btn && await btn.isVisible().catch(() => false)) {
            await btn.click();
            await page.waitForTimeout(300);
            closed = true;
            break;
          }
        } catch {}
      }
      if (!closed) break;
    }
  } catch {}
}

async function handleEdufinePopups(page) {
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    try {
      await Promise.race([
        page.waitForSelector('#mainframe',  { timeout: 20000 }),
        page.waitForSelector('.MainFrame', { timeout: 20000 }),
        page.waitForSelector('iframe',     { timeout: 20000 }),
      ]);
      await page.waitForTimeout(2000);
    } catch {
      await page.waitForTimeout(3000);
    }
    for (let t = 0; t < 16; t++) {
      try {
        const overlay = await page.$('.nexamodaloverlay');
        if (overlay && await overlay.isVisible()) break;
      } catch {}
      await page.waitForTimeout(500);
    }
    for (let i = 0; i < 10; i++) {
      try {
        const overlay = await page.$('.nexamodaloverlay');
        if (!overlay || !await overlay.isVisible()) break;
        const btn = await page.$('.btn_POP_Close') || await page.$('.btn_POP_Confirm');
        if (btn && await btn.isVisible()) { await btn.click(); await page.waitForTimeout(500); }
        else break;
      } catch { break; }
    }
  } catch {}
}

// ── 소속교 선택 팝업 ─────────────────────────────────────
async function handleSchoolSelectionPopup(page, neisOrder) {
  if (!neisOrder || neisOrder < 1) return;
  try {
    await page.waitForTimeout(2000);
    const radios = await page.$$(".swal2-radio input[type='radio']");
    if (!radios.length || neisOrder > radios.length) return;
    await radios[neisOrder - 1].evaluate(el => el.click());
    await page.waitForTimeout(1000);
    await page.click('.swal2-confirm', { timeout: 5000 }).catch(() => page.keyboard.press('Enter'));
    await page.waitForTimeout(2000);
  } catch {}
}

// ── 성공 알림 ────────────────────────────────────────────
async function showSuccessAlert(page) {
  try {
    await page.evaluate(() => {
      document.getElementById('__dashboardSuccess')?.remove();
      const div = Object.assign(document.createElement('div'), { id: '__dashboardSuccess' });
      div.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
        'background:#4CAF50;color:#fff;border-radius:12px;z-index:10000;font-size:14px;' +
        'min-width:400px;padding:24px 32px;box-shadow:0 4px 20px rgba(0,0,0,.3);text-align:center;cursor:pointer;';
      div.innerHTML = '<div style="font-weight:bold;font-size:13pt;line-height:2;">✅ 로그인 완료!<br>' +
        '<span style="font-size:10pt;opacity:.85;">클릭하거나 10초 후 자동으로 사라집니다.</span></div>';
      document.body.appendChild(div);
      div.onclick = () => div.remove();
      setTimeout(() => div.remove(), 10000);
    });
  } catch {}
}


// ── 메인 실행 함수 ────────────────────────────────────────
async function executeAutoLogin({ userData, certName, password, neisOrder = 0, targetSystem, browser = 'chrome', onStatus }) {
  const { chromium } = require('playwright');
  const target = TARGET_CONFIG[targetSystem];
  if (!target) throw new Error(`지원하지 않는 대상: ${targetSystem}`);

  const send = (step, msg) => { try { onStatus?.(step, msg); } catch {} };
  let context = null;

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('전체 실행 시간 초과 (3분). 네트워크 상태를 확인하세요.')), TOTAL_TIMEOUT_MS)
  );

  // 브라우저 채널 설정
  const browserChannel = browser === 'edge' ? 'msedge' : 'chrome';

  const mainTask = async () => {
    send('profile', '브라우저 프로필 준비 중...');
    const tempProfile = copyBrowserProfile(userData, browser);

    send('launch', `${browser === 'edge' ? 'Edge' : 'Chrome'} 실행 중...`);
    context = await chromium.launchPersistentContext(tempProfile, {
      headless: false,
      channel: browserChannel,
      args: [
        '--profile-directory=Default',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=PrivateNetworkAccessForNavigations,InfiniteSessionRestore',
        '--disable-web-security',
        '--allow-running-insecure-content',
        '--test-type',
        '--start-maximized',
        '--disable-session-crashed-bubble',
        '--hide-crash-restore-bubble',
        '--noerrdialogs',
      ],
      ignoreHTTPSErrors: true,
      ignoreDefaultArgs: ['--enable-automation', '--no-sandbox'],
      viewport: null,
    });

    const page = context.pages()[0] || await context.newPage();
    page.on('dialog', d => d.accept().catch(() => {}));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver',  { get: () => undefined });
      Object.defineProperty(navigator, 'languages',  { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });
    });

    send('navigate', '업무포털 접속 중...');
    await page.goto(PORTAL_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // 로그인 버튼
    send('login', '로그인 버튼 클릭 중...');
    let clicked = false;
    for (let i = 0; i < 3; i++) {
      try { await page.click('#btnLgn', { timeout: 30000 }); clicked = true; await page.waitForTimeout(1500); break; }
      catch { if (i < 2) await page.waitForTimeout(3000); }
    }
    if (!clicked) throw new Error('로그인 버튼 클릭 실패 - 업무포털 접속을 확인하세요.');

    // 인증서 선택
    send('cert', `인증서 선택 중: ${certName}`);
    try {
      await page.click(`//div[contains(@title, '${certName}')]`, { timeout: 30000 });
      await page.waitForTimeout(500);
    } catch {
      throw new Error(`인증서를 찾을 수 없습니다: "${certName}"\n인증서 이름을 확인하세요.`);
    }

    // 비밀번호 입력
    send('password', '비밀번호 입력 중...');
    const pwSel = "#kc_content_default > table > tbody > tr > td:nth-child(2) > div > div:nth-child(2) > table > tbody > tr > td:nth-child(2) > input";
    try {
      await page.waitForSelector(pwSel, { timeout: 30000 });
      await page.fill(pwSel, '');
      await page.type(pwSel, password, { delay: 30 });
      await page.waitForTimeout(1000);
    } catch {
      throw new Error('비밀번호 입력 실패 - 인증서 창 선택자가 변경되었을 수 있습니다.');
    }

    // 확인 버튼
    send('confirm', '확인 버튼 클릭 중...');
    const confirmSel = "#kc_dialog_default > form > div > div.kc-buttons-layout > button.kc-btn-blue";
    try {
      await page.click(confirmSel, { timeout: 30000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
      await page.waitForSelector("//a[@class='menuBtn']", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(500);
    } catch {
      throw new Error('확인 버튼 클릭 실패 - 비밀번호가 틀렸거나 인증서 창 구조가 변경되었을 수 있습니다.');
    }

    // 소속교 선택
    if (neisOrder > 0) send('school', '소속교 선택 중...');
    await handleSchoolSelectionPopup(page, neisOrder);

    // 대상 시스템 진입
    send('target', `${target.label} 진입 중...`);
    let success = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const pagesBefore = context.pages().length;
        await page.click(`//a[@class='menuBtn' and text()='${target.menuText}']`, { timeout: 30000 });
        await page.waitForTimeout(3000);
        const allPages = context.pages();
        let targetPage = allPages.length > pagesBefore ? allPages[allPages.length - 1] : page;

        // 나이스: SSO 인증 중간 페이지(idp1-pen.neis.go.kr) → 실제 메인(pen.neis.go.kr) 이동 대기
        if (target.finalUrl) {
          send('navigate', `${target.label} 메인 페이지 이동 중...`);
          try {
            await targetPage.waitForURL(`**/${target.finalUrl}**`, { timeout: 30000 });
          } catch {
            // URL 매칭 실패 시 waitSelector로 대기
            await targetPage.waitForSelector(target.waitSelector, { timeout: 20000 }).catch(() => {});
          }
        } else {
          await targetPage.waitForLoadState('domcontentloaded').catch(() => {});
        }

        send('popup', '공지 팝업 처리 중...');
        await target.popupHandler(targetPage);
        await showSuccessAlert(targetPage);
        success = true;
        break;
      } catch {
        if (attempt === 0) {
          let popupCount = 0;
          while (popupCount < 5) {
            try {
              const closeBtn = await page.$('.btn-3x, .pop-bottom-close');
              if (closeBtn) { await closeBtn.click(); popupCount++; await page.waitForTimeout(500); }
              else break;
            } catch { break; }
          }
        }
      }
    }
    if (!success) throw new Error(`${target.label} 메뉴 진입 실패 - 업무포털 로그인은 됐으나 메뉴를 찾지 못했습니다.`);
    send('done', '✅ 로그인 완료!');
  };

  try {
    await Promise.race([mainTask(), timeoutPromise]);
  } catch (err) {
    // context 누수 방지: 오류 발생해도 반드시 종료
    if (context) {
      try { await context.close(); } catch {}
    }
    throw err;
  }
}

module.exports = { executeAutoLogin };
