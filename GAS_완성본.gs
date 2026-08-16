/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  [장수한우 손익계산서] GAS 자동화 - 드라이브 배치 처리                   ║
 * ║  Gemini 무료 (500회/일) · 완전 무료                                  ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  역할: 웹앱 이미지 수신 저장 + Drive 파일 → Gemini 분석 → 스프레드시트  ║
 * ║  실행: 매일 오전 2시 자동 (setupTriggers로 최초 1회 설정)               ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

// ============================================================
// ⚙️ 설정
// ============================================================
// ⚠️ API 키는 코드에 직접 쓰지 않습니다.
//    GAS 편집기 좌측 [프로젝트 설정] > [스크립트 속성]에
//    속성 이름 GEMINI_API_KEY / 값 = 발급받은 키  를 추가하세요.
//    이렇게 하면 코드를 공유하거나 백업해도 키가 노출되지 않습니다.
const GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
const GEMINI_MODEL   = "gemini-2.5-flash";

const TIMEZONE = 'Asia/Seoul';

// ── 월별 시트의 기준일 셀 ──
// 이 칸의 날짜가 "이 시트가 다루는 달"을 결정한다.
// 시트 안의 수식 475개가 $B$7 을 참조하므로 위치를 옮기지 않는다.
//   B7  = 그 달의 1일
//   A51 = EOMONTH(B7,0)      그 달 말일
//   A52 = MIN(A51, TODAY())  말일과 오늘 중 이른 날
//   F6, G11:AK11 등 = DAY(EOMONTH($B$7,0)) 로 그 달의 일수를 구함
const BASE_DATE_CELL = 'B7';

/** 스크립트 속성에 키가 없으면 즉시 알려준다 (조용히 실패하는 것을 막기 위함) */
function assertApiKey_() {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY가 설정되지 않았습니다.\n" +
      "GAS 편집기 > 프로젝트 설정 > 스크립트 속성에서 " +
      "GEMINI_API_KEY 를 추가해주세요."
    );
  }
  return GEMINI_API_KEY;
}

/** 설정이 제대로 됐는지 확인용 — 편집기에서 이 함수만 실행해보세요 */
function checkApiKey() {
  var key = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!key) {
    Logger.log("❌ 스크립트 속성에 GEMINI_API_KEY가 없습니다.");
    return;
  }
  Logger.log("✅ 키 등록됨 (길이 " + key.length + "자, 앞 6자 " + key.substring(0, 6) + ")");
  var res = UrlFetchApp.fetch(
    "https://generativelanguage.googleapis.com/v1beta/models?key=" + key,
    { muteHttpExceptions: true }
  );
  Logger.log(res.getResponseCode() === 200
    ? "✅ Gemini API 연결 정상"
    : "❌ Gemini 응답 " + res.getResponseCode() + " : " + res.getContentText().substring(0, 200));
}

const BRANCH_CONFIG = {
  "원당점": {
    ssId:         "15Jb5FL1uK41Tc_S2b3OKE5x_RKj-IAlZolp6HvQGyPM",
    folderId:     "1yO48tVJZGxLn3f5Pbq2NyzSk9bF-VElJ",
    naverSheetId: "1c4W2bVa9co5YifTe5wldaN4m-LrJD9TlCmQmY-l8LRI"
  },
  "백석점": {
    ssId:         "1Vx9e3IkfNaioid2YDmLFeerl8kFgPvMvhrjtrCXTrLE",
    folderId:     "1NtjeodX-BDrqO9orzSdtj92_xEefQGoB",
    naverSheetId: "1uNE-4JXgb1DSWz28XQpJq8ZF-0eB2fIjVe-oAn-uQe4"
  }
};

const SHEET_HEADERS = ["날짜", "분류", "항목명", "금액", "지점", "원본파일명", "처리시각", "파일ID"];
const COL_FILE_ID   = 8;


// ════════════════════════════════════════════════════════════
// 👔 직원 급여 관리 (알바계산기 앱의 「직원」 탭이 여기를 부른다)
//
//  왜 여기에 있나
//    알바 데이터는 알바계산기 백엔드(별도 스프레드시트)에 있다.
//    직원을 거기 끼워넣으면 알바 계산 로직·세금(3.3%)·근무표와 엉킨다.
//    그래서 저장소를 물리적으로 분리했다. 직원 코드에 문제가 생겨도
//    알바 데이터는 다른 스프레드시트에 있어서 영향을 받을 수 없다.
//
//  알바와의 차이
//    알바 : 시급 × 근무시간 + 주휴수당  → 매달 계산이 필요
//    직원 : 월급 고정                   → 한 번 등록하면 끝
//
//  분류를 나눈 이유
//    알바급여 → '인건비'    (기존 그대로. 손익계산서 29행)
//    직원급여 → '직원급여'  (신규.      손익계산서 28행)
//    같은 분류를 쓰면 28행과 29행이 같은 값을 읽어 인건비가 2배가 된다.
//
//  지급 처리가 없는 이유
//    직원 급여는 매달 반드시 나간다. "이번 달 줬나?" 를 체크할 일이 없다.
//    그래서 명부에 재직 중이면 그 달 인건비에 자동으로 잡힌다.
//    알바처럼 지급완료를 누를 필요가 없다.
//
//  입사 연월이 비어 있어도 된다
//    오래 다닌 직원은 정확한 입사일을 모르는 경우가 많다.
//    비워두면 "예전부터 재직 중" 으로 보고 모든 달에 포함한다.
//
//  저장 위치 — 지점별 손익계산서에 각각
//    백석점 손익계산서 > 직원명부   ← 백석 직원만
//    원당점 손익계산서 > 직원명부   ← 원당 직원만
//    id | 이름 | 지점 | 월급 | 시작연월 | 종료연월 | 메모
//
//    한 곳에 몰아넣지 않는 이유
//      지점 데이터는 그 지점 파일 안에서 끝나야 한다.
//      나중에 원당을 백석 양식으로 갈아끼울 때도 통째로 옮기면 된다.
//      백석 파일이 잘못돼도 원당 직원 명부는 무사하다.
// ════════════════════════════════════════════════════════════

var STAFF_TAB      = '직원명부';
var STAFF_CATEGORY = '직원급여';                      // 지출및매출로그 분류

var STAFF_HEADERS  = ['id', '이름', '지점', '월급', '시작연월', '종료연월', '메모'];

function staffRouter_(data) {
  try {
    switch (data.action) {
      case 'staffList'  : return jsonOut_({ ok: true, data: staffList_() });
      case 'staffSave'  : return jsonOut_(staffSave_(data.staff));
      case 'staffSync'  : return jsonOut_(staffSyncAll_(data.ym));
      default:
        return jsonOut_({ ok: false, error: '알 수 없는 action: ' + data.action });
    }
  } catch (err) {
    Logger.log('❌ 직원 API 오류: ' + err.message);
    return jsonOut_({ ok: false, error: err.message });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
                       .setMimeType(ContentService.MimeType.JSON);
}

/** 그 지점 스프레드시트의 직원명부 탭 (없으면 헤더와 함께 만든다) */
function staffSheet_(branchName) {
  var config = BRANCH_CONFIG[branchName];
  if (!config) throw new Error('알 수 없는 지점: ' + branchName);

  var ss = SpreadsheetApp.openById(config.ssId);
  var sh = ss.getSheetByName(STAFF_TAB);
  if (!sh) {
    sh = ss.insertSheet(STAFF_TAB);
    sh.appendRow(STAFF_HEADERS);
    sh.getRange(1, 1, 1, STAFF_HEADERS.length).setFontWeight('bold').setBackground('#e0e7ff');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** 시트를 객체 배열로 읽는다 */
function staffRows_(sh, headers) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, headers.length).getValues();
  return vals.filter(function (r) { return String(r[0]).trim() !== ''; })
             .map(function (r) {
               var o = {};
               headers.forEach(function (h, i) { o[h] = r[i]; });
               return o;
             });
}

/** 한 지점의 직원 목록 */
function staffOf_(branchName) {
  var rows = staffRows_(staffSheet_(branchName), STAFF_HEADERS);
  rows.forEach(function (s) {
    s['지점'] = branchName;   // 어느 파일에 있느냐가 곧 지점이다
    // 연월 칸에 날짜가 들어가면 JSON 으로 나갈 때 UTC 로 밀린다. 문자열로 고정한다.
    ['시작연월', '종료연월'].forEach(function (k) {
      if (s[k] instanceof Date) s[k] = Utilities.formatDate(s[k], TIMEZONE, 'yyyy-MM');
      else s[k] = String(s[k] || '').trim();
    });
  });
  return rows;
}

/** 전 지점 직원 목록 */
function staffList_() {
  var all = [];
  Object.keys(BRANCH_CONFIG).forEach(function (b) {
    all = all.concat(staffOf_(b));
  });
  return { staff: all };
}

/** 그 달에 재직 중인가 — 시작연월이 비어 있으면 "예전부터" 로 본다 */
function staffOnDuty_(s, ym) {
  var st = String(s['시작연월'] || '').trim();
  var en = String(s['종료연월'] || '').trim();
  if (st && ym < st) return false;
  if (en && ym > en) return false;
  return true;
}

/**
 * 직원 등록 / 수정 / 퇴사 처리
 *   id 가 없으면 신규, 있으면 해당 행을 덮어쓴다.
 *   퇴사는 삭제가 아니라 종료연월 기입이다 → 지난 급여 기록이 남는다.
 */
function staffSave_(staff) {
  if (!staff || !String(staff['이름'] || '').trim()) {
    return { ok: false, error: '이름이 비어 있습니다.' };
  }
  var 월급 = Number(staff['월급']) || 0;
  if (월급 <= 0) return { ok: false, error: '월급을 입력하세요.' };

  var branchName = staff['지점'] || '백석점';
  if (!BRANCH_CONFIG[branchName]) return { ok: false, error: '알 수 없는 지점: ' + branchName };

  var id = staff['id'] || ('S' + new Date().getTime());

  // 시작연월은 비워도 된다 (오래 다닌 직원은 입사일을 모르는 경우가 많음)
  var row = [
    id,
    String(staff['이름']).trim(),
    branchName,
    월급,
    String(staff['시작연월'] || '').trim(),
    String(staff['종료연월'] || '').trim(),
    staff['메모'] || '',
  ];

  // 지점이 바뀌었으면 이전 지점 파일에서 지운다 (양쪽에 남아 이중 계상되는 것 방지)
  Object.keys(BRANCH_CONFIG).forEach(function (b) {
    if (b === branchName) return;
    var other = staffSheet_(b);
    var rows  = staffRows_(other, STAFF_HEADERS);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i]['id']) === String(id)) {
        other.deleteRow(i + 2);
        Logger.log('👔 지점 이동: ' + row[1] + ' ' + b + ' → ' + branchName);
        break;
      }
    }
  });

  var sh   = staffSheet_(branchName);
  var rows = staffRows_(sh, STAFF_HEADERS);
  var idx  = -1;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['id']) === String(id)) { idx = i; break; }
  }

  if (idx >= 0) sh.getRange(idx + 2, 1, 1, STAFF_HEADERS.length).setValues([row]);
  else          sh.appendRow(row);

  SpreadsheetApp.flush();
  Logger.log('👔 직원 저장: [' + branchName + '] ' + row[1] + ' / ' + 월급.toLocaleString() + '원');

  // 명부가 바뀌었으니 이번 달 인건비를 바로 다시 계산한다
  staffSyncAll_(Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM'));

  return { ok: true, id: id };
}

/** 모든 지점의 그 달 직원급여를 다시 계산해서 로그에 반영 */
function staffSyncAll_(ym) {
  if (!ym) ym = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM');
  var 결과 = {};
  Object.keys(BRANCH_CONFIG).forEach(function (b) {
    결과[b] = syncStaffCosts(b, ym);
  });
  return { ok: true, ym: ym, 합계: 결과 };
}

/**
 * 그 달 · 그 지점의 직원급여 합계를 지출및매출로그에 반영
 *
 *   명부에서 직접 계산한다. 지급 체크 같은 건 없다.
 *   재직 중이면 그 달 인건비에 들어간다. 그게 전부다.
 *
 *   퇴사·전출로 0원이 되면 기존 행을 지운다
 *   (upsertLogEntry 는 amount<=0 이면 아무것도 안 하므로 직접 처리)
 */
function syncStaffCosts(branchName, ym) {
  var config = BRANCH_CONFIG[branchName];
  if (!config) { Logger.log('알 수 없는 지점: ' + branchName); return 0; }
  if (!ym) ym = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM');

  // 그 지점 파일의 명부만 읽는다
  var total = 0;
  staffOf_(branchName).forEach(function (s) {
    if (staffOnDuty_(s, ym)) total += Number(s['월급']) || 0;
  });

  var ss       = SpreadsheetApp.openById(config.ssId);
  var logSheet = ss.getSheetByName('지출및매출로그') || ss.insertSheet('지출및매출로그');
  ensureHeaders(logSheet);

  var marker = '[자동]직원급여_' + branchName + '_' + ym;

  if (total > 0) {
    upsertLogEntry(logSheet, ym + '-01', STAFF_CATEGORY,
                   branchName + ' ' + ym + ' 직원급여', total, branchName, marker);
    Logger.log('👔 [' + branchName + '] ' + ym + ' 직원급여 ' + total.toLocaleString() + '원');
  } else {
    var last = logSheet.getLastRow();
    if (last > 1) {
      var col = logSheet.getRange(2, 6, last - 1, 1).getValues();
      for (var i = col.length - 1; i >= 0; i--) {
        if (String(col[i][0]).trim() === marker) { logSheet.deleteRow(i + 2); break; }
      }
    }
    Logger.log('👔 [' + branchName + '] ' + ym + ' 직원급여 0원 → 기록 삭제');
  }
  return total;
}

/** 진단 — 직원 명부와 이번 달 반영 금액 확인 */
function checkStaff() {
  var ym = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM');
  var staff = staffList_().staff;

  Logger.log('═══ 직원명부 (' + staff.length + '명) ═══');
  staff.forEach(function (s) {
    Logger.log('  ' + s['이름'] + ' | ' + s['지점'] + ' | ' +
               Number(s['월급']).toLocaleString() + '원 | ' +
               (s['시작연월'] || '(입사일 미상)') + ' ~ ' + (s['종료연월'] || '재직중') +
               ' | ' + ym + ' 재직: ' + (staffOnDuty_(s, ym) ? 'O' : 'X'));
  });

  Logger.log('\n═══ ' + ym + ' 지점별 직원급여 ═══');
  Object.keys(BRANCH_CONFIG).forEach(function (b) {
    var t = 0;
    staff.forEach(function (s) {
      if ((s['지점'] || '백석점') === b && staffOnDuty_(s, ym)) t += Number(s['월급']) || 0;
    });
    Logger.log('  ' + b + ' : ' + t.toLocaleString() + '원');
  });
  Logger.log('\n※ 읽기만 했습니다. 반영하려면 staffSyncNow() 를 실행하세요.');
}

/**
 * 잘못된 지점 파일에 들어간 직원을 제자리로 옮긴다
 *
 *   초기 버전이 명부를 백석 한 곳에만 만들었다.
 *   그래서 원당 직원이 백석 손익계산서에 들어가 있다.
 *   이 함수는 각 파일을 훑어서 「지점」 값과 파일이 어긋난 행을 옮긴다.
 *
 *   먼저 fixStaffBranches_미리보기() 로 확인한 뒤 실행할 것.
 */
function fixStaffBranches_미리보기() { fixStaffBranches_(true); }
function fixStaffBranches_적용()   { fixStaffBranches_(false); }

function fixStaffBranches_(dryRun) {
  Logger.log(dryRun ? '=== 미리보기 (변경 없음) ===' : '=== 실제 적용 ===');
  var 이동 = [];

  Object.keys(BRANCH_CONFIG).forEach(function (파일지점) {
    var sh   = staffSheet_(파일지점);
    var rows = staffRows_(sh, STAFF_HEADERS);

    // 뒤에서부터 봐야 행을 지워도 인덱스가 안 밀린다
    for (var i = rows.length - 1; i >= 0; i--) {
      var 적힌지점 = String(rows[i]['지점'] || '').trim();
      if (!적힌지점 || 적힌지점 === 파일지점) continue;
      if (!BRANCH_CONFIG[적힌지점]) {
        Logger.log('  ⚠ ' + rows[i]['이름'] + ' 의 지점 "' + 적힌지점 + '" 을 모르겠습니다 — 건너뜀');
        continue;
      }

      Logger.log('  · ' + rows[i]['이름'] + ' : ' + 파일지점 + ' 파일 → ' + 적힌지점 + ' 파일');
      이동.push(rows[i]['이름']);

      if (!dryRun) {
        var row = STAFF_HEADERS.map(function (h) { return rows[i][h]; });
        staffSheet_(적힌지점).appendRow(row);
        sh.deleteRow(i + 2);
      }
    }
  });

  if (!이동.length) { Logger.log('  옮길 직원이 없습니다 ✅'); return; }

  if (dryRun) {
    Logger.log('\n※ ' + 이동.length + '명 이동 예정. 맞으면 fixStaffBranches_적용() 을 실행하세요.');
  } else {
    SpreadsheetApp.flush();
    staffSyncAll_();
    Logger.log('\n✅ ' + 이동.length + '명 이동 완료 + 이번 달 재계산');
  }
}

// ═══════════════════════════════════════════════════════════
// 월별탭 "직원 급여" 행 수식 교체
//
//  전 : =SUM(D53:D55)                 시트에 직접 박아둔 숫자
//  후 : =IF(G$11="","",SUMIFS(로그, "직원급여", ..., 그달 1일))
//
//  왜 바꾸나
//    수기 값은 시트 안에 숨어 있어서 이력이 안 남는다.
//    월급을 올리면 과거 달 숫자까지 같이 바뀌어 지난 손익이 소급해서 틀어진다.
//    로그를 읽게 하면 그달 값이 그달에 고정된다.
//
//  수식은 같은 시트의 원가 행에서 가져와 분류만 바꾼다.
//  그래야 그 시트가 실제로 쓰는 기준일·헤더 참조를 그대로 쓴다.
// ═══════════════════════════════════════════════════════════

// 어느 행이 로그의 어느 분류를 읽어야 하는지
//   행 이름은 B열 값에서 공백을 뺀 것. 백석 28·29행 / 원당 30·31행 처럼
//   지점마다 위치가 달라도 이름으로 찾으므로 상관없다.
var PAYROLL_RULES = [
  { label: '알바급여', category: '인건비'   },
  { label: '직원급여', category: STAFF_CATEGORY },
];

/**
 * 알바계산기에 실제로 어떤 데이터가 있는지 확인한다.
 *
 *   원당 인건비가 0인 이유를 찾기 위한 진단.
 *   syncLaborCosts 는 지점을 "이름"으로 매칭한다.
 *   알바계산기에 '원당점' 이 아니라 '원당' 으로 등록돼 있으면 조용히 실패한다.
 */
function checkAlbaData() {
  var res;
  try {
    res = UrlFetchApp.fetch(ALBA_SCRIPT_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
  } catch (e) { Logger.log('❌ 알바계산기 호출 실패: ' + e.message); return; }

  var json;
  try { json = JSON.parse(res.getContentText()); }
  catch (e) { Logger.log('❌ 응답 파싱 실패: ' + res.getContentText().slice(0, 300)); return; }

  if (!json.ok || !json.data) { Logger.log('❌ 데이터 없음: ' + res.getContentText().slice(0, 300)); return; }

  var d = json.data;
  var branches = d.branches || [], workers = d.workers || [], payments = d.payments || [];

  Logger.log('═══ 알바계산기에 등록된 지점 ═══');
  branches.forEach(function (b) {
    var cnt = workers.filter(function (w) { return w.branchId === b.id; }).length;
    var 손익매칭 = BRANCH_CONFIG[b.name] ? '✅ 손익계산서와 이름 일치' : '❌ 손익계산서엔 이런 지점명이 없음';
    Logger.log('  "' + b.name + '"  알바 ' + cnt + '명   ' + 손익매칭);
  });
  Logger.log('  손익계산서 쪽 지점명: ' + Object.keys(BRANCH_CONFIG).join(', '));

  Logger.log('\n═══ 지점·월별 지급완료 (세전 합계) ═══');
  var 표 = {};
  payments.forEach(function (p) {
    var w = workers.filter(function (x) { return x.id === p.wid; })[0];
    var b = w ? (branches.filter(function (x) { return x.id === w.branchId; })[0] || {}).name : '(지점불명)';
    b = b || '(지점불명)';
    if (!표[b]) 표[b] = {};
    표[b][p.ym] = (표[b][p.ym] || 0) + (Number(p.gross) || 0);
  });

  Object.keys(표).forEach(function (b) {
    Logger.log('  [' + b + ']');
    Object.keys(표[b]).sort().forEach(function (ym) {
      Logger.log('     ' + ym + ' : ' + 표[b][ym].toLocaleString() + '원');
    });
  });
  if (!Object.keys(표).length) Logger.log('  지급완료 데이터가 하나도 없습니다.');

  Logger.log('\n※ 위에 나온 월만 손익계산서 수식을 바꿔도 안전합니다.');
}

/**
 * 특정 달에 누가 인건비로 잡혔는지 이름 단위로 본다.
 *
 *   합계만 보면 누가 빠졌는지 알 수 없다.
 *   직원은 재직 판정(입사·퇴사 연월)까지 같이 보여준다.
 *
 *   아래 YM 을 보고 싶은 달로 바꿔서 실행할 것.
 */
function 급여내역확인() {
  var YM = '2026-06';        // ← 여기만 바꾸세요

  Logger.log('════════ ' + YM + ' 인건비 내역 ════════');

  // ── 알바계산기 데이터 ──
  var alba = null;
  try {
    var j = JSON.parse(UrlFetchApp.fetch(ALBA_SCRIPT_URL + '?t=' + Date.now(),
                                         { muteHttpExceptions: true }).getContentText());
    if (j.ok && j.data) alba = j.data;
  } catch (e) { Logger.log('⚠ 알바계산기 호출 실패: ' + e.message); }

  Object.keys(BRANCH_CONFIG).forEach(function (branch) {
    Logger.log('\n──── [' + branch + '] ────');

    // ① 직원 (월급제)
    var 직원합 = 0;
    Logger.log('  ▸ 직원');
    var staff = staffOf_(branch);
    if (!staff.length) Logger.log('     (명부 없음)');
    staff.forEach(function (s) {
      var st = String(s['시작연월'] || '').trim();
      var en = String(s['종료연월'] || '').trim();
      var 포함 = staffOnDuty_(s, YM);
      var 사유 = 포함 ? '' :
        (st && YM < st) ? ' ← ' + st + ' 입사 전' :
        (en && YM > en) ? ' ← ' + en + ' 퇴사 후' : '';
      if (포함) 직원합 += Number(s['월급']) || 0;
      Logger.log('     ' + (포함 ? 'O' : 'X') + ' ' + s['이름'] +
                 '  ' + (Number(s['월급']) || 0).toLocaleString() + '원  [' +
                 (st || '입사일미상') + '~' + (en || '재직중') + ']' + 사유);
    });
    Logger.log('     직원 합계: ' + 직원합.toLocaleString() + '원');

    // ② 알바 (시급제)
    var 알바합 = 0;
    Logger.log('  ▸ 알바');
    if (!alba) { Logger.log('     (데이터 없음)'); }
    else {
      var b = (alba.branches || []).filter(function (x) { return x.name === branch; })[0];
      var wmap = {};
      (alba.workers || []).forEach(function (w) { wmap[w.id] = w; });

      var 있음 = false;
      (alba.payments || []).forEach(function (p) {
        if (p.ym !== YM) return;
        var w = wmap[p.wid];
        var 소속 = w && b && w.branchId === b.id;
        var 구제 = !w && ORPHAN_WID_BRANCH[p.wid] === branch;
        if (!소속 && !구제) return;
        알바합 += Number(p.gross) || 0;
        있음 = true;
        Logger.log('     O ' + (w ? w.name : '(삭제된 알바)') + '  ' +
                   (Number(p.gross) || 0).toLocaleString() + '원' +
                   (구제 ? '  ← 구제됨 wid:' + p.wid : ''));
      });
      if (!있음) Logger.log('     (이 달 지급완료 없음)');
    }
    Logger.log('     알바 합계: ' + 알바합.toLocaleString() + '원');

    // ③ 로그에 실제로 기록된 값
    var ss = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId);
    var lg = ss.getSheetByName('지출및매출로그');
    var 기록 = { '인건비': 0, '직원급여': 0 };
    if (lg && lg.getLastRow() > 1) {
      lg.getRange(2, 1, lg.getLastRow() - 1, 4).getValues().forEach(function (r) {
        var cat = String(r[1]).trim();
        if (기록[cat] === undefined) return;
        var d = toDate_(r[0]);
        if (!d) return;
        if (Utilities.formatDate(d, TIMEZONE, 'yyyy-MM') !== YM) return;
        기록[cat] += Number(r[3]) || 0;
      });
    }
    Logger.log('  ▸ 로그 기록값');
    Logger.log('     직원급여: ' + 기록['직원급여'].toLocaleString() + '원' +
               (기록['직원급여'] === 직원합 ? '  ✅' : '  ⚠️ 명부 합계와 다름 → staffBackfill_적용 필요'));
    Logger.log('     인건비  : ' + 기록['인건비'].toLocaleString() + '원' +
               (기록['인건비'] === 알바합 ? '  ✅' : '  ⚠️ 알바 합계와 다름 → 인건비_전체동기화_적용 필요'));
  });

  Logger.log('\n※ X 표시된 사람이 잘못됐으면 앱 직원 탭에서 입사·퇴사 연월을 고치고');
  Logger.log('   staffBackfill_적용() 을 다시 실행하세요.');
}

function 급여수식_미리보기() { fixPayrollFormulas_(true); }
function 급여수식_적용()   { fixPayrollFormulas_(false); }

function fixPayrollFormulas_(dryRun) {
  var COL = 3;   // C열
  Logger.log(dryRun ? '=== 미리보기 (시트 변경 없음) ===' : '=== 실제 적용 ===');
  Logger.log('규칙: 로그에 기록이 없는데 시트에 값이 있으면 손대지 않습니다.\n');

  var 바뀔것 = 0;
  var 건너뜀 = [];

  Object.keys(BRANCH_CONFIG).forEach(function (branch) {
    var ss = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId);
    Logger.log('\n──── [' + branch + '] ────');

    // 로그를 분류·월별로 미리 합산해둔다 (바뀐 뒤 값이 얼마가 될지 보여주려고)
    var 로그 = {};   // 로그[분류][연월] = 금액
    var logSheet = ss.getSheetByName('지출및매출로그');
    if (logSheet && logSheet.getLastRow() > 1) {
      var v = logSheet.getRange(2, 1, logSheet.getLastRow() - 1, 4).getValues();
      v.forEach(function (r) {
        var cat = String(r[1]).trim();
        var d = toDate_(r[0]);
        if (!d) return;
        var ym = Utilities.formatDate(d, TIMEZONE, 'yyyy-MM');
        if (!로그[cat]) 로그[cat] = {};
        로그[cat][ym] = (로그[cat][ym] || 0) + (Number(r[3]) || 0);
      });
    }

    var targets = ['26년 x월 손익계산서'];
    for (var m = 1; m <= 12; m++) targets.push('26년 ' + m + '월 손익계산서');

    targets.forEach(function (tabName) {
      var sh = ss.getSheetByName(tabName);
      if (!sh) return;
      var ymMatch = tabName.match(/26년 (\d+)월/);
      var ym = ymMatch ? '2026-' + ('0' + ymMatch[1]).slice(-2) : null;

      PAYROLL_RULES.forEach(function (rule) {
        var row = findLabelRow_(sh, rule.label);
        if (row < 0) return;   // 그 지점 양식에 없는 행이면 조용히 넘어간다

        var built = buildLogFormula_(sh, rule.category);
        if (!built) {
          Logger.log('  ⚠ ' + tabName + ' [' + rule.label + '] 참고할 수식을 못 찾음 — 건너뜀');
          return;
        }

        var cur = sh.getRange(row, COL).getFormula();
        if (normalizeF_(cur) === normalizeF_(built.formula)) return;   // 이미 동일

        var 현재표시 = sh.getRange(row, COL).getDisplayValue();
        var 현재값   = Number(String(현재표시).replace(/[^0-9.-]/g, '')) || 0;
        var 새값     = ym ? ((로그[rule.category] || {})[ym] || 0) : 0;

        // ── 안전장치 ──────────────────────────────────────────
        // 앱을 쓰기 전 달은 로그가 비어 있다. 그 달 수식을 바꾸면
        // 시트에 적혀 있던 실제 급여가 0으로 날아간다.
        // 로그가 비었는데 시트에 값이 있으면 손대지 않는다.
        // (템플릿은 미래용이라 값이 없어도 바꾼다)
        if (ym && 새값 === 0 && 현재값 > 0) {
          건너뜀.push(tabName.replace('26년 ', '').replace(' 손익계산서', '') +
                     ' ' + rule.label + ' (' + 현재값.toLocaleString() + '원 유지)');
          return;
        }

        Logger.log('  · ' + tabName + ' ' + row + '행 [' + rule.label + ']');
        Logger.log('      전: ' + (cur || '(수식없음)') + '  → ' + 현재표시);
        Logger.log('      후: 로그 "' + rule.category + '" 참조  → ' + 새값.toLocaleString() + '원');
        if (새값 !== 현재값) Logger.log('      ⚠️ 금액이 달라집니다 (' + 현재값.toLocaleString() + ' → ' + 새값.toLocaleString() + ')');
        바뀔것++;

        if (!dryRun) {
          sh.getRange(row, COL).setFormula(built.formula);
          SpreadsheetApp.flush();
          Logger.log('      → 적용됨: ' + sh.getRange(row, COL).getDisplayValue());
        }
      });
    });
  });

  if (건너뜀.length) {
    Logger.log('\n──── 손대지 않음 (로그에 기록이 없어 수기값 유지) ────');
    건너뜀.forEach(function (x) { Logger.log('  · ' + x); });
    Logger.log('  → 앱을 쓰기 전 달입니다. 그대로 두는 게 맞습니다.');
  }

  if (!바뀔것) { Logger.log('\n바꿀 것이 없습니다 ✅'); return; }
  Logger.log(dryRun
    ? '\n※ ' + 바뀔것 + '곳 변경 예정. 아무것도 바꾸지 않았습니다.'
    : '\n✅ ' + 바뀔것 + '곳 적용 완료');
}

/**
 * 같은 시트의 원가 행에서 일별 SUMIFS 수식을 찾아 분류만 바꿔 돌려준다.
 * 시트마다 기준일 셀·헤더 행이 다를 수 있으므로 남의 시트 수식을 복사하지 않는다.
 */
function buildLogFormula_(sheet, category) {
  var last = Math.min(sheet.getLastRow(), 60);
  if (last < 1) return null;
  var fs = sheet.getRange(1, 7, last, 1).getFormulas();   // G열
  var re = /SUMIFS\(\s*'지출및매출로그'!\$D:\$D\s*,\s*'지출및매출로그'!\$B:\$B\s*,\s*"([^"]+)"/;

  for (var i = 0; i < fs.length; i++) {
    var f = fs[i][0];
    if (!f || f.indexOf('SUBSTITUTE') < 0) continue;
    var m = re.exec(f);
    if (!m) continue;
    return {
      formula: f.replace('"' + m[1] + '"', '"' + category + '"'),
      from: (i + 1) + '행 G열',
      원분류: m[1],
    };
  }
  return null;
}

/**
 * 과거 달의 직원급여를 명부 기준으로 로그에 채운다
 *   ⚠️ 지금 명부의 월급을 과거에 그대로 적용한다.
 *      그동안 월급이 올랐다면 과거 값이 실제와 달라진다.
 *      미리보기로 기존 시트 값과 비교한 뒤 결정할 것.
 */
function staffBackfill_미리보기() { staffBackfill_(true); }
function staffBackfill_적용()   { staffBackfill_(false); }

function staffBackfill_(dryRun) {
  var FROM = '2026-04';
  var now  = new Date();
  var TO   = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM');

  Logger.log(dryRun ? '=== 과거 직원급여 채우기 (미리보기) ===' : '=== 과거 직원급여 채우기 (적용) ===');

  var y = Number(FROM.split('-')[0]), mo = Number(FROM.split('-')[1]);
  while (true) {
    var ym = y + '-' + ('0' + mo).slice(-2);
    if (ym > TO) break;

    Object.keys(BRANCH_CONFIG).forEach(function (b) {
      var t = 0;
      staffOf_(b).forEach(function (s) { if (staffOnDuty_(s, ym)) t += Number(s['월급']) || 0; });
      if (t > 0) Logger.log('  ' + ym + ' [' + b + '] ' + t.toLocaleString() + '원');
      if (!dryRun) syncStaffCosts(b, ym);
    });

    mo++; if (mo > 12) { mo = 1; y++; }
  }
  Logger.log(dryRun ? '\n※ 아무것도 바꾸지 않았습니다.' : '\n✅ 완료');
}

/** 이번 달 직원급여를 지금 바로 손익계산서에 반영 */
function staffSyncNow() {
  var r = staffSyncAll_();
  Logger.log('✅ ' + r.ym + ' 반영 완료');
  Object.keys(r.합계).forEach(function (b) {
    Logger.log('  ' + b + ' : ' + Number(r.합계[b]).toLocaleString() + '원');
  });
}


// ============================================================
// 📡 웹앱 수신 (앱 → GAS → 드라이브 저장)  ← 핵심!
// ============================================================

/**
 * 알바계산기 앱의 직원 탭이 데이터를 읽어가는 통로
 *   GET .../exec?action=staffList
 */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'staffList') {
    try {
      return jsonOut_({ ok: true, data: staffList_() });
    } catch (err) {
      return jsonOut_({ ok: false, error: err.message });
    }
  }
  return jsonOut_({ ok: true, message: '장수한우곱창 손익계산서 API' });
}

function doPost(e) {
  try {
    var data    = JSON.parse(e.postData.contents);

    // ── 직원 관리 요청 라우팅 ──────────────────────────────
    // 기존 영수증 앱은 action 없이 보내므로 아래 분기를 타지 않는다.
    // 즉 이 코드를 추가해도 영수증 업로드는 지금과 똑같이 동작한다.
    if (data.action) return staffRouter_(data);

    var base64  = data.base64;
    var mime    = data.mime    || "image/jpeg";
    var docType = data.docType || "기타";
    var store   = data.store   || "백석점";

    var config = BRANCH_CONFIG[store];
    if (!config) throw new Error("알 수 없는 지점: " + store);

    var folder    = DriveApp.getFolderById(config.folderId);
    var timestamp = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd_HHmmss");
    var fileName  = "[웹앱][" + docType + "] " + timestamp + ".jpg";

    var bytes = Utilities.base64Decode(base64);
    var blob  = Utilities.newBlob(bytes, mime, fileName);
    var file  = folder.createFile(blob);

    Logger.log("✅ 저장 완료: " + fileName + " (" + store + ")");

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, fileName: fileName, fileId: file.getId() }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log("❌ doPost 오류: " + err.message);
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// ============================================================
// 🤖 Gemini - 문서유형별 프롬프트  (새 버튼명 반영)
// ============================================================

var PROMPTS = {

  마감정산서:
    "이것은 음식점 일일 마감정산서입니다.\n" +
    "아래 규칙대로 항목을 추출하여 순수 JSON 배열만 응답하세요 (마크다운·설명 없이):\n\n" +
    "추출 규칙:\n" +
    "- [영업일자] 또는 날짜 필드 → 날짜(YYYY-MM-DD)\n" +
    "- 일반현금 + 현금영수증 합계 → 분류: \"현금매출\", 항목명: \"일반현금+현금영수증\"\n" +
    "- 신용카드 금액 → 분류: \"카드매출\", 항목명: \"신용카드\"\n" +
    "- 간편결제(카카오페이/네이버페이/페이코 등) → 분류: \"카드매출\", 항목명: \"간편결제\"\n" +
    "- 배달앱(배민/쿠팡이츠/요기요 등) 금액이 있으면 → 분류: \"배달매출\"\n\n" +
    "절대 출력하지 말 것:\n" +
    "- '결제합계', '매출 합계', '총 합계', '합계' 등 합산·소계 행\n" +
    "- 결제합계는 현금매출+카드매출의 단순 합산이므로 반드시 제외\n" +
    "- 위 4가지 분류(현금매출·카드매출·배달매출) 외 모든 항목\n" +
    "- 금액이 0이거나 없는 항목\n\n" +
    "응답 형식 (예시):\n" +
    "[{\"날짜\":\"YYYY-MM-DD\",\"분류\":\"현금매출\",\"항목명\":\"일반현금+현금영수증\",\"금액\":숫자}," +
    "{\"날짜\":\"YYYY-MM-DD\",\"분류\":\"카드매출\",\"항목명\":\"신용카드\",\"금액\":숫자}," +
    "{\"날짜\":\"YYYY-MM-DD\",\"분류\":\"카드매출\",\"항목명\":\"간편결제\",\"금액\":숫자}]",

  고기값:
    "이것은 산외한우부산물(이영자) 거래명세서 또는 계좌이체 화면입니다.\n\n" +
    "▶ 거래명세서인 경우 (품목·수량·단가가 표 형식으로 나열된 경우):\n" +
    "  - 문서에 표시된 '합계금액' 또는 '공급가액 합계'(W 또는 ₩ 표시된 최종 합계 한 줄)를 추출\n" +
    "  - 날짜: 문서 상단의 거래일자 또는 첫 번째 거래 날짜(YYYY-MM-DD)\n" +
    "  - 항목명: '이영자 거래명세서'\n" +
    "  - 주의: 개별 품목 행이 아닌 반드시 최종 합계금액 하나만 출력\n\n" +
    "▶ 계좌이체 화면인 경우:\n" +
    "  - 이체 날짜와 이체 금액 추출\n" +
    "  - 항목명: '이영자 계좌이체'\n\n" +
    "순수 JSON 배열만 응답하세요:\n" +
    "[{\"날짜\":\"YYYY-MM-DD\",\"분류\":\"고기값\",\"항목명\":\"이영자 거래명세서\",\"금액\":숫자}]",

  음료수:
    "이것은 계좌이체 확인 화면(스크린샷)입니다.\n" +
    "이체 날짜(YYYY-MM-DD)와 이체 금액을 추출하여 순수 JSON 배열만 응답하세요:\n" +
    "[{\"날짜\":\"YYYY-MM-DD\",\"분류\":\"음료원가\",\"항목명\":\"조남호 계좌이체\",\"금액\":숫자}]",

  가게내부카드:
    "이것은 가게 내부 카드 결제 영수증 또는 카드 전표입니다.\n" +
    "결제 날짜(YYYY-MM-DD)와 결제 금액을 추출하여 순수 JSON 배열만 응답하세요:\n" +
    "[{\"날짜\":\"YYYY-MM-DD\",\"분류\":\"가게내부카드\",\"항목명\":\"내부카드 결제\",\"금액\":숫자}]",

  가게외부카드:
    "이것은 가게 외부 카드 결제 영수증입니다 (인터넷 주문 등).\n" +
    "결제 날짜(YYYY-MM-DD)와 결제 금액을 추출하여 순수 JSON 배열만 응답하세요:\n" +
    "[{\"날짜\":\"YYYY-MM-DD\",\"분류\":\"가게외부카드\",\"항목명\":\"외부카드(인터넷주문)\",\"금액\":숫자}]",

  미락:
    "이것은 미락(식자재) 영수증입니다.\n" +
    "거래 날짜(YYYY-MM-DD)와 이번 거래의 공급가액(당회 납부 금액)을 추출하여 순수 JSON 배열만 응답하세요.\n\n" +
    "주의사항:\n" +
    "- '미수금'은 누적 외상잔금이므로 절대 추출하지 말 것\n" +
    "- '공급가액' 또는 '이번 거래 합계'만 추출\n" +
    "- 공급가액이 없으면 '합계금액' 사용\n\n" +
    "[{\"날짜\":\"YYYY-MM-DD\",\"분류\":\"미락\",\"항목명\":\"미락 식자재\",\"금액\":숫자}]",

  콩나물:
    "이것은 콩나물 구매 영수증입니다.\n" +
    "거래 날짜(YYYY-MM-DD)와 합계 금액을 추출하여 순수 JSON 배열만 응답하세요:\n" +
    "[{\"날짜\":\"YYYY-MM-DD\",\"분류\":\"콩나물\",\"항목명\":\"콩나물\",\"금액\":숫자}]",

  주류:
    "이것은 주류 판매계산서 또는 거래명세표입니다.\n" +
    "거래 날짜(YYYY-MM-DD)와 매출 합계 금액을 추출하여 순수 JSON 배열만 응답하세요:\n" +
    "[{\"날짜\":\"YYYY-MM-DD\",\"분류\":\"주류원가\",\"항목명\":\"주류\",\"금액\":숫자}]",

  관리비:
    "이것은 건물 관리비 영수증 또는 청구서입니다.\n" +
    "청구 날짜(YYYY-MM-DD)와 청구 금액 합계를 추출하여 순수 JSON 배열만 응답하세요:\n" +
    "[{\"날짜\":\"YYYY-MM-DD\",\"분류\":\"매장관리비(전기,수도)\",\"항목명\":\"관리비\",\"금액\":숫자}]",

  가스:
    "이것은 가스 요금 영수증 또는 청구서입니다.\n" +
    "청구 날짜(YYYY-MM-DD)와 총 납부 금액을 추출하여 순수 JSON 배열만 응답하세요:\n" +
    "[{\"날짜\":\"YYYY-MM-DD\",\"분류\":\"가스사용료(매장)\",\"항목명\":\"가스요금\",\"금액\":숫자}]",

  카드값:
    "이것은 가게 카드 결제 영수증 또는 카드 사용 내역 캡처 화면입니다 (마트·쿠팡·네이버 등 구매).\n" +
    "• 단일 영수증: 결제 날짜·금액 1건 추출\n" +
    "• 다수 거래 내역 화면: 각 거래를 개별 항목으로 추출 (취소·환불 제외)\n\n" +
    "순수 JSON 배열만 응답하세요 (마크다운·설명 없이):\n" +
    "[{\"날짜\":\"YYYY-MM-DD\",\"분류\":\"카드값\",\"항목명\":\"구매처명\",\"금액\":숫자}]\n\n" +
    "- 날짜: YYYY-MM-DD 형식\n" +
    "- 금액: 숫자만 (원 표시·쉼표 없이)\n" +
    "- 금액 0 또는 취소된 거래는 포함하지 말 것",

  기타:
    "이 이미지를 분석하여 순수 JSON 배열만 응답하세요 (마크다운·설명 없이).\n\n" +
    "분석 규칙:\n" +
    "1. 영수증/거래명세표: 날짜·분류·항목명·금액 추출\n" +
    "2. 계좌 이체 캡처: 분류=\"이체\", 항목명=수취인이름\n" +
    "3. 마감정산서: 현금매출, 카드매출, 배달매출로 분리\n\n" +
    "응답 형식:\n" +
    "[{\"날짜\":\"YYYY-MM-DD\",\"분류\":\"분류명\",\"항목명\":\"항목명\",\"금액\":숫자}]\n\n" +
    "날짜: YYYY-MM-DD 형식. 금액: 숫자만 (쉼표 없이)."
};


// ============================================================
// 🤖 Gemini API 호출 (최대 3회 재시도)
// ============================================================

function callGeminiWithDocType(imageData, docType) {
  var prompt  = PROMPTS[docType] || PROMPTS["기타"];
  var b64     = Utilities.base64Encode(imageData.blob.getBytes());
  var url     = "https://generativelanguage.googleapis.com/v1beta/models/" +
                GEMINI_MODEL + ":generateContent?key=" + GEMINI_API_KEY;

  var payload = {
    contents: [{ parts: [
      { text: prompt },
      { inline_data: { mime_type: imageData.mimeType, data: b64 } }
    ]}],
    generationConfig: { temperature: 0.1, topP: 0.8 }
  };

  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      Logger.log("  🔄 Gemini [" + docType + "] " + attempt + "/3...");
      var res  = UrlFetchApp.fetch(url, {
        method: "post", contentType: "application/json",
        payload: JSON.stringify(payload), muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      var body = res.getContentText();

      if (code === 200) {
        var json      = JSON.parse(body);
        var candidate = json.candidates && json.candidates[0];
        if (!candidate) { if (attempt < 3) Utilities.sleep(3000 * attempt); continue; }
        if (candidate.finishReason === "SAFETY") return null;

        var text    = (candidate.content && candidate.content.parts && candidate.content.parts[0].text) || "";
        var cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
        var match   = cleaned.match(/\[[\s\S]*\]/);
        if (!match) { if (attempt < 3) Utilities.sleep(3000 * attempt); continue; }

        try {
          var result = JSON.parse(match[0]);
          if (Array.isArray(result) && result.length > 0) {
            Logger.log("  ✅ 파싱 성공: " + result.length + "건");
            return result;
          }
        } catch (pe) {}
        if (attempt < 3) Utilities.sleep(3000 * attempt);

      } else if (code === 429) {
        Utilities.sleep(Math.pow(2, attempt) * 5000);
      } else if (code === 400 || code === 403) {
        return null;
      } else {
        if (attempt < 3) Utilities.sleep(3000 * attempt);
      }
    } catch (e) {
      Logger.log("  ❌ 예외: " + e.message);
      if (attempt < 3) Utilities.sleep(3000 * attempt);
    }
  }
  return null;
}


// ============================================================
// 🖼️ 이미지 준비 (3MB 초과 시 썸네일 압축)
// ============================================================

function prepareImageFromFile(file) {
  var SIZE_LIMIT = 3 * 1024 * 1024;
  if (file.getSize() <= SIZE_LIMIT) {
    try { return { blob: file.getBlob(), mimeType: file.getMimeType() }; } catch (e) {}
  }
  Logger.log("  📦 파일 크기 초과 → 썸네일 압축");
  return getCompressedThumbnail(file.getId());
}

function prepareImage(file) { return prepareImageFromFile(file); }

function getCompressedThumbnail(fileId) {
  try {
    var token    = ScriptApp.getOAuthToken();
    var metaRes  = UrlFetchApp.fetch(
      "https://www.googleapis.com/drive/v3/files/" + fileId + "?fields=thumbnailLink",
      { headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true }
    );
    if (metaRes.getResponseCode() !== 200) return null;
    var thumbLink = JSON.parse(metaRes.getContentText()).thumbnailLink;
    if (!thumbLink) return null;
    var imgRes = UrlFetchApp.fetch(thumbLink.replace(/=s\d+$/, "=s2000"), { muteHttpExceptions: true });
    if (imgRes.getResponseCode() !== 200) return null;
    return { blob: imgRes.getBlob(), mimeType: "image/jpeg" };
  } catch (e) { return null; }
}


// ============================================================
// 📊 시트 기록 & 중복 체크
// ============================================================

function ensureHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(SHEET_HEADERS);
    SpreadsheetApp.flush();
  }
}

function recordDataSafely(sheet, items, branchName, fileName, fileId) {
  var timestamp = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
  var rows = [];
  items.forEach(function(item) {
    var amount = parseInt(String(item.금액 || "0").replace(/[^0-9]/g, "")) || 0;
    if (amount === 0) return;
    rows.push([item.날짜||"", item.분류||"기타", item.항목명||"", amount, branchName, fileName, timestamp, fileId||""]);
    Logger.log("   " + item.날짜 + " | " + item.분류 + " | " + amount.toLocaleString() + "원");
  });
  if (rows.length === 0) return { success: false, count: 0 };
  rows.forEach(function(r) { sheet.appendRow(r); });
  SpreadsheetApp.flush();
  return { success: true, count: rows.length };
}

function isAlreadyProcessedById(sheet, fileId) {
  if (!fileId) return false;
  try {
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return false;
    var fileIds = sheet.getRange(2, COL_FILE_ID, lastRow - 1, 1).getValues();
    return fileIds.some(function(r) { return String(r[0]).trim() === fileId; });
  } catch (e) { return false; }
}

function isAlreadyProcessed(sheet, fileName) {
  try {
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return false;
    var names = sheet.getRange(2, 6, lastRow - 1, 1).getValues();
    return names.some(function(r) { return String(r[0]).trim() === fileName; });
  } catch (e) { return false; }
}

function safeRename(file, newName) {
  try { file.setName(newName); return true; } catch (e) { return false; }
}

function extractDocTypeFromName(fileName) {
  var knownTypes = [
    "마감정산서", "고기값", "음료수",
    "가게내부카드", "가게외부카드",
    "미락", "콩나물", "주류",
    "관리비", "가스", "카드값", "기타"
  ];
  var match = fileName.match(/\[웹앱\]\[([^\]]+)\]/);
  if (match) {
    for (var i = 0; i < knownTypes.length; i++) {
      if (knownTypes[i] === match[1]) return match[1];
    }
  }
  return "기타";
}


// ============================================================
// 🔒 드라이브 배치 자동 처리 (매일 오전 2시)
// ============================================================

function dailyProcess() {
  var lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(300000)) { Logger.log("⚠️ 다른 프로세스 실행 중"); return; }
    Logger.log("=== 자동 처리 시작 ===");
    processFiles("원당점");
    processFiles("백석점");

    // ── 고기값 / 주류·음료 원가 자동 동기화 (추가) ──
    syncMeatCosts("백석점");
    syncLiquorCosts("백석점");
    // syncMeatCosts("원당점");   // 원당점 입고기록도 있으면 주석 해제

    Logger.log("=== 자동 처리 완료 ===");
  } catch (e) {
    Logger.log("FATAL: " + e.message);
  } finally {
    lock.releaseLock();
  }
}

function processFiles(branchName) {
  Logger.log("\n========== [" + branchName + "] ==========");
  var config = BRANCH_CONFIG[branchName];
  if (!config) return;

  var ss       = SpreadsheetApp.openById(config.ssId);
  var folder   = DriveApp.getFolderById(config.folderId);
  var logSheet = ss.getSheetByName("지출및매출로그") || ss.insertSheet("지출및매출로그");
  ensureHeaders(logSheet);

  var processed = 0, skipped = 0, errors = 0;
  var files = folder.getFiles();

  while (files.hasNext()) {
    var file = files.next();
    var name = file.getName().trim();

    if (name.startsWith("[완료]") || name.startsWith("[확인요망]")) { skipped++; continue; }
    if (!file.getMimeType().startsWith("image/")) continue;

    if (isAlreadyProcessedById(logSheet, file.getId()) || isAlreadyProcessed(logSheet, name)) {
      safeRename(file, "[완료] " + name);
      skipped++; continue;
    }

    Logger.log("\n📁 " + name);
    try {
      var imageData = prepareImage(file);
      if (!imageData) { safeRename(file, "[확인요망] 이미지준비실패_" + name); errors++; continue; }

      var docType = extractDocTypeFromName(name);
      var res = callGeminiWithDocType(imageData, docType);
      if (!res || res.length === 0) { safeRename(file, "[확인요망] AI분석실패_" + name); errors++; continue; }

      var result = recordDataSafely(logSheet, res, branchName, name, file.getId());
      if (result.success) { safeRename(file, "[완료] " + name); processed++; }
      else { safeRename(file, "[확인요망] 기록실패_" + name); errors++; }
    } catch (e) {
      safeRename(file, "[확인요망] 오류_" + name); errors++;
    }
    Utilities.sleep(2000);
  }

  Logger.log("✅ 성공: " + processed + " | ⏭ 스킵: " + skipped + " | ❌ 오류: " + errors);
}


// ============================================================
// 🔄 AI분석실패 파일 재처리 (수동 1회 실행)
// GAS 편집기에서 retryFailedFiles() 직접 실행
// ============================================================

function retryFailedFiles() {
  var total = 0;
  ["원당점", "백석점"].forEach(function(branchName) {
    var config = BRANCH_CONFIG[branchName];
    var folder = DriveApp.getFolderById(config.folderId);
    var files  = folder.getFiles();
    var count  = 0;
    while (files.hasNext()) {
      var file = files.next();
      var name = file.getName().trim();
      // "[확인요망] AI분석실패_" 로 시작하는 파일만 복원
      if (name.startsWith("[확인요망] AI분석실패_")) {
        var original = name.replace("[확인요망] AI분석실패_", "");
        safeRename(file, original);
        Logger.log("[" + branchName + "] 복원: " + original);
        count++;
      }
    }
    Logger.log("[" + branchName + "] 재처리 대상 복원: " + count + "건");
    total += count;
  });
  Logger.log("✅ 총 " + total + "건 복원 완료 → 다음 자동실행(새벽 4시)에 재분석됩니다.");
}


// ============================================================
// 📡 네이버 광고비 월말 자동 동기화 (매월 1일 오전 3시)
// ============================================================

function syncNaverAdCost() {
  Logger.log("=== 네이버 광고비용 동기화 시작 ===");
  var now        = new Date();
  var targetDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  var year       = targetDate.getFullYear();
  var month      = targetDate.getMonth() + 1;
  Logger.log("대상: " + year + "년 " + month + "월");

  ["원당점", "백석점"].forEach(function(branch) {
    try {
      var cost = getNaverAdCostForMonth(BRANCH_CONFIG[branch].naverSheetId, year, month);
      Logger.log("[" + branch + "] 광고비: " + cost.toLocaleString() + "원");
      if (cost > 0) writeNaverAdCostToSheet(branch, year, month, cost);
    } catch (e) {
      Logger.log("[" + branch + "] 오류: " + e.message);
    }
  });
  Logger.log("=== 완료 ===");
}

function getNaverAdCostForMonth(naverSheetId, year, month) {
  var ss    = SpreadsheetApp.openById(naverSheetId);
  var sheet = ss.getSheetByName("광고성과");
  if (!sheet) return 0;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;
  var data  = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  var total = 0;
  data.forEach(function(row) {
    if (!row[0] || row[5] === "" || row[5] === null) return;
    var d = (row[0] instanceof Date) ? row[0] : new Date(String(row[0]));
    if (isNaN(d.getTime())) return;
    if (d.getFullYear() === year && (d.getMonth() + 1) === month) {
      total += parseInt(String(row[5]).replace(/[^0-9]/g, "")) || 0;
    }
  });
  return total;
}

function writeNaverAdCostToSheet(branchName, year, month, cost) {
  var config   = BRANCH_CONFIG[branchName];
  var ss       = SpreadsheetApp.openById(config.ssId);
  var logSheet = ss.getSheetByName("지출및매출로그") || ss.insertSheet("지출및매출로그");
  ensureHeaders(logSheet);

  var dateStr = year + "-" + String(month).padStart(2, "0") + "-01";
  var marker  = "네이버광고_" + year + String(month).padStart(2, "0");
  var nowStr  = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");

  var lastRow = logSheet.getLastRow();
  if (lastRow > 1) {
    var names = logSheet.getRange(2, 6, lastRow - 1, 1).getValues();
    for (var i = 0; i < names.length; i++) {
      if (String(names[i][0]).trim() === marker) {
        logSheet.getRange(i + 2, 4).setValue(cost);
        logSheet.getRange(i + 2, 7).setValue(nowStr);
        SpreadsheetApp.flush();
        return;
      }
    }
  }
  logSheet.appendRow([dateStr, "네이버 광고비용", year+"년 "+month+"월 네이버 광고", cost, branchName, marker, nowStr, ""]);
  SpreadsheetApp.flush();
}


// ============================================================
// 🔄 마이그레이션: 백석점 로그의 '마트' → '카드값' 일괄 변경
// GAS 편집기에서 직접 1회 실행
// ============================================================

function migrateMarketToCardValue() {
  var config = BRANCH_CONFIG["백석점"];
  var ss = SpreadsheetApp.openById(config.ssId);
  var logSheet = ss.getSheetByName("지출및매출로그");
  if (!logSheet) { Logger.log("❌ '지출및매출로그' 시트를 찾을 수 없음"); return; }

  var lastRow = logSheet.getLastRow();
  if (lastRow <= 1) { Logger.log("ℹ️ 데이터 없음 (헤더만 있음)"); return; }

  var range  = logSheet.getRange(2, 2, lastRow - 1, 1); // 분류 컬럼
  var values = range.getValues();
  var count  = 0;

  values.forEach(function(row, i) {
    if (String(row[0]).trim() === "마트") {
      values[i][0] = "카드값";
      count++;
    }
  });

  if (count > 0) {
    range.setValues(values);
    SpreadsheetApp.flush();
  }

  Logger.log("✅ 마이그레이션 완료: " + count + "건 변경 (마트 → 카드값) [백석점]");
}


// ============================================================
// ⏰ 트리거 설정 (최초 1회만 실행)
// ============================================================

function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("dailyProcess").timeBased().everyDays(1).atHour(2).create();
  ScriptApp.newTrigger("syncNaverAdCost").timeBased().onMonthDay(1).atHour(3).create();
  ScriptApp.newTrigger("monthlySetup").timeBased().onMonthDay(1).atHour(4).create();
  Logger.log("✅ 트리거 설정 완료");
}


// ============================================================
// 📅 월별 손익계산서 탭 자동 생성 (매월 1일 오전 1시)
// ============================================================

/**
 * 매월 1일 자동 실행 — 새 월별탭 생성
 * setupTriggers() 실행 후 자동으로 매월 1일 오전 1시에 호출됨
 */
function monthlySetup() {
  Logger.log('=== 월별 손익계산서 자동 생성 시작 ===');
  createMonthlyTab('백석점');
  createMonthlyTab('원당점');
  syncLaborCosts('백석점');
  syncLaborCosts('원당점');

  // 직원급여 — 전월분을 그 달로 기록 (알바급여와 같은 기준)
  var prev = new Date();
  prev.setMonth(prev.getMonth() - 1);
  staffSyncAll_(Utilities.formatDate(prev, TIMEZONE, 'yyyy-MM'));

  Logger.log('=== 완료 ===');
}

/**
 * 새 월별탭 생성
 * 1. "26년 x월 손익계산서" 템플릿 탭 우선 사용
 * 2. 없으면 이전 달 탭 복사
 * 3. 날짜 헤더(G~AK열) 자동 업데이트
 */
function createMonthlyTab(branchName) {
  var now   = new Date();
  var year  = now.getFullYear();
  var month = now.getMonth() + 1;

  var config = BRANCH_CONFIG[branchName];
  if (!config) { Logger.log('BRANCH_CONFIG 없음: ' + branchName); return; }

  var ss  = SpreadsheetApp.openById(config.ssId);
  var yy  = String(year).slice(2);
  var newName = yy + '년 ' + month + '월 손익계산서';

  // 이미 존재하면 스킵
  if (ss.getSheetByName(newName)) {
    Logger.log('[' + branchName + '] ' + newName + ': 이미 존재 — 스킵');
    return;
  }

  // 소스 탭 결정: 템플릿 우선, 없으면 이전 달
  var templateSheet = ss.getSheetByName(yy + '년 x월 손익계산서');
  if (!templateSheet) {
    var prevMonth = (month === 1) ? 12 : month - 1;
    var prevYear  = (month === 1) ? year - 1 : year;
    var prevYY    = String(prevYear).slice(2);
    templateSheet = ss.getSheetByName(prevYY + '년 ' + prevMonth + '월 손익계산서');
  }

  if (!templateSheet) {
    Logger.log('[' + branchName + '] 소스 탭 없음 — 생성 불가');
    return;
  }

  Logger.log('[' + branchName + '] 소스: ' + templateSheet.getName() + ' → ' + newName);

  // 복사 & 이름 변경
  var newSheet = templateSheet.copyTo(ss);
  newSheet.setName(newName);

  // 탭 위치: 지출및매출로그 바로 앞
  var logSheet = ss.getSheetByName('지출및매출로그');
  if (logSheet) {
    ss.setActiveSheet(newSheet);
    ss.moveActiveSheet(logSheet.getIndex() - 1);
  }

  // 날짜 헤더 업데이트: G열~AK열(col7~37)에서 Date 값 찾아 새 월로 교체
  var scanLimit = Math.min(6, newSheet.getLastRow());
  var dateRow   = -1;

  for (var r = 1; r <= scanLimit; r++) {
    var vals = newSheet.getRange(r, 7, 1, 31).getValues()[0];
    var hasDate = vals.some(function(v) {
      return v instanceof Date && !isNaN(v.getTime());
    });
    if (hasDate) { dateRow = r; break; }
  }

  if (dateRow > 0) {
    var daysInMonth = new Date(year, month, 0).getDate();
    var newDates    = [];
    for (var d = 1; d <= 31; d++) {
      newDates.push(d <= daysInMonth ? new Date(year, month - 1, d) : '');
    }
    newSheet.getRange(dateRow, 7, 1, 31).setValues([newDates]);
    Logger.log('  날짜 헤더 ' + dateRow + '행 → ' + year + '/' + month + ' (' + daysInMonth + '일)');
  } else {
    Logger.log('  ⚠️ 날짜 헤더 행 없음 — 날짜 수동 확인 필요');
  }

  // ── 기준일(A1) 설정 ──
  // 시트를 복사하면 기준일이 이전 달로 남아, 이를 참조하는 A51·A52가
  // 전부 지난 달을 가리키게 된다. 새 달로 다시 세팅한다.
  setupBaseDate_(newSheet, year, month);

  SpreadsheetApp.flush();
  Logger.log('✅ [' + branchName + '] ' + newName + ' 생성 완료');
}

/**
 * 기준일 셀(B7:B9)의 연·월을 새 달로 맞춘다.
 * 일(day)과 시각은 원래 값을 유지하고, 새 달에 없는 날이면 말일로 보정한다.
 *   예) 7/31 → 8/31,  1/31 → 2/28
 */
/**
 * 기준일을 A1 한 칸으로 통일한다.
 *
 * 원래는 B7:B9(병합 셀)에 기준일이 있었는데, 병합이라 값을 넣기가 까다롭고
 * 실수로 지워지기도 쉬웠다. 그래서 병합되지 않은 A1을 기준으로 옮겼다.
 *
 *   A1  = 그 달의 1일          (이 시트가 다루는 달을 나타내는 기준일)
 *   A51 = EOMONTH($B$7, 0)     그 달의 말일
 *   A52 = MIN($A$51, TODAY())  말일과 오늘 중 이른 날
 */
function setupBaseDate_(sheet, year, month) {
  var cell = sheet.getRange(BASE_DATE_CELL);

  // B7:B9처럼 병합돼 있으면 값은 좌상단 칸에만 쓸 수 있다.
  var merged = cell.getMergedRanges();
  if (merged.length) cell = merged[0].getCell(1, 1);

  var old = toDate_(cell.getValue());

  // 날짜를 Date 객체로 넣으면 스크립트와 시트의 시간대가 다를 때 하루가 밀린다.
  // (예: 스크립트 한국시간 8/1 00:00 → 시트가 미국시간이면 7/31로 표시)
  // =DATE(연,월,1) 수식으로 넣으면 시트가 직접 계산하므로 시간대와 무관하다.
  try {
    cell.setFormula('=DATE(' + year + ',' + month + ',1)');
    SpreadsheetApp.flush();

    // 시트가 실제로 어떤 날짜로 계산했는지 확인한다.
    // 시간대 값이 비어 있는 스프레드시트가 있어 안전하게 대체값을 둔다.
    var tz = TIMEZONE;
    try {
      var sstz = sheet.getParent().getSpreadsheetTimeZone();
      if (sstz && typeof sstz === 'string') tz = sstz;
    } catch (e) { /* 시간대를 못 읽으면 기본값 사용 */ }

    var saved = cell.getValue();
    var savedStr = '(확인 실패)';
    var shownMonth = null;
    try {
      if (saved instanceof Date) {
        savedStr    = Utilities.formatDate(saved, tz, 'yyyy-MM-dd');
        shownMonth  = Number(Utilities.formatDate(saved, tz, 'M'));
      } else {
        savedStr = JSON.stringify(saved);
      }
    } catch (e) {
      savedStr = String(saved);
    }

    Logger.log('  기준일 ' + cell.getA1Notation() + ' → ' + savedStr
      + '   [시간대 ' + tz + ']'
      + (old ? '' : '  (비어 있던 칸을 채웠습니다)'));

    if (shownMonth !== null && shownMonth !== month) {
      Logger.log('  ⚠️ 시트에는 ' + shownMonth + '월로 보입니다. B7 셀 서식을 "날짜"로 바꿔보세요.');
    }
    return true;
  } catch (e) {
    Logger.log('  ⚠️ 기준일 설정 실패: ' + e.message);
    return false;
  }
}

/** 날짜 값 또는 "2026. 7. 31" 같은 문자열을 Date로 바꾼다 */
function toDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === 'string' && v.trim()) {
    var m = v.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (m) {
      var hh = 0, mi = 0;
      var t = v.match(/(\d{1,2}):(\d{2})/);
      if (t) {
        hh = parseInt(t[1], 10); mi = parseInt(t[2], 10);
        if (/오후/.test(v) && hh < 12) hh += 12;
        if (/오전/.test(v) && hh === 12) hh = 0;
      }
      return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), hh, mi);
    }
  }
  return null;
}

/**
 * 진단용 — B7:B9와 A50:A52에 실제로 무엇이 들어 있는지 확인한다.
 * GAS 편집기에서 직접 실행하고 [실행 로그]를 확인하세요.
 */
function checkBaseDates() {
  var now = new Date();
  var name = String(now.getFullYear()).slice(2) + '년 ' + (now.getMonth() + 1) + '월 손익계산서';

  ['백석점', '원당점'].forEach(function (branchName) {
    var config = BRANCH_CONFIG[branchName];
    if (!config) return;
    var ss = SpreadsheetApp.openById(config.ssId);
    var sh = ss.getSheetByName(name);
    Logger.log('\n===== [' + branchName + '] ' + name + ' =====');
    if (!sh) { Logger.log('  시트 없음'); return; }

    // 병합 여부
    var merges = sh.getRange('A1:C60').getMergedRanges().map(function (r) { return r.getA1Notation(); });
    Logger.log('  A1:C60 병합된 범위: ' + (merges.length ? merges.join(', ') : '없음'));

    ['B7', 'B8', 'B9', 'A50', 'A51', 'A52'].forEach(function (a1) {
      var c = sh.getRange(a1);
      var v = c.getValue();
      var f = c.getFormula();
      Logger.log('  ' + a1
        + ' | 값: ' + (v instanceof Date
            ? Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd HH:mm') + ' (Date)'
            : JSON.stringify(v) + ' (' + typeof v + ')')
        + (f ? ' | 수식: ' + f : ''));
    });
  });
  Logger.log('\n위 내용을 그대로 알려주시면 정확히 맞춰 고칠 수 있습니다.');
}

/**
 * 이번 달 시트의 기준일을 A1로 세팅하고 A51·A52 수식을 다시 건다.
 * 기준일이 지워졌거나 이전 달을 가리킬 때 GAS 편집기에서 직접 실행.
 */
function fixBaseDatesForCurrentMonth() {
  var now = new Date();
  var name = String(now.getFullYear()).slice(2) + '년 ' + (now.getMonth() + 1) + '월 손익계산서';

  ['백석점', '원당점'].forEach(function (branchName) {
    var config = BRANCH_CONFIG[branchName];
    if (!config) return;
    var ss = SpreadsheetApp.openById(config.ssId);
    var sh = ss.getSheetByName(name);
    if (!sh) { Logger.log('[' + branchName + '] ' + name + ' 없음'); return; }
    Logger.log('\n[' + branchName + '] ' + name);
    setupBaseDate_(sh, now.getFullYear(), now.getMonth() + 1);

    // A51·A52가 비어 있거나 깨졌으면 되살린다 (평소엔 손대지 않음)
    var a51 = sh.getRange('A51'), a52 = sh.getRange('A52');
    if (!a51.getFormula()) { a51.setFormula('=EOMONTH($B$7,0)');   Logger.log('  A51 수식 복구'); }
    if (!a52.getFormula()) { a52.setFormula('=MIN($A$51,TODAY())'); Logger.log('  A52 수식 복구'); }
  });

  SpreadsheetApp.flush();
  Logger.log('\n✅ 완료 — 시트에서 B7(기준일), A51(말일), A52(오늘까지)를 확인하세요.');
}

/**
 * 시트 전체에서 특정 셀(예: B7)을 참조하는 수식을 찾아 알려준다.
 * 기준일을 옮겼을 때 놓친 수식이 없는지 확인용.
 */
function findFormulasReferencing_(sheet, ref) {
  var formulas = sheet.getDataRange().getFormulas();
  var re = new RegExp('(^|[^A-Z0-9$])\\$?' + ref.replace(/(\d+)/, '\\$?$1') + '([^0-9]|$)');
  var hits = [];
  for (var r = 0; r < formulas.length; r++) {
    for (var c = 0; c < formulas[r].length; c++) {
      var f = formulas[r][c];
      if (f && re.test(f)) {
        hits.push(sheet.getRange(r + 1, c + 1).getA1Notation() + ' : ' + f);
      }
    }
  }
  if (hits.length) {
    Logger.log('  ⚠️ 아직 ' + ref + '을 참조하는 수식 ' + hits.length + '개');
    hits.slice(0, 15).forEach(function (h) { Logger.log('     ' + h); });
    Logger.log('     (기준일 셀이므로 정상입니다)');
  } else {
    Logger.log('  ' + ref + '을 참조하는 수식 없음 ✅');
  }
}

// 수동 테스트용 (지금 당장 이번 달 탭 만들고 싶을 때)
function test월별탭생성_백석점() { createMonthlyTab('백석점'); }
function test월별탭생성_원당점() { createMonthlyTab('원당점'); }


// ============================================================
// 🛠️ 테스트 & 유틸리티
// ============================================================

function test원당점()    { processFiles("원당점"); }
function test백석점()    { processFiles("백석점"); }
function testNaverSync() { syncNaverAdCost(); }

function testGeminiConnection() {
  var res = UrlFetchApp.fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent?key=" + GEMINI_API_KEY,
    { method:"post", contentType:"application/json",
      payload: JSON.stringify({ contents: [{ parts: [{ text: "안녕! 한 문장으로만 대답해." }] }] }),
      muteHttpExceptions: true }
  );
  Logger.log("응답 코드: " + res.getResponseCode());
  Logger.log("응답 내용: " + res.getContentText().substring(0, 300));
}


// ============================================================
// 📦 고기값 / 주류·음료 원가 자동화
// ─ 올바른 방식: 지출및매출로그에 행 추가 → SUMIF가 월별탭에 자동 반영 ─
// ============================================================

// ── 입고기록 스프레드시트 ID
var STOCK_SS_ID = '10v0LxS97dofRa_jE7U2gYzwveqrxfGirCD9B-Zuon5o';

// ── 고기 단가 (1보/1개 기준)
var MEAT_PRICES = {
  '곱창':   160000,
  '대창':    30000,
  '막창':    10000,
  '천엽':    20000,
  '간(반)':  10000,
  '간':      20000
};

// ── 음료수 단가 (1케이스)
var DRINK_PRICES = {
  '콜라':       23000,
  '사이다':     22000,
  '제로콜라':   21000,
  '파인애플':   20000,
  '웰치스포도': 19000
};

// ── 주류 단가 (1케이스/박스 기준)
// ⚠️ 매출처원장(태경) 실제 소계 금액으로 수정 필요!
var LIQUOR_PRICES = {
  '참이슬후래쉬': 35000,
  '처음처럼':     33000,
  '새로':         33000,
  '진로':         33000,
  '참이슬빨뚜':   35000,
  '카스':         27000,
  '테라':         29000,
  '켈리':         28000,
  '일품진로':     40000,
  '복분자':           0,
  '청하':         25000,
  '매화수':       35000
};

/**
 * 날짜 파싱: "26.07.25(토)" → {year:2026, month:7, day:25, ymd:"2026-07-25"}
 */
function parseMeatDateStr(dateStr) {
  var m = String(dateStr).match(/^(\d{2})\.(\d{2})\.(\d{2})/);
  if (!m) return null;
  var year  = 2000 + parseInt(m[1]);
  var month = parseInt(m[2]);
  var day   = parseInt(m[3]);
  return {
    year:  year,
    month: month,
    day:   day,
    ymd:   year + '-' + String(month).padStart(2,'0') + '-' + String(day).padStart(2,'0')
  };
}

/**
 * 고기 원가 계산
 */
function calcMeatCost(gc, dc, mc, extrasArr) {
  var cost = 0;
  cost += (Number(gc) || 0) * (MEAT_PRICES['곱창'] || 0);
  cost += (Number(dc) || 0) * (MEAT_PRICES['대창'] || 0);
  cost += (Number(mc) || 0) * (MEAT_PRICES['막창'] || 0);
  (extrasArr || []).forEach(function(name) {
    name = String(name).trim();
    if (MEAT_PRICES[name]) cost += MEAT_PRICES[name];
    else if (name) Logger.log('  ⚠️ extras 단가 없음: "' + name + '"');
  });
  return cost;
}

/**
 * 지출및매출로그에 자동 항목 upsert
 * - 동일 marker가 있으면 금액 업데이트
 * - 없으면 새 행 추가
 * - marker는 원본파일명 컬럼(F=index5)에 저장 → 중복 방지
 *
 * @param {Sheet}  logSheet   지출및매출로그 시트
 * @param {string} ymd        "YYYY-MM-DD"
 * @param {string} category   분류 (e.g. "고기값", "주류원가", "음료원가")
 * @param {string} itemName   항목명
 * @param {number} amount     금액
 * @param {string} branch     지점명 ("백석점" etc.)
 * @param {string} marker     고유 식별자 (원본파일명 컬럼에 저장)
 */
function upsertLogEntry(logSheet, ymd, category, itemName, amount, branch, marker) {
  if (amount <= 0) return false;

  var nowStr  = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
  var lastRow = logSheet.getLastRow();

  // 기존 항목 검색 (F열 = 원본파일명 = marker)
  if (lastRow > 1) {
    var fCol = logSheet.getRange(2, 6, lastRow - 1, 1).getValues();
    for (var i = 0; i < fCol.length; i++) {
      if (String(fCol[i][0]).trim() === marker) {
        var rowNum = i + 2;
        logSheet.getRange(rowNum, 4).setValue(amount);   // D: 금액 갱신
        logSheet.getRange(rowNum, 7).setValue(nowStr);   // G: 처리시각 갱신
        Logger.log('🔄 업데이트 [' + category + '] ' + ymd + ' → ' + amount.toLocaleString() + '원');
        SpreadsheetApp.flush();
        return true;
      }
    }
  }

  // 신규 행 추가
  // 컬럼 순서: 날짜, 분류, 항목명, 금액, 지점, 원본파일명(=marker), 처리시각, 파일ID
  logSheet.appendRow([ymd, category, itemName, amount, branch, marker, nowStr, '']);
  Logger.log('✅ 추가 [' + category + '] ' + ymd + ' ' + amount.toLocaleString() + '원');
  SpreadsheetApp.flush();
  return true;
}

/**
 * 입고기록 → 지출및매출로그 "고기값" 항목 동기화
 *
 * 동작:
 *  1. 입고기록 시트를 날짜별로 합산 (같은 날 여러 행 있으면 합산)
 *  2. 지점 손익계산서 스프레드시트의 지출및매출로그에 upsert
 *  3. 월별탭의 SUMIF가 자동으로 반영
 *
 * ⚠️ 주의: 이전에 월별탭 셀에 직접 쓴 값이 있으면 SUMIF와 충돌할 수 있음
 *         → 월별탭 "고기값" 행의 직접 입력값은 수동으로 지워야 함
 */
function syncMeatCosts(branchName) {
  Logger.log('\n--- [' + branchName + '] 고기값 동기화 시작 (→ 지출및매출로그) ---');

  var stockSS = SpreadsheetApp.openById(STOCK_SS_ID);
  var inSheet = stockSS.getSheetByName('입고기록');
  if (!inSheet) { Logger.log('입고기록 시트 없음'); return; }

  var config   = BRANCH_CONFIG[branchName];
  var profitSS = SpreadsheetApp.openById(config.ssId);
  var logSheet = profitSS.getSheetByName('지출및매출로그') || profitSS.insertSheet('지출및매출로그');
  ensureHeaders(logSheet);

  var rows    = inSheet.getDataRange().getValues();
  var dateMap = {};   // ymd → { cost, detail }

  for (var i = 1; i < rows.length; i++) {
    var row       = rows[i];
    var dateStr   = String(row[0] || '').trim();   // A: "26.07.25(토)"
    var branch    = String(row[1] || '').trim();   // B: "백석점"
    var gc        = Number(row[2]) || 0;           // C: 곱창
    var dc        = Number(row[3]) || 0;           // D: 대창
    var mc        = Number(row[4]) || 0;           // E: 막창
    var extrasStr = String(row[6] || '').trim();   // G: "천엽, 간(반)"

    if (branch !== branchName || !dateStr) continue;

    var parsed = parseMeatDateStr(dateStr);
    if (!parsed) { Logger.log('날짜 파싱 실패: ' + dateStr); continue; }

    var extras = extrasStr
      ? extrasStr.split(',').map(function(s) { return s.trim(); }).filter(Boolean)
      : [];

    var cost = calcMeatCost(gc, dc, mc, extras);
    if (cost === 0) continue;

    if (!dateMap[parsed.ymd]) dateMap[parsed.ymd] = { cost: 0, parts: [] };
    dateMap[parsed.ymd].cost += cost;

    // 항목명 설명 (예: "곱창2보+막창3보+천엽")
    var parts = [];
    if (gc > 0) parts.push('곱창' + gc + '보');
    if (dc > 0) parts.push('대창' + dc + '보');
    if (mc > 0) parts.push('막창' + mc + '보');
    extras.forEach(function(e) { if (e) parts.push(e); });
    dateMap[parsed.ymd].parts = dateMap[parsed.ymd].parts.concat(parts);
  }

  var count = 0;
  Object.keys(dateMap).sort().forEach(function(ymd) {
    var entry   = dateMap[ymd];
    var marker  = '[자동]고기값_' + branchName + '_' + ymd;
    var detail  = entry.parts.join('+') || '입고기록 자동집계';
    if (upsertLogEntry(logSheet, ymd, '고기값', detail, entry.cost, branchName, marker)) {
      count++;
    }
    Utilities.sleep(50);
  });

  Logger.log('고기값 동기화 완료: ' + count + '건');
}

/**
 * 식자재발주 → 지출및매출로그 "주류원가"/"음료원가" 항목 동기화
 *
 * 식자재발주 탭 구조: A=날짜, B=지점, C=업체, D=발주항목(body텍스트), E=채널, F=즉시/예약
 * D열 body 예시: "[백석점 발주 7/27(일)]\n카스 2, 테라 1"
 *
 * ⚠️ D열에 수량 정보가 있어야 금액 계산됨.
 *    수량이 없으면 0원 → 로그 기록 건너뜀.
 */
function syncLiquorCosts(branchName) {
  Logger.log('\n--- [' + branchName + '] 주류·음료 동기화 시작 (→ 지출및매출로그) ---');

  var stockSS = SpreadsheetApp.openById(STOCK_SS_ID);
  var sheet   = stockSS.getSheetByName('식자재발주');
  if (!sheet) { Logger.log('식자재발주 시트 없음'); return; }

  var config   = BRANCH_CONFIG[branchName];
  var profitSS = SpreadsheetApp.openById(config.ssId);
  var logSheet = profitSS.getSheetByName('지출및매출로그') || profitSS.insertSheet('지출및매출로그');
  ensureHeaders(logSheet);

  var rows  = sheet.getDataRange().getValues();
  var count = 0;

  for (var i = 1; i < rows.length; i++) {
    var row      = rows[i];
    var dateVal  = row[0];
    var branch   = String(row[1] || '').trim();
    var supplier = String(row[2] || '').trim();   // "주류" or "음료수"
    var bodyText = String(row[3] || '').trim();

    if (branch !== branchName) continue;
    if (supplier !== '주류' && supplier !== '음료수') continue;

    // 날짜 파싱 (Date 객체 / YYYY-MM-DD / YY.MM.DD(요일) 세 형식 모두 처리)
    var ymd;
    if (dateVal instanceof Date) {
      ymd = dateVal.getFullYear() + '-' +
            String(dateVal.getMonth() + 1).padStart(2,'0') + '-' +
            String(dateVal.getDate()).padStart(2,'0');
    } else {
      var s = String(dateVal).trim();
      var dm = s.match(/(\d{4})-(\d{2})-(\d{2})/);          // YYYY-MM-DD
      var dm2 = s.match(/(\d{2})\.(\d{2})\.(\d{2})/);        // YY.MM.DD(요일)
      if (dm) {
        ymd = dm[1] + '-' + dm[2] + '-' + dm[3];
      } else if (dm2) {
        ymd = '20' + dm2[1] + '-' + dm2[2] + '-' + dm2[3];  // 26.06.07 → 2026-06-07
      } else {
        Logger.log('날짜 파싱 실패: ' + dateVal); continue;
      }
    }

    // body 파싱: "[백석점 발주 ...]\n품목 수량, ..." 또는 "품목 수량, ..." 두 형식 모두 처리
    var itemLine;
    if (bodyText.includes('\n')) {
      itemLine = bodyText.split('\n').slice(1).join(' ').trim();
    } else {
      itemLine = bodyText.trim();
    }
    if (!itemLine) { Logger.log('품목 정보 없음 (row ' + (i+1) + ')'); continue; }

    var prices      = (supplier === '주류') ? LIQUOR_PRICES : DRINK_PRICES;
    var category    = (supplier === '주류') ? '주류원가' : '음료원가';
    var totalCost   = 0;
    var itemDetails = [];

    itemLine.split(',').forEach(function(part) {
      var p       = part.trim();
      var matched = p.match(/^(.+?)\s+(\d+)$/);
      var name, qty;
      if (matched) {
        name = matched[1].trim();
        qty  = parseInt(matched[2]);
      } else {
        name = p;
        qty  = 1;  // 수량 표기 없으면 1개로 처리
      }
      if (!name) return;
      var price = prices[name] || 0;
      if (price > 0) {
        totalCost += price * qty;
        itemDetails.push(name + ' ' + qty);
        Logger.log('  ' + name + ' × ' + qty + ' × ' + price.toLocaleString() + ' = ' + (price*qty).toLocaleString() + '원');
      } else {
        Logger.log('  ⚠️ 단가 없음: ' + name);
      }
    });

    if (totalCost > 0) {
      var marker = '[자동]' + category + '_' + branchName + '_' + ymd + '_row' + i;
      var detail = itemDetails.join(', ') || supplier + ' 발주 자동집계';
      if (upsertLogEntry(logSheet, ymd, category, detail, totalCost, branchName, marker)) {
        count++;
      }
    }
  }

  Logger.log('주류·음료 동기화 완료: ' + count + '건');
}

// ============================================================
// 👷 인건비 자동화 (알바계산기 → 지출및매출로그)
// ─ 알바계산기 GAS에서 payments 조회 → 세전(gross) 합산 → 인건비 기록 ─
// ============================================================

var ALBA_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxGpa_Zyok-eV63Otf3C-WpVpiOt8gb4_W18g097IEL9iCUdlBrhMuNltU49u_Cuy5zNQ/exec';

/**
 * 지점 연결이 끊긴 지급 건을 어느 지점으로 볼지
 *
 *   퇴사 기능(soft delete)이 생기기 전에 삭제된 알바는 workers 에서 사라졌다.
 *   지급 기록(payments)만 남아 지점을 알 수 없게 됐고, 그 급여가
 *   어느 손익계산서에도 안 잡히고 있었다.
 *
 *   check지점불명() 을 실행하면 wid 가 나온다. 여기에 적으면 다시 집계된다.
 *   적은 뒤에는 인건비_전체동기화_적용() 으로 해당 월을 다시 돌릴 것.
 */
var ORPHAN_WID_BRANCH = {
  // 강형모 — 퇴사 기능(soft delete) 생기기 전에 삭제되어 지점 연결이 끊김
  //   2026-05  1,651,100원
  //   2026-06  1,379,400원
  'mptjt1dwn2c': '백석점',
};

/**
 * 알바계산기 데이터 → 지출및매출로그 "인건비" upsert
 *
 * @param {string} branchName  지점명 ("백석점" 등)
 * @param {string} ym          대상 연월 "YYYY-MM" (생략 시 이전 달)
 *
 * 사용법: syncLaborCosts('백석점', '2026-07')
 *
 * 선행 조건: 알바계산기에서 해당 월 지급완료 처리가 되어 있어야 함
 */
function syncLaborCosts(branchName, ym) {
  // ym 기본값: 이전 달
  if (!ym) {
    var now = new Date();
    var prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    ym = prev.getFullYear() + '-' + String(prev.getMonth() + 1).padStart(2, '0');
  }

  Logger.log('\n--- [' + branchName + '] 인건비 동기화 시작 (' + ym + ') ---');

  // ① 알바계산기 GAS에서 데이터 조회
  var res;
  try {
    res = UrlFetchApp.fetch(ALBA_SCRIPT_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
  } catch(e) {
    Logger.log('알바계산기 GAS 호출 실패: ' + e.message);
    return;
  }

  var data;
  try {
    var json = JSON.parse(res.getContentText());
    if (!json.ok || !json.data) { Logger.log('알바계산기 데이터 없음: ' + res.getContentText().slice(0,200)); return; }
    data = json.data;
  } catch(e) {
    Logger.log('응답 파싱 실패: ' + e.message);
    return;
  }

  // ② 브랜치 ID 찾기
  var branches = data.branches || [];
  var targetBranch = branches.find(function(b) { return b.name === branchName; });
  if (!targetBranch) {
    Logger.log('알바계산기에 [' + branchName + '] 지점 없음. 등록된 지점: ' + branches.map(function(b){return b.name;}).join(', '));
    return;
  }
  var branchId = targetBranch.id;
  Logger.log('브랜치 ID: ' + branchId + ' (' + branchName + ')');

  // ③ 해당 월 + 지점 payments 필터링 → 세전(gross) 합산
  var payments = data.payments || [];
  var monthPayments = payments.filter(function(p) {
    return p.ym === ym && p.wid && true; // wid로 worker 매핑 필요
  });

  // workers를 통해 branchId 매핑
  var workers = data.workers || [];
  var branchWorkerIds = workers
    .filter(function(w) { return w.branchId === branchId; })
    .map(function(w) { return w.id; });

  // ③-B 고아 지급 건 구제
  //
  //   퇴사 처리에 soft delete 가 없던 시절, 알바를 지우면 workers 에서 사라졌다.
  //   그런데 payments 는 그대로 남는다. 그러면 wid 로 지점을 못 찾아
  //   그 사람 급여가 어느 손익계산서에도 안 잡힌다. (조용한 누락)
  //
  //   아래 표에 wid → 지점 을 적어두면 다시 집계된다.
  //   wid 는 check지점불명() 을 실행하면 나온다.
  Object.keys(ORPHAN_WID_BRANCH).forEach(function(wid) {
    if (ORPHAN_WID_BRANCH[wid] === branchName && branchWorkerIds.indexOf(wid) === -1) {
      branchWorkerIds.push(wid);
      Logger.log('  ↩ 고아 지급 건 구제: ' + wid + ' → ' + branchName);
    }
  });

  var filtered = payments.filter(function(p) {
    return p.ym === ym && branchWorkerIds.indexOf(p.wid) !== -1;
  });

  if (filtered.length === 0) {
    Logger.log('지급완료 데이터 없음 — 알바계산기에서 ' + ym + ' 지급완료 처리를 먼저 해주세요');
    return;
  }

  var totalGross = filtered.reduce(function(s, p) { return s + (p.gross || 0); }, 0);
  Logger.log('지급 인원: ' + filtered.length + '명 / 세전 합계: ' + totalGross.toLocaleString() + '원');

  // ④ 지출및매출로그에 upsert
  var config   = BRANCH_CONFIG[branchName];
  var profitSS = SpreadsheetApp.openById(config.ssId);
  var logSheet = profitSS.getSheetByName('지출및매출로그') || profitSS.insertSheet('지출및매출로그');
  ensureHeaders(logSheet);

  var ymd    = ym + '-01';  // 해당 월 1일로 기록
  var marker = '[자동]인건비_' + branchName + '_' + ym;

  upsertLogEntry(logSheet, ymd, '인건비', branchName + ' ' + ym + ' 급여', totalGross, branchName, marker);
  Logger.log('✅ 인건비 기록 완료: ' + totalGross.toLocaleString() + '원 → ' + marker);
}

/**
 * 진단용 — 인건비가 어느 달에 얼마로 기록돼 있는지 확인한다.
 * GAS 편집기에서 직접 실행하고 [실행 로그]를 보세요.
 */
// ═══════════════════════════════════════════════════════════
// 템플릿 vs 7월 수식 비교 (백석점)
//
//  새 달 시트는 "26년 x월 손익계산서" 템플릿을 복사해서 만든다.
//  7월 시트는 그동안 손으로 고쳐온 반면 템플릿은 방치돼 있었다.
//  → 템플릿에 빠진 수식은 매달 새로 생기는 시트마다 계속 빠진다.
//
//  값(숫자)은 비교하지 않는다. 달마다 다른 게 정상이라 노이즈만 된다.
//  수식만 본다. 같은 주소끼리 비교하므로 G/H 열 참조 차이는 문제되지 않는다.
//
//  56행 아래는 과거 잔재라 보지 않는다 (사장님 확인).
// ═══════════════════════════════════════════════════════════

function 템플릿비교_백석() {
  var BRANCH   = '백석점';
  var TEMPLATE = '26년 x월 손익계산서';
  var GOOD     = '26년 7월 손익계산서';
  var LAST_ROW = 55;     // 56행 아래는 과거 데이터 — 무시
  var LAST_COL = 37;     // A~AK
  var MAX_LOG  = 80;     // 로그 폭주 방지

  var config = BRANCH_CONFIG[BRANCH];
  var ss = SpreadsheetApp.openById(config.ssId);
  var tpl = ss.getSheetByName(TEMPLATE);
  var good = ss.getSheetByName(GOOD);

  if (!tpl)  { Logger.log('✗ 템플릿 탭 없음: ' + TEMPLATE); return; }
  if (!good) { Logger.log('✗ 기준 탭 없음: ' + GOOD); return; }

  var fT = tpl.getRange(1, 1, LAST_ROW, LAST_COL).getFormulas();
  var fG = good.getRange(1, 1, LAST_ROW, LAST_COL).getFormulas();
  var vT = tpl.getRange(1, 1, LAST_ROW, LAST_COL).getDisplayValues();
  var vG = good.getRange(1, 1, LAST_ROW, LAST_COL).getDisplayValues();
  var labels = good.getRange(1, 2, LAST_ROW, 1).getDisplayValues();

  var 빠짐 = [], 다름 = [], 잔재 = [];

  for (var r = 0; r < LAST_ROW; r++) {
    for (var c = 0; c < LAST_COL; c++) {
      var a = String(fT[r][c] || '').replace(/\s+/g, '');
      var b = String(fG[r][c] || '').replace(/\s+/g, '');
      if (a === b) continue;

      var addr = colLetter_(c + 1) + (r + 1);
      var label = String(labels[r][0] || '').trim();
      var item = {
        addr: addr,
        label: label,
        tpl: fT[r][c] || ('값:' + (vT[r][c] || '(빈칸)')),
        good: fG[r][c] || ('값:' + (vG[r][c] || '(빈칸)')),
      };

      if (!a && b)      빠짐.push(item);   // 템플릿에만 없음 → 매달 빠진다
      else if (a && !b) 잔재.push(item);   // 7월에서 지운 것
      else              다름.push(item);   // 둘 다 있는데 내용이 다름
    }
  }

  Logger.log('╔═══ [' + BRANCH + '] 템플릿 vs 7월 수식 비교 ═══');
  Logger.log('║ 범위: A1:' + colLetter_(LAST_COL) + LAST_ROW);
  Logger.log('║ 🔴 템플릿에 빠진 수식 : ' + 빠짐.length + '개   ← 매달 새 시트마다 빠짐');
  Logger.log('║ 🟡 수식이 서로 다름   : ' + 다름.length + '개');
  Logger.log('║ 🔵 7월에서 지운 것    : ' + 잔재.length + '개');

  dumpDiff_('🔴 템플릿에 빠진 수식 (가장 중요)', 빠짐, MAX_LOG);
  dumpDiff_('🟡 수식이 서로 다름', 다름, MAX_LOG);
  dumpDiff_('🔵 7월에서 지운 것 (대개 무시해도 됨)', 잔재, 20);

  Logger.log('\n※ 읽기만 했습니다. 아무것도 바꾸지 않았습니다.');
}

function dumpDiff_(title, list, max) {
  if (!list.length) return;
  Logger.log('\n───── ' + title + ' (' + list.length + '개) ─────');
  for (var i = 0; i < Math.min(list.length, max); i++) {
    var d = list[i];
    Logger.log('  ' + d.addr + (d.label ? ' [' + d.label + ']' : ''));
    Logger.log('     템플릿: ' + String(d.tpl).slice(0, 110));
    Logger.log('     7월  : ' + String(d.good).slice(0, 110));
  }
  if (list.length > max) Logger.log('  ... 외 ' + (list.length - max) + '개 더');
}

function colLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}

/** B열에서 라벨을 찾아 행 번호를 돌려준다 (공백 무시). 못 찾으면 -1 */
function findLabelRow_(sheet, label) {
  var last = Math.min(sheet.getLastRow(), 80);
  if (last < 1) return -1;
  var vals = sheet.getRange(1, 2, last, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).replace(/\s+/g, '') === label) return i + 1;
  }
  return -1;
}

function normalizeF_(f) { return String(f).replace(/\s+/g, ''); }

function checkLaborRow() {
  var COLS = ['A','B','C','D','E','F','G','H'];

  ['백석점', '원당점'].forEach(function (branchName) {
    var config = BRANCH_CONFIG[branchName];
    if (!config) return;
    var ss = SpreadsheetApp.openById(config.ssId);

    ['26년 x월 손익계산서', '26년 7월 손익계산서', '26년 8월 손익계산서'].forEach(function (tabName) {
      var sh = ss.getSheetByName(tabName);
      Logger.log('\n╔══ [' + branchName + '] ' + tabName + ' ══');
      if (!sh) { Logger.log('║  (탭 없음)'); return; }

      // 25~35행: 인건비 행 주변
      var f1 = sh.getRange(25, 1, 11, 8).getFormulas();
      var v1 = sh.getRange(25, 1, 11, 8).getDisplayValues();
      Logger.log('║ ── 25~35행 ──');
      for (var i = 0; i < f1.length; i++) {
        var line = '║ ' + (25 + i) + '행 |';
        for (var c = 0; c < 8; c++) {
          var s = f1[i][c] || v1[i][c];
          if (!s) continue;
          line += ' ' + COLS[c] + '=' + String(s).slice(0, 90) + ' |';
        }
        if (line.indexOf('=') > 0) Logger.log(line);
      }

      // 55~65행: SUM(F59:F63)이 가리키는 곳
      var f2 = sh.getRange(55, 1, 11, 8).getFormulas();
      var v2 = sh.getRange(55, 1, 11, 8).getDisplayValues();
      Logger.log('║ ── 55~65행 (F59:F63 확인) ──');
      for (var j = 0; j < f2.length; j++) {
        var l2 = '║ ' + (55 + j) + '행 |';
        for (var d = 0; d < 8; d++) {
          var s2 = f2[j][d] || v2[j][d];
          if (!s2) continue;
          l2 += ' ' + COLS[d] + '=' + String(s2).slice(0, 90) + ' |';
        }
        if (l2.indexOf('=') > 0) Logger.log(l2);
      }
    });
  });

  Logger.log('\n※ 이 로그를 그대로 복사해서 보내주세요. 아무것도 고치지 않았습니다.');
}

/**
 * 진단용 — 인건비가 어느 달에 얼마로 기록돼 있는지 확인한다.
 */
function checkLaborCosts() {
  ['백석점', '원당점'].forEach(function (branchName) {
    var config = BRANCH_CONFIG[branchName];
    if (!config) return;
    var ss = SpreadsheetApp.openById(config.ssId);
    var sh = ss.getSheetByName('지출및매출로그');
    Logger.log('\n===== [' + branchName + '] 지출및매출로그의 인건비 =====');
    if (!sh) { Logger.log('  로그 시트 없음'); return; }

    var rows = sh.getDataRange().getValues();
    var head = rows[0];
    var cDate = head.indexOf('날짜'),
        cCat  = head.indexOf('분류'),
        cName = head.indexOf('항목명'),
        cAmt  = head.indexOf('금액');

    var found = 0;
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][cCat]).indexOf('인건비') < 0) continue;
      var d = rows[i][cDate];
      var ds = (d instanceof Date) ? Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd') : String(d);
      Logger.log('  ' + ds + '  ' + Number(rows[i][cAmt]).toLocaleString() + '원  ' + rows[i][cName]);
      found++;
    }
    if (!found) Logger.log('  인건비 기록 없음');
  });

  Logger.log('\n※ 참고: 급여는 "전월분을 다음 달 1일에" 기록합니다.');
  Logger.log('   예) 8월 1일 자동실행 → 7월 급여를 2026-07-01 자로 기록');
  Logger.log('   8월 급여를 지금 넣고 싶으면 syncLaborCostsForMonth() 를 실행하세요.');
}

/**
 * 특정 월의 인건비를 지금 바로 동기화한다.
 * 아래 YM 값을 원하는 달로 바꾸고 실행하세요.
 * (알바계산기에서 그 달 "지급완료" 처리가 되어 있어야 합니다)
 */
function syncLaborCostsForMonth() {
  var YM = '2026-08';          // ← 넣고 싶은 달
  syncLaborCosts('백석점', YM);
  syncLaborCosts('원당점', YM);
}

/**
 * 소급 처리 (한 번만 수동 실행)
 * script.google.com → 함수 선택 → backfillFromStockRecords → ▶ 실행
 *
 * 실행 전 반드시 확인:
 *  1. 월별탭 "고기값" 행에 이전에 직접 입력된 값이 있으면 → 수식(SUMIF)이 맞는지 확인
 *     직접 입력값이 있으면 SUMIF 결과와 합산돼 이중 집계됨
 *  2. 지출및매출로그에 이미 잘못된 분류("육류원가", "기타잡비용" 등)로 기록된 이영자 계좌이체 항목은
 *     수동으로 분류값을 "고기값"으로 수정하거나 삭제 필요
 */
function backfillFromStockRecords() {
  Logger.log('=== 소급 처리 시작 (입고기록 + 식자재발주 → 지출및매출로그) ===');
  syncMeatCosts('백석점');
  syncLiquorCosts('백석점');
  Logger.log('=== 소급 처리 완료 ===');
}

// ============================================================
// 🧹 오염 복구 + 재동기화 (한 번만 실행)
//
// 이전 잘못된 backfill 코드가 월별탭 셀에 직접 값을 써서
// SUMIF 수식을 덮어썼을 경우, 이 함수 하나로 모두 복구됩니다.
//
// 처리 순서:
//  1. 지출및매출로그에서 "육류원가" 분류 → "고기값"으로 수정
//  2. 월별탭 "고기값" 행에 직접 입력된 숫자값 → SUMIF 수식 복원
//  3. 입고기록 → 지출및매출로그 정상 동기화
// ============================================================

function cleanupAndResync() {
  Logger.log('=== 오염 복구 + 재동기화 시작 ===');
  fixWrongLogCategories('백석점');
  restoreMonthlyFormulas('백석점');
  syncMeatCosts('백석점');
  Logger.log('=== 완료 ===');
}

/**
 * 지출및매출로그에서 잘못된 분류값 수정
 * "육류원가" → "고기값" (육류원가는 부모 계정이라 지출및매출로그에 있으면 안 됨)
 */
function fixWrongLogCategories(branchName) {
  Logger.log('\n--- 지출및매출로그 분류값 수정 ---');
  var config   = BRANCH_CONFIG[branchName];
  var ss       = SpreadsheetApp.openById(config.ssId);
  var logSheet = ss.getSheetByName('지출및매출로그');
  if (!logSheet) { Logger.log('지출및매출로그 없음'); return; }

  var lastRow = logSheet.getLastRow();
  if (lastRow <= 1) { Logger.log('데이터 없음'); return; }

  var categories = logSheet.getRange(2, 2, lastRow - 1, 1).getValues();
  var fixed = 0;

  categories.forEach(function(row, i) {
    var cat = String(row[0] || '').trim();
    if (cat === '육류원가') {
      logSheet.getRange(i + 2, 2).setValue('고기값');
      Logger.log('  row ' + (i + 2) + ': 육류원가 → 고기값');
      fixed++;
    }
  });

  if (fixed > 0) SpreadsheetApp.flush();
  Logger.log('분류 수정: ' + fixed + '건');
}

/**
 * 월별탭 "고기값" 행 복원
 * 2026년 4월부터 현재 월까지 순회하며:
 *  - 수식 없이 숫자값이 직접 입력된 셀(이전 잘못된 backfill 흔적) 발견 시
 *  - 같은 행의 정상 수식 셀에서 수식 복사 (상대 참조이면 열 자동 보정)
 */
function restoreMonthlyFormulas(branchName) {
  Logger.log('\n--- 월별탭 "고기값" 행 수식 복원 ---');
  var config = BRANCH_CONFIG[branchName];
  var ss     = SpreadsheetApp.openById(config.ssId);
  var now    = new Date();

  for (var year = 2026; year <= now.getFullYear(); year++) {
    var mStart = (year === 2026) ? 4 : 1;
    var mEnd   = (year === now.getFullYear()) ? (now.getMonth() + 1) : 12;
    for (var month = mStart; month <= mEnd; month++) {
      restoreGokiRowFormulas_(ss, year, month);
    }
  }
}

function restoreGokiRowFormulas_(ss, year, month) {
  var yy      = String(year).slice(2);
  var tabName = yy + '년 ' + month + '월 손익계산서';
  var sheet   = ss.getSheetByName(tabName);
  if (!sheet) { Logger.log(tabName + ': 시트 없음'); return; }

  // "고기값" 행 위치 찾기 (B열)
  var data    = sheet.getDataRange().getValues();
  var gokiRow = -1;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][1]).trim() === '고기값') { gokiRow = i + 1; break; }
  }
  if (gokiRow === -1) { Logger.log(tabName + ': 고기값 행 없음'); return; }

  // G(7)~AK(37) 열 검사: 수식 템플릿 찾기 + 오염 셀 목록
  var templateCol  = -1;
  var dirtyCols    = [];

  for (var col = 7; col <= 37; col++) {
    var cell    = sheet.getRange(gokiRow, col);
    var formula = cell.getFormula();
    var val     = cell.getValue();

    if (formula && formula.startsWith('=')) {
      if (templateCol === -1) templateCol = col;  // 수식이 살아있는 첫 번째 열 → 템플릿
    } else if (typeof val === 'number' && val > 0) {
      dirtyCols.push(col);  // 수식 없이 양수값 → 잘못 덮어쓴 셀
    }
  }

  Logger.log('[' + tabName + '] 오염 셀: ' + dirtyCols.length + '개 / 템플릿: ' + (templateCol > 0 ? 'col' + templateCol : '없음'));
  if (dirtyCols.length === 0) return;

  if (templateCol === -1) {
    // 수식 템플릿 없음 → 셀 내용만 지우기 (수식은 수동 복구 필요)
    dirtyCols.forEach(function(col) { sheet.getRange(gokiRow, col).clearContent(); });
    Logger.log('  ⚠️ 수식 없이 셀 비움 — ' + tabName + ' ' + gokiRow + '행 수식 수동 입력 필요');
  } else {
    // 템플릿 수식 셀 → 오염된 셀에 붙여넣기 (PASTE_FORMULA: 상대 참조 자동 보정)
    var src = sheet.getRange(gokiRow, templateCol);
    dirtyCols.forEach(function(col) {
      src.copyTo(
        sheet.getRange(gokiRow, col),
        SpreadsheetApp.CopyPasteType.PASTE_FORMULA,
        false
      );
      Logger.log('  수식 복원: col' + col);
    });
    Logger.log('  ✅ 수식 복원 완료');
  }

  SpreadsheetApp.flush();
}

// ============================================================
// 🔍 데이터 감사 및 정리 (아래 3개 함수를 순서대로 실행)
// ============================================================

/**
 * ① "기타 잡비용" (공백 포함) 항목 삭제
 *    - "기타 잡비용"(공백O)은 SUMIF에 잡히지 않아 이미 영향 없음
 *    - 안전하게 삭제 가능
 */
function deleteSpaceJetabi() {
  Logger.log('=== "기타 잡비용"(공백) 항목 삭제 시작 ===');
  var config   = BRANCH_CONFIG['백석점'];
  var ss       = SpreadsheetApp.openById(config.ssId);
  var logSheet = ss.getSheetByName('지출및매출로그');
  if (!logSheet) { Logger.log('지출및매출로그 없음'); return; }

  var lastRow = logSheet.getLastRow();
  if (lastRow <= 1) { Logger.log('데이터 없음'); return; }

  var deleted = 0;
  // 아래부터 위로 삭제해야 행 번호 어긋남 없음
  for (var r = lastRow; r >= 2; r--) {
    var cat = String(logSheet.getRange(r, 2).getValue()).trim();
    if (cat === '기타 잡비용') {   // 공백 있는 버전만 삭제
      logSheet.deleteRow(r);
      deleted++;
    }
  }

  SpreadsheetApp.flush();
  Logger.log('"기타 잡비용"(공백) 삭제: ' + deleted + '건');
}

/**
 * ② 이번 주 고기값 처리 현황 확인
 *    - Drive [완료] 파일 중 "고기값" 포함된 것 vs 지출및매출로그 대조
 *    - Logger에 결과 출력 (GAS 실행 로그에서 확인)
 */
function checkRecentGokiFiles() {
  Logger.log('=== 최근 7일 고기값 현황 확인 ===');
  var config   = BRANCH_CONFIG['백석점'];
  var ss       = SpreadsheetApp.openById(config.ssId);
  var logSheet = ss.getSheetByName('지출및매출로그');
  var folder   = DriveApp.getFolderById(config.folderId);

  // ── (A) Drive: 최근 7일 내 [완료] 고기값 파일
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);

  var driveFiles = [];
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    var nm = f.getName();
    if (!nm.startsWith('[완료]')) continue;
    if (!nm.includes('고기값')) continue;
    if (f.getDateCreated() < cutoff) continue;
    driveFiles.push({ name: nm, id: f.getId(), date: f.getDateCreated() });
  }

  Logger.log('\n[Drive 완료 파일 - 최근 7일 고기값]');
  if (driveFiles.length === 0) {
    Logger.log('  없음');
  } else {
    driveFiles.forEach(function(f) {
      Logger.log('  📁 ' + f.name);
    });
  }

  // ── (B) 지출및매출로그: 최근 7일 고기값 항목
  var lastRow = logSheet ? logSheet.getLastRow() : 1;
  Logger.log('\n[지출및매출로그 - 최근 7일 고기값]');
  if (!logSheet || lastRow <= 1) { Logger.log('  없음'); return; }

  var data = logSheet.getRange(2, 1, lastRow - 1, 8).getValues();
  var found = 0;

  data.forEach(function(row) {
    var dateVal  = row[0];
    var category = String(row[1] || '').trim();
    var itemName = String(row[2] || '').trim();
    var amount   = Number(row[3]) || 0;
    var source   = String(row[5] || '').trim();

    if (category !== '고기값') return;

    var entryDate = (dateVal instanceof Date) ? dateVal : new Date(String(dateVal));
    if (isNaN(entryDate.getTime()) || entryDate < cutoff) return;

    var tag = source.startsWith('[자동]') ? '[자동계산]' : '[이미지분석]';
    Logger.log('  ' + tag + ' ' + Utilities.formatDate(entryDate, 'Asia/Seoul', 'yyyy-MM-dd') +
               ' | ' + amount.toLocaleString() + '원 | ' + itemName.slice(0, 30));
    found++;
  });

  if (found === 0) Logger.log('  고기값 항목 없음');

  // ── (C) Drive 파일 vs 로그 대조
  Logger.log('\n[대조 결과]');
  driveFiles.forEach(function(f) {
    var matched = data.some(function(row) {
      return String(row[5] || '').trim() === f.id || String(row[5] || '').trim() === f.name;
    });
    Logger.log('  ' + (matched ? '✅ 로그 있음' : '❌ 로그 없음') + ' → ' + f.name);
  });
}

/**
 * ③ 4월 이후 고기값 데이터 통합 정리
 *    - [자동]고기값 항목이 있는 날짜에 이미지분석 중복 항목 제거
 *    - 결과를 "자동화감사" 시트에 요약 출력
 *
 * 로직:
 *  날짜별로 [자동] 항목이 존재하면 → 같은 날짜 非[자동] 고기값 항목 삭제 (중복 방지)
 *  [자동] 항목이 없는 날짜 → 기존 항목 유지 (손댐 없음)
 */
function consolidateGokiLog() {
  Logger.log('=== 4월 이후 고기값 데이터 정리 ===');
  var config   = BRANCH_CONFIG['백석점'];
  var ss       = SpreadsheetApp.openById(config.ssId);
  var logSheet = ss.getSheetByName('지출및매출로그');
  if (!logSheet) { Logger.log('지출및매출로그 없음'); return; }

  var lastRow = logSheet.getLastRow();
  if (lastRow <= 1) { Logger.log('데이터 없음'); return; }

  var data = logSheet.getRange(2, 1, lastRow - 1, 8).getValues();

  // 날짜별로 [자동] 항목 존재 여부 먼저 파악
  var autoDateSet = {};   // ymd → true
  data.forEach(function(row) {
    if (String(row[1] || '').trim() !== '고기값') return;
    var src = String(row[5] || '').trim();
    if (!src.startsWith('[자동]')) return;
    var dateStr = normalizeDate_(row[0]);
    if (dateStr) autoDateSet[dateStr] = true;
  });

  Logger.log('[자동] 항목 있는 날짜: ' + Object.keys(autoDateSet).length + '일');

  // 아래→위 순서로 삭제 (행 번호 어긋남 방지)
  var deletedRows = [];
  for (var r = lastRow; r >= 2; r--) {
    var row      = data[r - 2];
    var category = String(row[1] || '').trim();
    var src      = String(row[5] || '').trim();
    if (category !== '고기값') continue;
    if (src.startsWith('[자동]')) continue;   // [자동] 항목은 유지

    var dateStr = normalizeDate_(row[0]);
    if (!dateStr) continue;
    if (!autoDateSet[dateStr]) continue;       // [자동] 없는 날짜는 유지

    // [자동]이 있는 날짜의 非[자동] 항목 → 삭제
    deletedRows.push({ date: dateStr, amount: row[3], source: src.slice(0, 40) });
    logSheet.deleteRow(r);
  }

  SpreadsheetApp.flush();

  Logger.log('삭제: ' + deletedRows.length + '건');
  deletedRows.forEach(function(d) {
    Logger.log('  ✂ ' + d.date + ' | ' + d.amount + '원 | ' + d.source);
  });

  // 감사 리포트 시트 생성
  var auditSheet = ss.getSheetByName('자동화감사') || ss.insertSheet('자동화감사');
  auditSheet.clearContents();
  auditSheet.appendRow(['날짜', '분류', '항목명', '금액', '지점', '원본파일명', '처리시각', '비고']);

  // 현재 상태 스냅샷 (4월 이후 고기값)
  var updatedData = logSheet.getDataRange().getValues();
  var snapCount   = 0;
  updatedData.slice(1).forEach(function(row) {
    if (String(row[1] || '').trim() !== '고기값') return;
    var dateStr = normalizeDate_(row[0]);
    if (!dateStr || dateStr < '2026-04-01') return;
    var isAuto = String(row[5] || '').startsWith('[자동]') ? '자동계산' : '이미지분석';
    auditSheet.appendRow([row[0], row[1], row[2], row[3], row[4], row[5], row[6], isAuto]);
    snapCount++;
  });

  SpreadsheetApp.flush();
  Logger.log('\n✅ "자동화감사" 시트에 현재 고기값 항목 ' + snapCount + '건 기록됨');
  Logger.log('스프레드시트에서 "자동화감사" 탭을 열어 확인하세요.');
}

// 날짜 정규화 헬퍼 (다양한 형식 → "YYYY-MM-DD")
function normalizeDate_(dateVal) {
  if (dateVal instanceof Date) {
    return Utilities.formatDate(dateVal, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  var s = String(dateVal || '').trim();
  var m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  return null;
}

// ============================================================
// 🔁 고기값 거래명세서 재처리 (Drive에서 이미 [완료]된 파일 재분석)
// ============================================================
/**
 * reprocessGokiInvoices()
 * - Drive 폴더에서 "[완료] [웹앱][고기값]" 파일들을 Gemini로 재분석
 * - 기존에 같은 파일ID로 기록된 지출및매출로그 행을 먼저 삭제
 * - 새로운 합계금액으로 재기록
 * - 마감정산서 처리방식과 동일한 upsert 패턴 사용
 *
 * ※ 실행 전 주의: [자동]고기값 항목은 건드리지 않음
 * ※ 이 함수 실행 후 데이터 확인 권장
 */
function reprocessGokiInvoices() {
  Logger.log('=== 고기값 거래명세서 재처리 시작 ===');
  var config   = BRANCH_CONFIG['백석점'];
  var ss       = SpreadsheetApp.openById(config.ssId);
  var folder   = DriveApp.getFolderById(config.folderId);
  var logSheet = ss.getSheetByName('지출및매출로그');
  if (!logSheet) { Logger.log('지출및매출로그 없음'); return; }

  var files   = folder.getFiles();
  var recount = 0;

  while (files.hasNext()) {
    var file = files.next();
    var name = file.getName().trim();

    // [완료] [웹앱][고기값] 파일만 대상
    if (!name.startsWith('[완료]')) continue;
    if (!name.includes('[고기값]')) continue;

    Logger.log('\n📄 재처리: ' + name);

    // 기존 로그에서 같은 fileId로 기록된 행 찾아 삭제 (아래→위)
    var fileId  = file.getId();
    var lastRow = logSheet.getLastRow();
    if (lastRow > 1) {
      var ids = logSheet.getRange(2, COL_FILE_ID, lastRow - 1, 1).getValues();
      for (var r = lastRow; r >= 2; r--) {
        if (String(ids[r - 2][0]).trim() === fileId) {
          logSheet.deleteRow(r);
          Logger.log('  🗑 기존 행 삭제 (row ' + r + ')');
        }
      }
      SpreadsheetApp.flush();
    }

    // Gemini 재분석
    var imageData = prepareImageFromFile(file);
    if (!imageData) { Logger.log('  ❌ 이미지 준비 실패'); continue; }

    var res = callGeminiWithDocType(imageData, '고기값');
    if (!res || res.length === 0) { Logger.log('  ❌ Gemini 분석 실패'); continue; }

    var result = recordDataSafely(logSheet, res, '백석점', name, fileId);
    Logger.log('  ✅ 재기록: ' + result.count + '건');
    recount += result.count;

    Utilities.sleep(3000);  // Rate limit 방지
  }

  SpreadsheetApp.flush();
  Logger.log('\n=== 재처리 완료: 총 ' + recount + '건 기록 ===');
}

// ============================================================
// 🧹 4월 27일 이후 비[자동] 고기값 항목 삭제
// ============================================================
/**
 * cleanupGokiLogAfterApr27()
 * - 2026-04-27 이후 고기값 항목 중 [자동] 마커가 없는 것 전부 삭제
 * - 입고기록 기반 [자동] 항목이 기준 → Drive 사진·수기 항목 제거
 * - 4월 26일까지 수기 입력은 보존
 */
function cleanupGokiLogAfterApr27() {
  Logger.log('=== 4월 27일 이후 비[자동] 고기값 항목 삭제 ===');
  var config   = BRANCH_CONFIG['백석점'];
  var ss       = SpreadsheetApp.openById(config.ssId);
  var logSheet = ss.getSheetByName('지출및매출로그');
  if (!logSheet) { Logger.log('지출및매출로그 없음'); return; }

  var lastRow = logSheet.getLastRow();
  if (lastRow <= 1) { Logger.log('데이터 없음'); return; }

  var cutoff  = '2026-04-27';
  var deleted = 0;

  for (var r = lastRow; r >= 2; r--) {
    var row      = logSheet.getRange(r, 1, 1, 8).getValues()[0];
    var category = String(row[1] || '').trim();
    var marker   = String(row[5] || '').trim();

    if (category !== '고기값') continue;
    if (marker.startsWith('[자동]')) continue;   // [자동] 항목 보존

    // 날짜 확인
    var dateVal = row[0];
    var ymd = normalizeDate_(dateVal);
    if (!ymd || ymd < cutoff) continue;           // 4월 26일 이전 보존

    Logger.log('  삭제: ' + ymd + ' | ' + row[3] + '원 | ' + marker.slice(0, 40));
    logSheet.deleteRow(r);
    deleted++;
  }

  SpreadsheetApp.flush();
  Logger.log('삭제 완료: ' + deleted + '건');
  Logger.log('남은 고기값 항목은 모두 [자동] 또는 4월 26일 이전 수기입력');
}

// ─── 테스트 함수 ───────────────────────────────────────────────────
function test고기값동기화() { syncMeatCosts('백석점'); }
function test주류동기화()   { syncLiquorCosts('백석점'); }

// ─── 인건비 동기화 (이전 달 자동) ──────────────────────────────────
// GAS 에디터에서 이 함수를 선택해서 실행하세요
function sync인건비_백석점() { syncLaborCosts('백석점'); }
function sync인건비_원당점() { syncLaborCosts('원당점'); }

// 특정 월 지정이 필요할 때: 아래 함수의 날짜만 바꿔서 실행
function sync인건비_백석점_지정월() { syncLaborCosts('백석점', '2026-05'); }
function sync인건비_원당점_지정월() { syncLaborCosts('원당점', '2026-07'); }

/**
 * 알바계산기에 지급완료 데이터가 있는 달을 전부 로그로 옮긴다.
 *
 *   원당은 지금까지 한 번도 동기화된 적이 없다.
 *   monthlySetup 이 8월 1일에 돌다가 기준일 오류(timeZone)로 중단되면서
 *   그 뒤에 있던 syncLaborCosts 호출까지 같이 날아간 것으로 보인다.
 *   (그 오류는 이후 수정됨)
 *
 *   이 함수는 알바계산기에 있는 월을 읽어 그 달들만 동기화한다.
 *   없는 달은 건드리지 않으므로 앱 쓰기 전 기록이 0으로 덮일 일이 없다.
 */
function 인건비_전체동기화_미리보기() { syncAllLaborMonths_(true); }
function 인건비_전체동기화_적용()   { syncAllLaborMonths_(false); }

function syncAllLaborMonths_(dryRun) {
  var res, json;
  try {
    res  = UrlFetchApp.fetch(ALBA_SCRIPT_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
    json = JSON.parse(res.getContentText());
  } catch (e) { Logger.log('❌ 알바계산기 호출 실패: ' + e.message); return; }
  if (!json.ok || !json.data) { Logger.log('❌ 데이터 없음'); return; }

  var d = json.data;
  var branches = d.branches || [], workers = d.workers || [], payments = d.payments || [];

  // 손익계산서에 있는 지점만, 월별로 모은다
  var 할일 = {};   // 할일[지점][연월] = 금액
  payments.forEach(function (p) {
    var w = workers.filter(function (x) { return x.id === p.wid; })[0];
    if (!w) return;
    var b = (branches.filter(function (x) { return x.id === w.branchId; })[0] || {}).name;
    if (!b || !BRANCH_CONFIG[b]) return;         // 발산점 등 손익계산서에 없는 지점은 제외
    if (!할일[b]) 할일[b] = {};
    할일[b][p.ym] = (할일[b][p.ym] || 0) + (Number(p.gross) || 0);
  });

  Logger.log(dryRun ? '=== 미리보기 (변경 없음) ===' : '=== 실제 동기화 ===');
  var 건수 = 0;

  Object.keys(할일).forEach(function (b) {
    Object.keys(할일[b]).sort().forEach(function (ym) {
      Logger.log('  [' + b + '] ' + ym + ' : ' + 할일[b][ym].toLocaleString() + '원');
      건수++;
      if (!dryRun) syncLaborCosts(b, ym);
    });
  });

  if (!건수) { Logger.log('  동기화할 것이 없습니다.'); return; }
  Logger.log(dryRun
    ? '\n※ ' + 건수 + '건 동기화 예정. 아무것도 바꾸지 않았습니다.'
    : '\n✅ ' + 건수 + '건 완료 → 이제 급여수식_미리보기 를 다시 돌려보세요.');
}

/**
 * 진단 — 지점이 확인되지 않는 지급 건 추적
 *
 *   워커가 삭제됐거나 지점이 지워지면 그 지급액은 어느 손익계산서에도
 *   안 잡힌다. 인건비가 조용히 누락되는 경로라 확인이 필요하다.
 */
function check지점불명() {
  var res, json;
  try {
    res  = UrlFetchApp.fetch(ALBA_SCRIPT_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
    json = JSON.parse(res.getContentText());
  } catch (e) { Logger.log('❌ 호출 실패: ' + e.message); return; }
  if (!json.ok || !json.data) { Logger.log('❌ 데이터 없음'); return; }

  var d = json.data;
  var branches = d.branches || [], workers = d.workers || [], payments = d.payments || [];
  var 문제 = [];

  payments.forEach(function (p) {
    var w = workers.filter(function (x) { return x.id === p.wid; })[0];
    if (!w) {
      문제.push({ ym: p.ym, gross: p.gross, 사유: '워커가 명단에 없음 (삭제됨)', wid: p.wid, 이름: '?' });
      return;
    }
    var b = branches.filter(function (x) { return x.id === w.branchId; })[0];
    if (!b) 문제.push({ ym: p.ym, gross: p.gross, 사유: '지점이 삭제됨 (branchId=' + w.branchId + ')', wid: p.wid, 이름: w.name });
  });

  Logger.log('═══ 지점이 확인 안 되는 지급 건 (' + 문제.length + '건) ═══');
  if (!문제.length) { Logger.log('  없습니다 ✅'); return; }

  문제.sort(function (a, b) { return a.ym < b.ym ? -1 : 1; });
  var 합 = 0;
  var wid별 = {};
  문제.forEach(function (x) {
    Logger.log('  ' + x.ym + ' | ' + (Number(x.gross) || 0).toLocaleString() + '원 | ' +
               x.사유 + '\n        wid: ' + x.wid);
    합 += Number(x.gross) || 0;
    wid별[x.wid] = (wid별[x.wid] || 0) + (Number(x.gross) || 0);
  });
  Logger.log('\n  합계 ' + 합.toLocaleString() + '원 — 어느 손익계산서에도 안 잡히고 있습니다.');

  Logger.log('\n═══ 복사해서 쓰세요 — ORPHAN_WID_BRANCH 에 붙여넣기 ═══');
  Object.keys(wid별).forEach(function (wid) {
    Logger.log("  '" + wid + "': '백석점',   // " + wid별[wid].toLocaleString() + '원 — 지점 확인 후 수정');
  });
  Logger.log('\n  ↑ 지점이 원당이면 \'원당점\' 으로 바꾸세요.');
  Logger.log('    적은 뒤 인건비_전체동기화_적용() 을 실행하면 다시 잡힙니다.');
}

// ============================================================
// 🔧 인건비 월별탭 수식 수정 (한 번만 실행)
// - 고기값 행의 수식 패턴을 읽어서 인건비 행에 동일하게 적용
// - 인건비는 매월 1일 1건만 기록되므로 G열(1일)에만 수식 설정
// - 나머지 H~AK열(2일~31일)은 비움
// ============================================================
function fixLaborCostFormulas() {
  var branchName = '백석점';
  var config = BRANCH_CONFIG[branchName];
  var ss = SpreadsheetApp.openById(config.ssId);

  var targets = [
    {year: 2026, month: 5},
    {year: 2026, month: 6},
    {year: 2026, month: 7}
  ];

  targets.forEach(function(ym) {
    var yy      = String(ym.year).slice(2);
    var tabName = yy + '년 ' + ym.month + '월 손익계산서';
    var sheet   = ss.getSheetByName(tabName);
    if (!sheet) { Logger.log(tabName + ': 탭 없음'); return; }

    var lastRow  = sheet.getLastRow();
    var lastCol  = sheet.getLastColumn();
    var values   = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var formulas = sheet.getRange(1, 1, lastRow, lastCol).getFormulas();

    // 고기값 행 / 인건비 행 찾기 (B열=index1)
    var gokiRow = -1, laborRow = -1;
    for (var i = 0; i < values.length; i++) {
      var b = String(values[i][1] || '').trim();
      if (b === '고기값') gokiRow = i;
      if (b === '인건비') laborRow = i;
    }

    Logger.log(tabName + ' → 고기값: ' + (gokiRow+1) + '행, 인건비: ' + (laborRow+1) + '행');

    if (gokiRow === -1) { Logger.log('⚠️ 고기값 행 없음 — 스킵'); return; }
    if (laborRow === -1) { Logger.log('⚠️ 인건비 행 없음 — 스프레드시트에 인건비 행 수동 추가 필요'); return; }

    // 고기값 G열(index6) 수식 읽기
    var templateFormula = formulas[gokiRow][6];
    Logger.log('고기값 G열 수식: ' + templateFormula);

    if (!templateFormula) {
      Logger.log('⚠️ 고기값 G열에 수식 없음 — 다른 열 탐색');
      for (var c = 6; c <= 36; c++) {
        if (formulas[gokiRow][c]) { templateFormula = formulas[gokiRow][c]; break; }
      }
    }

    if (!templateFormula) { Logger.log('⚠️ 고기값 수식 못 찾음 — 스킵'); return; }

    // 인건비 수식: "고기값" → "인건비"
    var laborFormula = templateFormula.replace(/고기값/g, '인건비');
    Logger.log('인건비 G열 수식: ' + laborFormula);

    // 인건비 행 G~AK열(col7~37) 초기화 후 G열에만 수식 설정
    var laborSheetRow = laborRow + 1;  // 1-indexed
    sheet.getRange(laborSheetRow, 7, 1, 31).clearContent();
    sheet.getRange(laborSheetRow, 7).setFormula(laborFormula);

    SpreadsheetApp.flush();
    Logger.log('✅ ' + tabName + ' 인건비 수식 적용 완료');
  });

  Logger.log('\n=== fixLaborCostFormulas 완료 ===');
}
