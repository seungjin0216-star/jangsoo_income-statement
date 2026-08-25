// ═══════════════════════════════════════════════════════════════════
// 손익계산서 자동화 - 기존 GAS 스크립트에 추가할 코드
// 파일: 고기주문_백석 프로젝트의 GAS (script.google.com)
//
// [사용 방법]
// 1. script.google.com에서 기존 고기주문_백석 GAS 프로젝트 열기
// 2. 이 파일 내용을 기존 Code.gs 아래에 붙여넣기 (또는 새 파일로 추가)
// 3. 기존 doPost() 함수 안에서 아래 주석 위치에 함수 호출 추가
// 4. 변경 후 새 버전으로 배포 (Deploy > Manage deployments)
// ═══════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────
// ★ 스프레드시트 ID (변경 불필요)
// ───────────────────────────────────────────────────────────────────
const PROFIT_SS_ID = '1Vx9e3IkfNaioid2YDmLFeerl8kFgPvMvhrjtrCXTrLE'; // 손익계산서
const STOCK_SS_ID  = '10v0LxS97dofRa_jE7U2gYzwveqrxfGirCD9B-Zuon5o'; // 입고기록

// ───────────────────────────────────────────────────────────────────
// ★ 고기 단가 (보/개 당 원가)
// ───────────────────────────────────────────────────────────────────
const MEAT_PRICES = {
  '곱창':   160000,
  '대창':    30000,
  '막창':    10000,
  '천엽':    20000,
  '간(반)':  10000,
  '간':      20000,
  // '벌집양': 0, // 단가 미확정 → 필요시 추가
};

// ───────────────────────────────────────────────────────────────────
// ★ 음료수 단가 (1케이스/박스 기준)
// ───────────────────────────────────────────────────────────────────
const DRINK_PRICES = {
  '콜라':      23000,
  '사이다':    22000,
  '제로콜라':  21000,
  '파인애플':  20000,
  '웰치스포도':19000,
};

// ───────────────────────────────────────────────────────────────────
// ★ 주류 단가 (1케이스/박스 기준 - 매출처원장 소계 기준)
// ⚠️ 아래 금액을 매출처원장(태경) 실제 소계 금액으로 반드시 확인/수정하세요
// ───────────────────────────────────────────────────────────────────
const LIQUOR_PRICES = {
  '참이슬후래쉬': 35000,  // ← 확인 필요
  '처음처럼':     33000,  // ← 확인 필요
  '새로':         33000,  // ← 확인 필요
  '진로':         33000,  // ← 확인 필요
  '참이슬빨뚜':   35000,  // ← 확인 필요 (참이슬 오리지널)
  '카스':         27000,  // ← 확인 필요
  '테라':         29000,  // ← 확인 필요
  '켈리':         28000,  // ← 확인 필요
  '일품진로':     40000,  // ← 확인 필요
  '복분자':           0,  // 단가 미확정
  '청하':         25000,  // ← 확인 필요
  '매화수':       35000,  // ← 확인 필요
};


// ═══════════════════════════════════════════════════════════════════
// [1] doPost 수정 지침
//
// 기존 doPost() 함수에서 아래와 같이 두 곳에 호출을 추가하세요:
//
//   // (A) type === 'stock' 처리 블록 끝부분에 추가
//   if (data.type === 'stock' && data.branch === 'baeseok') {
//     // ... 기존 입고기록 저장 코드 ...
//     processStockEntry(data);  // ← 이 줄 추가
//   }
//
//   // (B) type === 'food_order' 처리 블록 끝부분에 추가
//   if (data.type === 'food_order') {
//     // ... 기존 식자재발주 저장 코드 ...
//     processFoodOrder(data);   // ← 이 줄 추가
//   }
//
// ═══════════════════════════════════════════════════════════════════


// ───────────────────────────────────────────────────────────────────
// [2] 날짜 파싱 유틸
// ───────────────────────────────────────────────────────────────────

/**
 * 입고기록 날짜 파싱: "26.07.25(토)" → {year:2026, month:7, day:25}
 */
function parseDateStr(dateStr) {
  const m = String(dateStr).match(/^(\d{2})\.(\d{2})\.(\d{2})/);
  if (!m) return null;
  return {
    year:  2000 + parseInt(m[1]),
    month: parseInt(m[2]),
    day:   parseInt(m[3])
  };
}

/**
 * 발주 body에서 날짜 파싱: "[백석점 발주 7/27(일)]\n..." → {year:2026, month:7, day:27}
 */
function parseDateFromBody(body) {
  const m = String(body).match(/발주\s+(\d+)\/(\d+)/);
  if (!m) return null;
  return {
    year:  new Date().getFullYear(),
    month: parseInt(m[1]),
    day:   parseInt(m[2])
  };
}

/**
 * 발주 body 두 번째 줄에서 품목+수량 파싱
 * "카스 2, 테라 1" → {'카스':2, '테라':1}
 */
function parseItemQtysFromBody(body) {
  const lines = String(body).split('\n');
  if (lines.length < 2) return {};
  const itemLine = lines.slice(1).join(' ');
  const result = {};
  const parts = itemLine.split(/[,，]/);
  for (const part of parts) {
    const trimmed = part.trim();
    const match = trimmed.match(/^(.+?)\s+(\d+)$/);
    if (match) {
      const name = match[1].trim();
      const qty  = parseInt(match[2]);
      if (!isNaN(qty)) result[name] = (result[name] || 0) + qty;
    }
  }
  return result;
}


// ───────────────────────────────────────────────────────────────────
// [3] 손익계산서 업데이트 핵심 함수
// ───────────────────────────────────────────────────────────────────

/**
 * 손익계산서 특정 계정 특정 날짜에 금액 기입
 * @param {number} year       - 연도 (예: 2026)
 * @param {number} month      - 월 (1~12)
 * @param {number} day        - 일 (1~31)
 * @param {string} accountName - 계정명 (예: '고기값', '주류원가', '음료원가')
 * @param {number} amount     - 금액 (원)
 * @param {boolean} accumulate - true: 기존값에 더하기, false: 덮어쓰기
 */
function updateProfitSheet(year, month, day, accountName, amount, accumulate) {
  accumulate = (accumulate === undefined) ? true : accumulate;

  const ss = SpreadsheetApp.openById(PROFIT_SS_ID);
  const yy = String(year).slice(2);          // 2026 → "26"
  const tabName = `${yy}년 ${month}월 손익계산서`;
  const sheet = ss.getSheetByName(tabName);

  if (!sheet) {
    Logger.log(`❌ 시트 없음: ${tabName}`);
    return false;
  }

  const data = sheet.getDataRange().getValues();

  // B열(index 1)에서 계정명 검색
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][1]).trim() === accountName) {
      // G열=Day1, Day N → 0-based index = 5+N, 1-based column = 6+N
      const colIdx  = 5 + day;          // 0-based
      const colNum  = colIdx + 1;       // 1-based (getRange용)
      const current = accumulate ? (Number(data[i][colIdx]) || 0) : 0;
      const newVal  = current + amount;

      sheet.getRange(i + 1, colNum).setValue(newVal);
      Logger.log(`✅ [${tabName}] ${accountName} ${day}일 → ${current} + ${amount} = ${newVal}`);
      return true;
    }
  }

  Logger.log(`❌ 계정명 없음: "${accountName}" in ${tabName}`);
  return false;
}


// ───────────────────────────────────────────────────────────────────
// [4] 고기 비용 계산
// ───────────────────────────────────────────────────────────────────

/**
 * 입고 수량으로 고기 원가 계산
 * @param {number} gc     - 곱창 (보)
 * @param {number} dc     - 대창 (보)
 * @param {number} mc     - 막창 (보)
 * @param {Array}  extras - 추가품목 이름 배열 (예: ["천엽", "간(반)"])
 */
function calcMeatCost(gc, dc, mc, extras) {
  let cost = 0;
  cost += (Number(gc) || 0) * (MEAT_PRICES['곱창'] || 0);
  cost += (Number(dc) || 0) * (MEAT_PRICES['대창'] || 0);
  cost += (Number(mc) || 0) * (MEAT_PRICES['막창'] || 0);

  for (const extra of (extras || [])) {
    const name = String(extra).trim();
    if (MEAT_PRICES[name]) {
      cost += MEAT_PRICES[name];
    } else if (name) {
      Logger.log(`⚠️ extras 단가 미설정: "${name}"`);
    }
  }
  return cost;
}


// ───────────────────────────────────────────────────────────────────
// [5] 실시간 입고 처리 (doPost의 type='stock'에서 호출)
// ───────────────────────────────────────────────────────────────────

/**
 * 입고 데이터를 받아 손익계산서 고기값 업데이트
 * doPost에서: processStockEntry(data);
 */
function processStockEntry(data) {
  if (!data || data.branch !== 'baeseok') return;

  const parsed = parseDateStr(String(data.date || ''));
  if (!parsed) {
    Logger.log(`❌ 날짜 파싱 실패: ${data.date}`);
    return;
  }

  const cost = calcMeatCost(
    data.gc, data.dc, data.mc,
    data.extras || []
  );

  Logger.log(`입고 처리: ${data.date} | 곱창${data.gc} 대창${data.dc} 막창${data.mc} extras:${JSON.stringify(data.extras)} → ${cost}원`);

  if (cost > 0) {
    updateProfitSheet(parsed.year, parsed.month, parsed.day, '고기값', cost, true);
  }
}


// ───────────────────────────────────────────────────────────────────
// [6] 식자재 발주(주류/음료) 처리 (doPost의 type='food_order'에서 호출)
// ───────────────────────────────────────────────────────────────────

/**
 * food_order 페이로드에서 주류/음료 원가를 손익계산서에 반영
 * doPost에서: processFoodOrder(data);
 *
 * @param {Object} data - food_order 페이로드
 *   {type:'food_order', branch:'baekseok', messages:[{supplier, body, ...}]}
 */
function processFoodOrder(data) {
  if (!data || !data.messages) return;

  for (const msg of data.messages) {
    const supplier = msg.supplier; // '주류' 또는 '음료수'
    if (supplier !== '주류' && supplier !== '음료수') continue;

    // CC 메시지는 중복 처리 방지 (같은 supplier가 여러 번 올 수 있음)
    // phone이 메인 발주처 전화번호일 때만 처리
    const mainPhone = supplier === '주류' ? '01056079640' : '01037982411';
    if (msg.phone !== mainPhone) continue;

    const body = msg.body || '';
    const date = parseDateFromBody(body);
    if (!date) {
      Logger.log(`❌ 발주 날짜 파싱 실패: ${body.slice(0, 50)}`);
      continue;
    }

    // 품목+수량 파싱
    const qtys = parseItemQtysFromBody(body);
    const prices = supplier === '주류' ? LIQUOR_PRICES : DRINK_PRICES;
    const accountName = supplier === '주류' ? '주류원가' : '음료원가';

    let totalCost = 0;
    for (const [item, qty] of Object.entries(qtys)) {
      const price = prices[item];
      if (price === undefined || price === 0) {
        Logger.log(`⚠️ 단가 없음 (0 처리): ${supplier} - ${item}`);
        continue;
      }
      totalCost += price * qty;
      Logger.log(`  ${item} × ${qty} × ${price} = ${price * qty}원`);
    }

    Logger.log(`발주 처리: ${supplier} | ${date.month}/${date.day} | 총 ${totalCost}원`);

    if (totalCost > 0) {
      updateProfitSheet(date.year, date.month, date.day, accountName, totalCost, true);
    }
  }
}


// ═══════════════════════════════════════════════════════════════════
// [7] 소급 처리 함수 - 한 번만 수동 실행 (입고기록 전체 → 손익계산서)
//
// 사용법:
//   script.google.com → 함수 선택 → backfillMeatCosts → ▶ 실행
// ⚠️  실행 전 손익계산서의 고기값 행이 비어있는지 확인!
//     (이미 수동 입력된 데이터가 있으면 덮어씌워짐)
// ═══════════════════════════════════════════════════════════════════

function backfillMeatCosts() {
  const ss = SpreadsheetApp.openById(STOCK_SS_ID);
  const sheet = ss.getSheetByName('입고기록');

  if (!sheet) {
    Logger.log('❌ 입고기록 시트 없음');
    return;
  }

  const rows = sheet.getDataRange().getValues();
  Logger.log(`입고기록 총 ${rows.length}행 (헤더 포함)`);

  let successCount = 0;
  let skipCount = 0;

  // 1행은 헤더이므로 2행(index 1)부터 처리
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    const dateStr   = String(row[0] || '').trim(); // A: "26.07.25(토)"
    const branch    = String(row[1] || '').trim(); // B: "백석점"
    const gc        = Number(row[2]) || 0;         // C: 곱창 (보)
    const dc        = Number(row[3]) || 0;         // D: 대창 (보)
    const mc        = Number(row[4]) || 0;         // E: 막창 (보)
    // row[5] = F: 박스(개) - 단가 없으므로 무시
    const extrasStr = String(row[6] || '').trim(); // G: "천엽, 간(반)"

    // 백석점만 처리
    if (branch !== '백석점') {
      skipCount++;
      continue;
    }

    // 빈 행 건너뜀
    if (!dateStr) {
      skipCount++;
      continue;
    }

    // 날짜 파싱
    const parsed = parseDateStr(dateStr);
    if (!parsed) {
      Logger.log(`⚠️ 날짜 파싱 실패 (${i+1}행): "${dateStr}"`);
      skipCount++;
      continue;
    }

    // extras 텍스트 → 배열 파싱 ("천엽, 간(반)" → ["천엽", "간(반)"])
    const extras = extrasStr
      ? extrasStr.split(',').map(s => s.trim()).filter(s => s)
      : [];

    // 비용 계산
    const cost = calcMeatCost(gc, dc, mc, extras);

    if (cost === 0) {
      Logger.log(`⚠️ 비용=0 (${i+1}행): ${dateStr} gc=${gc} dc=${dc} mc=${mc} extras=${extras}`);
      skipCount++;
      continue;
    }

    // 손익계산서에 기록 (소급이므로 accumulate=false → 덮어쓰기)
    const ok = updateProfitSheet(parsed.year, parsed.month, parsed.day, '고기값', cost, false);
    if (ok) successCount++;
    else skipCount++;

    // API 호출 제한 방지
    Utilities.sleep(100);
  }

  Logger.log(`\n소급 처리 완료: 성공 ${successCount}건 / 스킵 ${skipCount}건`);
}


// ═══════════════════════════════════════════════════════════════════
// [8] 테스트 함수 (개발/디버그용 - 배포 후 삭제 가능)
// ═══════════════════════════════════════════════════════════════════

/**
 * 손익계산서 단일 셀 업데이트 테스트
 * script.google.com에서 직접 실행해서 확인
 */
function testUpdateProfitSheet() {
  // 예: 2026년 7월 25일 고기값에 100원 기입 (테스트용 - 확인 후 수동 삭제)
  const result = updateProfitSheet(2026, 7, 25, '고기값', 100, false);
  Logger.log(`테스트 결과: ${result}`);
}

/**
 * 날짜 파싱 테스트
 */
function testDateParsing() {
  Logger.log(JSON.stringify(parseDateStr('26.07.25(토)')));
  Logger.log(JSON.stringify(parseDateStr('26.04.27(월)')));
  Logger.log(JSON.stringify(parseDateFromBody('[백석점 발주 7/27(일)]\n카스 2, 테라 1')));
}

/**
 * 발주 body 파싱 테스트
 */
function testBodyParsing() {
  const body = '[백석점 발주 7/27(일)]\n카스 2, 테라 1, 켈리 3';
  Logger.log(JSON.stringify(parseItemQtysFromBody(body)));
  // 기대값: {카스:2, 테라:1, 켈리:3}
}
