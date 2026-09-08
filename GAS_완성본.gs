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
  var code = res.getResponseCode();
  var body = res.getContentText();

  if (code === 200) {
    Logger.log("✅ 모델 목록 조회 성공");

    // ⚠️ 목록 조회가 된다고 영수증 처리가 되는 건 아니다.
    //    실제로 쓰는 건 generateContent (POST) 이고, 여기만 막히는 경우가 있다.
    //    그래서 진짜 쓰는 경로로 한 번 더 시험한다.
    Logger.log("   실제 분석 경로 시험 중...");
    var test = UrlFetchApp.fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      GEMINI_MODEL + ":generateContent?key=" + key,
      {
        method: "post", contentType: "application/json",
        payload: JSON.stringify({
          contents: [{ parts: [{ text: "1+1은? 숫자만 답하세요." }] }],
          generationConfig: { maxOutputTokens: 10 }
        }),
        muteHttpExceptions: true
      });

    var tc = test.getResponseCode();
    var tb = test.getContentText();

    if (tc === 200) {
      Logger.log("✅ Gemini 분석 정상 — 영수증 처리 가능");
      return;
    }

    Logger.log("❌ 목록은 되는데 분석이 막힙니다 (HTTP " + tc + ")");
    Logger.log("   " + tb.substring(0, 300));
    if (tb.indexOf('API_KEY_INVALID') >= 0) {
      Logger.log("\n👉 이 키로는 " + GEMINI_MODEL + " 을 쓸 수 없습니다.");
      Logger.log("   결제가 연결된 프로젝트에서 새 키를 발급하세요.");
      Logger.log("   https://aistudio.google.com/apikey");
    } else if (tb.indexOf('quota') >= 0 || tb.indexOf('RESOURCE_EXHAUSTED') >= 0) {
      Logger.log("\n👉 할당량 초과입니다. 결제 상태와 사용량을 확인하세요.");
    } else if (tb.indexOf('billing') >= 0) {
      Logger.log("\n👉 결제가 연결되지 않았습니다.");
    } else if (tc === 404) {
      Logger.log("\n👉 모델 이름이 잘못됐습니다. GEMINI_MODEL 을 확인하세요 (현재: " + GEMINI_MODEL + ")");
    }
    return;
  }

  Logger.log("❌ Gemini 응답 " + code);
  Logger.log("   " + body.substring(0, 300));

  // 무슨 뜻인지까지 알려준다. 코드만 보고는 판단이 안 된다.
  if (body.indexOf('API_KEY_INVALID') >= 0 || body.indexOf('not valid') >= 0) {
    Logger.log("\n👉 키가 무효입니다. 삭제됐거나 잘못 복사된 키입니다.");
    Logger.log("   ① https://aistudio.google.com/apikey 에서 새 키 발급");
    Logger.log("   ② 프로젝트 설정 > 스크립트 속성 > GEMINI_API_KEY 교체");
    Logger.log("   ③ checkApiKey() 다시 실행 → ✅ 나오면 완료");
    Logger.log("   ④ retryFailedFiles() → dailyProcess() 로 밀린 영수증 처리");
    Logger.log("\n   ⚠️ 키가 무효인 동안 올린 영수증은 하나도 안 들어갔습니다.");
    Logger.log("      checkBacklog() 로 몇 장 밀렸는지 확인하세요.");
  } else if (body.indexOf('quota') >= 0 || code === 429) {
    Logger.log("\n👉 할당량 초과입니다. 구글 클라우드 콘솔에서 사용량을 확인하세요.");
  } else if (code === 403) {
    Logger.log("\n👉 권한 문제입니다. 이 키로 Generative Language API 를 쓸 수 있는지 확인하세요.");
  }
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

// ═══════════════════════════════════════════════════════════
// 분류(계정) 이름 바꾸기
//
//  백석 '가게카드' 는 원래 '마트' 였다. 오프라인 마트 지출이 적어서
//  온라인·오프라인을 묶어 '가게카드' 로 부르기로 했는데,
//  시트 라벨만 바꾸고 로그 분류와 수식은 옛 이름 그대로 남아 있다.
//
//  이름이 세 군데에 흩어져 있어서 한 곳만 바꾸면 집계가 끊긴다.
//    ① 지출및매출로그 B열 (분류)
//    ② 월별탭 수식 안의 "분류명"  ← 여기가 제일 많다
//    ③ AI 프롬프트가 적어 넣는 분류명 (코드 안)
//
//  ①②를 한 번에 바꾸고, ③은 코드에서 따로 고친다.
// ═══════════════════════════════════════════════════════════

/** 로그에 실제로 어떤 분류가 있는지 — 이름 바꾸기 전에 반드시 확인 */
function 분류목록확인() {
  Object.keys(BRANCH_CONFIG).forEach(function (branch) {
    var ss = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId);
    var sh = ss.getSheetByName('지출및매출로그');
    Logger.log('\n═══ [' + branch + '] 지출및매출로그 분류 ═══');
    if (!sh || sh.getLastRow() < 2) { Logger.log('  (데이터 없음)'); return; }

    var v = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
    var 표 = {};
    v.forEach(function (r) {
      var c = String(r[1]).trim();
      if (!c) return;
      if (!표[c]) 표[c] = { 건수: 0, 금액: 0, 최근: '' };
      표[c].건수++;
      표[c].금액 += Number(r[3]) || 0;
      var d = toDate_(r[0]);
      if (d) {
        var ym = Utilities.formatDate(d, TIMEZONE, 'yyyy-MM');
        if (ym > 표[c].최근) 표[c].최근 = ym;
      }
    });

    Object.keys(표).sort().forEach(function (c) {
      Logger.log('  ' + c + '  —  ' + 표[c].건수 + '건, ' +
                 표[c].금액.toLocaleString() + '원, 최근 ' + 표[c].최근);
    });
  });
  Logger.log('\n※ 월별탭 수식이 참조하는 이름과 위가 일치해야 집계가 됩니다.');
}

/**
 * 손익계산서 시트가 참조하는 분류 vs 로그에 실제로 있는 분류
 *
 *   둘이 어긋나면 돈이 로그에는 쌓이는데 시트에는 안 잡힌다.
 *   숫자가 없으니 눈치채기 어렵고, 그만큼 이익이 부풀려 보인다.
 */
function 계정대조() {
  Object.keys(BRANCH_CONFIG).forEach(function (branch) {
    var ss = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId);
    Logger.log('\n════════ [' + branch + '] ════════');

    // ① 로그에 있는 분류 + 금액
    var 로그 = {};
    var lg = ss.getSheetByName('지출및매출로그');
    if (lg && lg.getLastRow() > 1) {
      lg.getRange(2, 1, lg.getLastRow() - 1, 4).getValues().forEach(function (r) {
        var c = String(r[1]).trim();
        if (!c) return;
        로그[c] = (로그[c] || 0) + (Number(r[3]) || 0);
      });
    }

    // ② 시트 수식이 참조하는 분류
    //
    //   월 탭 하나만 보면 안 된다. 달마다 상태가 다르기 때문이다.
    //   예) 8월은 급여가 아직 안 들어와 수기값으로 보호돼 있지만
    //       5·6·7월은 이미 로그를 읽고 있다.
    //   한 탭만 보면 "인건비를 안 읽는다"는 잘못된 경고가 뜬다.
    //   → 템플릿과 모든 월 탭을 훑어서, 어디서든 쓰이면 연결된 것으로 본다.
    var 참조 = {};   // 분류 → 그 분류를 쓰는 행 라벨
    var 훑은탭 = [];
    var re = /'지출및매출로그'!\$B:\$B\s*,\s*"([^"]+)"/g;

    var tabNames = ['26년 x월 손익계산서'];
    for (var m = 1; m <= 12; m++) tabNames.push('26년 ' + m + '월 손익계산서');

    tabNames.forEach(function (tabName) {
      var tab = ss.getSheetByName(tabName);
      if (!tab) return;
      훑은탭.push(tabName.replace('26년 ', '').replace(' 손익계산서', ''));

      var lastRow = Math.min(tab.getLastRow(), 60);
      if (lastRow < 1) return;
      var fs = tab.getRange(1, 1, lastRow, Math.min(tab.getLastColumn(), 40)).getFormulas();
      var labels = tab.getRange(1, 2, lastRow, 1).getDisplayValues();

      for (var r = 0; r < fs.length; r++) {
        for (var c = 0; c < fs[r].length; c++) {
          var f = fs[r][c];
          if (!f) continue;
          var mm;
          re.lastIndex = 0;
          while ((mm = re.exec(f)) !== null) {
            var cat = mm[1];
            var lab = String(labels[r][0] || '').trim();
            if (!참조[cat]) 참조[cat] = {};
            if (lab) 참조[cat][lab] = true;
          }
        }
      }
    });

    if (!훑은탭.length) { Logger.log('  월 탭 없음'); return; }
    Logger.log('훑은 탭: ' + 훑은탭.join(' · '));

    // ③ 대조
    Logger.log('\n── 🔴 로그에 있는데 시트가 안 읽는 분류 ──');
    var 미집계 = 0;
    Object.keys(로그).sort().forEach(function (c) {
      if (참조[c]) return;
      if (로그[c] === 0) return;
      if (c === DUP_EXCLUDE) {          // 일부러 제외한 것 — 문제 아님
        Logger.log('   "' + c + '"  ' + 로그[c].toLocaleString() + '원  (의도된 제외)');
        return;
      }
      Logger.log('   "' + c + '"  ' + 로그[c].toLocaleString() + '원');
      미집계 += 로그[c];
    });
    if (!미집계) Logger.log('   없음 ✅');
    else Logger.log('   ↳ 합계 ' + 미집계.toLocaleString() + '원이 손익에 안 잡힙니다');

    Logger.log('\n── 🟡 시트가 읽는데 로그에 없는 분류 ──');
    var 빈것 = 0;
    Object.keys(참조).sort().forEach(function (c) {
      if (로그[c] !== undefined) return;
      Logger.log('   "' + c + '"  ← ' + Object.keys(참조[c]).join(', ') + ' 행이 참조');
      빈것++;
    });
    if (!빈것) Logger.log('   없음 ✅');

    Logger.log('\n── 🟢 정상 연결 ──');
    Object.keys(참조).sort().forEach(function (c) {
      if (로그[c] === undefined) return;
      Logger.log('   "' + c + '"  ' + (로그[c] || 0).toLocaleString() + '원  → ' +
                 Object.keys(참조[c]).join(', '));
    });

    // ④ 이름이 비슷한 것 (공백·띄어쓰기 차이로 갈린 분류)
    var keys = Object.keys(로그);
    var 의심 = [];
    for (var i = 0; i < keys.length; i++) {
      for (var j = i + 1; j < keys.length; j++) {
        if (keys[i].replace(/\s+/g, '') === keys[j].replace(/\s+/g, '')) {
          의심.push('"' + keys[i] + '" ↔ "' + keys[j] + '"');
        }
      }
    }
    if (의심.length) {
      Logger.log('\n── ⚠️ 띄어쓰기만 다른 분류 (합쳐야 함) ──');
      의심.forEach(function (x) { Logger.log('   ' + x); });
    }
  });
  Logger.log('\n※ 읽기만 했습니다.');
}

/**
 * 이미 다른 계정에 포함돼 중복인 기록에 붙이는 분류.
 *
 *   지우지 않는 이유: 영수증은 실제로 있었고 기록도 남아야 한다.
 *   다만 어느 수식도 이 이름을 읽지 않으므로 손익에는 반영되지 않는다.
 *   예) 특양 구매 → 가게카드(kb카드) 출금액에 이미 포함돼 있음
 */
var DUP_EXCLUDE = '중복제외(카드포함)';

/**
 * 이름 통일 계획 — 2026-08-16 계정대조 결과에 따름
 *
 *   백석 '가게카드' 는 이름이 세 개로 갈려 있었다.
 *     로그   "카드값"    1,900만원  ← 예전 마이그레이션으로 바뀜
 *     수식   "마트"                 ← 그때 같이 안 바꿔서 옛 이름 그대로
 *     시트라벨 "가게카드(네이버,쿠팡,특양)"
 *   → 수식과 로그가 서로 다른 이름을 보고 있어 1,900만원이 집계에서 빠졌다.
 *
 *   '기타 잡비용' 은 공백 하나 차이로 '기타잡비용' 과 갈렸다.
 *   '특양' 은 가게카드/가게외부카드에 포함돼야 하는데 따로 떨어져 있다.
 *
 *   각 줄은 로그와 수식을 동시에 바꾼다. 한쪽만 바꾸면 집계가 끊긴다.
 */
var RENAME_PLAN = [
  { branch: '백석점', from: '마트',        to: '가게카드',   비고: '수식 8개월치 (로그엔 없음)' },
  { branch: '백석점', from: '카드값',      to: '가게카드',   비고: '로그 7건 = kb카드 출금' },
  { branch: '백석점', from: '기타 잡비용', to: '기타잡비용', 비고: '공백 통합' },
  { branch: '백석점', from: '특양',        to: DUP_EXCLUDE,  비고: '카드에 이미 포함 — 집계 제외' },

  { branch: '원당점', from: '기타 잡비용', to: '기타잡비용', 비고: '공백 통합' },

  // ── 원당 특양 224,400원 — 답은 나왔고 실행만 남음 ──────
  //
  //   2026-08-18 확인: "그때는 카드결제 중복으로 했다" (대표님)
  //   → 백석과 같은 구조. 카드 결제액에 이미 포함돼 있으므로 집계에서 빼야 한다.
  //   → 아래 한 줄 주석만 풀고 분류정리_적용() 하면 끝.
  //
  //   1건 224,400원이라 급하지 않아 그날은 넘어갔다.
  // { branch: '원당점', from: '특양', to: DUP_EXCLUDE, 비고: '카드 결제 중복 — 집계 제외' },
];

/**
 * 의심스러운 기록을 항목명까지 펼쳐서 본다
 *
 *   AI가 애매한 영수증을 전부 '기타잡비용' 으로 몰아넣은 이력이 있다.
 *   합계만 보면 알 수 없고 항목명을 봐야 판단이 된다.
 *
 *   아래 CHECK_CATEGORIES 를 보고 싶은 분류로 바꿔서 실행.
 */
/**
 * 한 계정을 끝까지 추적한다 — 로그 · 수식 · 실제 표시값
 *
 *   "수식은 A를 보는데 로그엔 B로 쌓인다" 같은 어긋남은
 *   합계만 봐서는 안 보인다. 셋을 나란히 놓고 봐야 판단이 된다.
 */
var TRACE_BRANCH = '백석점';
var TRACE_ROW_LABEL = '가게카드';      // B열 라벨 (공백 무시하고 앞부분 일치)
var TRACE_CATEGORIES = ['마트', '카드값', '가게카드'];   // 관련 있을 법한 분류 전부

/**
 * 지금 시트가 어떤 상태인지 그대로 찍어본다 (피해 확인용)
 *
 *   2026-08-17 분류정리_적용 이 range.setFormulas(전체) 를 쓰는 바람에
 *   수식 없이 값만 들어 있던 칸이 전부 지워졌다.
 *   무엇이 남고 무엇이 사라졌는지 눈으로 확인하기 위한 함수.
 */
function 현재상태확인() {
  var BRANCH = '백석점';
  var TABS = ['26년 7월 손익계산서', '26년 8월 손익계산서'];

  var ss = SpreadsheetApp.openById(BRANCH_CONFIG[BRANCH].ssId);

  TABS.forEach(function (tabName) {
    var sh = ss.getSheetByName(tabName);
    Logger.log('\n════════ ' + tabName + ' ════════');
    if (!sh) { Logger.log('  탭 없음'); return; }

    var last = Math.min(sh.getLastRow(), 45);
    var labels = sh.getRange(1, 2, last, 1).getDisplayValues();
    var cF = sh.getRange(1, 3, last, 1).getFormulas();
    var cV = sh.getRange(1, 3, last, 1).getDisplayValues();

    Logger.log('  행 | B열(계정)              | C열 상태');
    Logger.log('  ───┼───────────────────────┼──────────────────────');
    for (var i = 0; i < last; i++) {
      var lab = String(labels[i][0] || '').trim();
      if (!lab) continue;
      var f = cF[i][0], v = cV[i][0];
      var 상태;
      if (f)            상태 = '수식  → ' + (v || '(빈값)');
      else if (v !== '') 상태 = '값    ' + v;
      else               상태 = '❌ 비어 있음';
      Logger.log('  ' + String(i + 1).padStart(2) + ' | ' +
                 (lab + '                       ').slice(0, 22) + ' | ' + 상태);
    }

    // 하단 알바표도 살아있는지
    var b = sh.getRange(55, 2, 12, 6).getDisplayValues();
    var 살아있음 = b.filter(function (r) { return String(r[0]).trim(); }).length;
    Logger.log('  하단 55~66행에 내용 있는 줄: ' + 살아있음 + '개');
  });
  Logger.log('\n※ "❌ 비어 있음" 이 고정비 행(임대료·보험 등)에 있으면 지워진 것입니다.');
}

function 계정추적() {
  var ss = SpreadsheetApp.openById(BRANCH_CONFIG[TRACE_BRANCH].ssId);
  Logger.log('════════ [' + TRACE_BRANCH + '] "' + TRACE_ROW_LABEL + '" 행 추적 ════════');

  // ① 로그에 무엇이 얼마나 있나
  Logger.log('\n──── ① 지출및매출로그 ────');
  var lg = ss.getSheetByName('지출및매출로그');
  var 월별 = {};
  if (lg && lg.getLastRow() > 1) {
    var v = lg.getRange(2, 1, lg.getLastRow() - 1, 6).getValues();
    TRACE_CATEGORIES.forEach(function (cat) {
      var rows = [];
      v.forEach(function (r, i) {
        if (String(r[1]).trim() !== cat) return;
        var d = toDate_(r[0]);
        var ymd = d ? Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd') : String(r[0]);
        rows.push({ 행: i + 2, 날짜: ymd, 항목: String(r[2] || ''), 금액: Number(r[3]) || 0 });
        var ym = ymd.slice(0, 7);
        if (!월별[cat]) 월별[cat] = {};
        월별[cat][ym] = (월별[cat][ym] || 0) + (Number(r[3]) || 0);
      });
      if (!rows.length) { Logger.log('  "' + cat + '"  —  없음'); return; }
      var 합 = rows.reduce(function (a, x) { return a + x.금액; }, 0);
      Logger.log('  "' + cat + '"  ' + rows.length + '건  ' + 합.toLocaleString() + '원');
      rows.sort(function (a, b) { return a.날짜 < b.날짜 ? -1 : 1; });
      rows.forEach(function (x) {
        Logger.log('      ' + x.행 + '행 | ' + x.날짜 + ' | ' + (x.항목 || '(항목명 없음)') +
                   ' | ' + x.금액.toLocaleString() + '원');
      });
    });
  }

  // ② 월별 탭에서 그 행이 어떤 수식을 쓰고 얼마를 보여주나
  Logger.log('\n──── ② 월별 탭 ────');
  for (var m = 1; m <= 12; m++) {
    var tab = ss.getSheetByName('26년 ' + m + '월 손익계산서');
    if (!tab) continue;
    var ym = '2026-' + ('0' + m).slice(-2);

    var row = -1;
    var last = Math.min(tab.getLastRow(), 60);
    var labels = tab.getRange(1, 2, last, 1).getDisplayValues();
    for (var i = 0; i < labels.length; i++) {
      if (String(labels[i][0]).replace(/\s+/g, '').indexOf(TRACE_ROW_LABEL.replace(/\s+/g, '')) === 0) { row = i + 1; break; }
    }
    if (row < 0) { Logger.log('  ' + m + '월: "' + TRACE_ROW_LABEL + '" 행 없음'); continue; }

    var lastCol = Math.min(tab.getLastColumn(), 40);
    var fs = tab.getRange(row, 1, 1, lastCol).getFormulas()[0];
    var ds = tab.getRange(row, 1, 1, lastCol).getDisplayValues()[0];

    // 수식이 참조하는 분류 수집
    var 참조 = {};
    var re = /'지출및매출로그'!\$B:\$B\s*,\s*"([^"]+)"/g;
    fs.forEach(function (f) {
      if (!f) return;
      var mm; re.lastIndex = 0;
      while ((mm = re.exec(f)) !== null) 참조[mm[1]] = true;
    });

    // C열(합계) 값과, 값이 들어있는 일별 칸 수
    var 합계표시 = ds[2];
    var 일별있음 = 0;
    for (var c = 6; c < lastCol; c++) {
      var t = String(ds[c] || '').replace(/[^0-9]/g, '');
      if (t && Number(t) > 0) 일별있음++;
    }

    var 로그액 = 0;
    Object.keys(참조).forEach(function (cat) { 로그액 += ((월별[cat] || {})[ym] || 0); });

    Logger.log('  ' + m + '월  ' + row + '행  C열=' + (합계표시 || '(빈칸)') +
               '   수식참조: ' + (Object.keys(참조).join(',') || '(없음)') +
               '   일별값 ' + 일별있음 + '칸   로그(' + ym + ')=' + 로그액.toLocaleString() + '원');
    if (!Object.keys(참조).length && 합계표시) Logger.log('        ↳ 수식 없이 직접 입력된 값입니다');
  }

  Logger.log('\n※ C열 값과 로그액이 다르면 어긋난 것입니다.');
}

// ═══════════════════════════════════════════════════════════
// 로그 행 안전 삭제
//
//  잘못 지우면 되돌릴 수 없다는 게 가장 무서운 부분이다.
//  그래서 세 겹으로 막는다.
//
//   ① 미리보기에서 지울 행의 날짜·항목명·금액·출처를 전부 보여준다
//      → 행 번호를 잘못 적었으면 여기서 바로 드러난다
//   ② 지우기 전에 '삭제보관함' 시트에 원본 그대로 복사한다
//      → 언제·몇 행에 뭐가 있었는지 남는다. 되돌릴 수 있다
//   ③ 행 번호가 큰 것부터 지운다
//      → 위에서 지우면 아래 번호가 밀려 엉뚱한 행이 지워진다
//
//  출처(F열)를 꼭 보라.
//    [자동]... 로 시작 → 자동 동기화가 만든 것. 지워도 다음 실행에 다시 생긴다
//    [웹앱]... 이미지 → AI가 영수증에서 읽은 것
//    (빈칸)          → 손으로 입력한 것
// ═══════════════════════════════════════════════════════════
var DELETE_BRANCH = '백석점';
var DELETE_ROWS = [
  3, 4, 5, 6,              // 2012-05-01 곱창·대창·막창·간천엽 — 고기값인데 잡비용
  66, 102, 132, 173,       // 중복 쌍의 한쪽
  193, 194, 195, 196,      // 0원 (미락 발주서 오인식)
  588, 620,                // 2020-07 매출합계 — 매출인데 비용
];

function 삭제_미리보기() { deleteLogRows_(true); }
function 삭제_적용()   { deleteLogRows_(false); }

function deleteLogRows_(dryRun) {
  var ss = SpreadsheetApp.openById(BRANCH_CONFIG[DELETE_BRANCH].ssId);
  var sh = ss.getSheetByName('지출및매출로그');
  if (!sh) { Logger.log('❌ 로그 시트 없음'); return; }

  var rows = DELETE_ROWS.slice().sort(function (a, b) { return b - a; });   // 내림차순
  var lastRow = sh.getLastRow();
  var 백업 = [], 합계 = 0;

  Logger.log(dryRun ? '════ 미리보기 (삭제 안 함) ════' : '════ 실제 삭제 ════');
  Logger.log('[' + DELETE_BRANCH + '] ' + rows.length + '행\n');

  // 위에서부터 읽어서 보여주기 (사람이 보기 편하게 오름차순)
  rows.slice().reverse().forEach(function (r) {
    if (r < 2 || r > lastRow) { Logger.log('  ⚠️ ' + r + '행: 범위 밖 — 건너뜀'); return; }
    var v = sh.getRange(r, 1, 1, 8).getValues()[0];
    var d = toDate_(v[0]);
    var 날짜 = d ? Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd') : String(v[0]);
    var 출처 = String(v[5] || '').trim();
    var 종류 = 출처.indexOf('[자동]') === 0 ? '자동동기화'
             : 출처.indexOf('[웹앱]') === 0 ? 'AI분석'
             : 출처 ? '기타' : '수기입력';

    Logger.log('  ' + String(r).padStart(4) + '행 | ' + 날짜 + ' | ' +
               String(v[1]) + ' | ' + (v[2] || '(항목명없음)') + ' | ' +
               (Number(v[3]) || 0).toLocaleString() + '원');
    Logger.log('        출처: ' + 종류 + (출처 ? '  ' + 출처.slice(0, 60) : ''));
    if (종류 === '자동동기화') {
      Logger.log('        ⚠️ 자동 동기화가 만든 행입니다. 지워도 다음 실행에 다시 생깁니다.');
    }
    합계 += Number(v[3]) || 0;
    백업.push([r].concat(v));
  });

  Logger.log('\n  삭제 대상 합계: ' + 합계.toLocaleString() + '원');

  if (dryRun) {
    Logger.log('\n※ 아무것도 지우지 않았습니다.');
    Logger.log('   위 항목명이 지우려던 것과 맞는지 확인하고 삭제_적용() 을 실행하세요.');
    return;
  }

  // ── 백업 ──
  var bk = ss.getSheetByName('삭제보관함');
  if (!bk) {
    bk = ss.insertSheet('삭제보관함');
    bk.appendRow(['삭제시각', '원래행', '날짜', '분류', '항목명', '금액', '지점', '원본파일명', '처리시각', '파일ID']);
    bk.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#fee2e2');
    bk.setFrozenRows(1);
  }
  var now = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  백업.forEach(function (b) { bk.appendRow([now].concat(b)); });
  SpreadsheetApp.flush();
  Logger.log('\n  💾 삭제보관함에 ' + 백업.length + '행 백업 완료');

  // ── 삭제 (큰 번호부터) ──
  var 지움 = 0;
  rows.forEach(function (r) {
    if (r < 2 || r > lastRow) return;
    sh.deleteRow(r);
    지움++;
  });
  SpreadsheetApp.flush();
  Logger.log('  🗑 ' + 지움 + '행 삭제 완료');
  Logger.log('\n※ 되돌리려면 「삭제보관함」 시트의 내용을 로그에 다시 붙여넣으면 됩니다.');
}

var CHECK_BRANCH = '백석점';       // '' 로 두면 전 지점
var CHECK_CATEGORIES = ['기타잡비용', '기타 잡비용', '거래명세표', '영수증', '통신요금'];

function 의심항목확인() {
  Object.keys(BRANCH_CONFIG).forEach(function (branch) {
    if (CHECK_BRANCH && branch !== CHECK_BRANCH) return;
    var ss = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId);
    var sh = ss.getSheetByName('지출및매출로그');
    if (!sh || sh.getLastRow() < 2) return;

    Logger.log('\n════════ [' + branch + '] ════════');
    var v = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();

    CHECK_CATEGORIES.forEach(function (cat) {
      var rows = [];
      v.forEach(function (r, i) {
        if (String(r[1]).trim() !== cat) return;
        var d = toDate_(r[0]);
        rows.push({
          행: i + 2,
          날짜: d ? Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd') : String(r[0]),
          항목명: String(r[2] || '').trim(),
          금액: Number(r[3]) || 0,
          출처: String(r[5] || '').trim(),
        });
      });
      if (!rows.length) return;

      var 합 = rows.reduce(function (a, x) { return a + x.금액; }, 0);
      Logger.log('\n──── "' + cat + '"  ' + rows.length + '건  ' + 합.toLocaleString() + '원 ────');

      rows.sort(function (a, b) { return a.날짜 < b.날짜 ? -1 : 1; });
      rows.forEach(function (x) {
        var 경고 = '';
        if (x.날짜 < '2026-01-01') 경고 = '  ⚠️ 날짜 이상';
        else if (x.날짜 > Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd')) 경고 = '  ⚠️ 미래 날짜';
        Logger.log('  ' + x.행 + '행 | ' + x.날짜 + ' | ' +
                   (x.항목명 || '(항목명 없음)') + ' | ' +
                   x.금액.toLocaleString() + '원' + 경고);
      });
    });
  });
  Logger.log('\n※ 읽기만 했습니다. 왼쪽 숫자가 로그 시트의 행 번호입니다.');
  Logger.log('   고칠 것은 시트에서 직접 분류(B열)를 수정하시면 됩니다.');
}

/**
 * 일별 수식(G~AK)에 뚫린 구멍 메우기
 *
 *   7월 가게카드 행처럼 한두 칸만 비어 있는 경우가 있다.
 *   그 날짜에 지출이 생기면 조용히 누락된다.
 *
 *   ⚠️ 일부러 비워둔 행이 있다 — 알바급여·직원급여는 C열에만 수식이 있고
 *      G~AK 는 전부 비어 있는 게 정상이다 (월 1건만 집계).
 *      그래서 "대부분 차 있는데 몇 칸만 빈" 행만 손댄다.
 */
var HOLE_MIN_FILLED = 25;   // 31칸 중 이만큼 이상 차 있어야 '구멍'으로 본다

// 채울 대상을 좁힌다. 빈 배열이면 전부 본다.
//   나머지 빈 칸(1월 30일 현금매출, 4월 4·5일 매출 등)은 사장님 확인 결과
//   문제없이 적용된 것이라 건드리지 않는다.
var HOLE_ONLY = [
  { branch: '백석점', tab: '26년 7월 손익계산서', row: 23 },   // 가게카드 1일
];

function holeAllowed_(branch, tabName, row) {
  if (!HOLE_ONLY.length) return true;
  return HOLE_ONLY.some(function (h) {
    return h.branch === branch && h.tab === tabName && h.row === row;
  });
}

function 일별수식_구멍메우기_미리보기() { fillFormulaHoles_(true); }
function 일별수식_구멍메우기_적용()   { fillFormulaHoles_(false); }

function fillFormulaHoles_(dryRun) {
  Logger.log(dryRun ? '=== 미리보기 (변경 없음) ===' : '=== 실제 적용 ===');
  var 총 = 0;

  Object.keys(BRANCH_CONFIG).forEach(function (branch) {
    var ss = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId);
    Logger.log('\n──── [' + branch + '] ────');

    var tabs = ['26년 x월 손익계산서'];
    for (var m = 1; m <= 12; m++) tabs.push('26년 ' + m + '월 손익계산서');

    tabs.forEach(function (tabName) {
      var sh = ss.getSheetByName(tabName);
      if (!sh) return;
      var lastRow = Math.min(sh.getLastRow(), 60);
      if (lastRow < 1) return;

      // 그 달의 마지막 날 — 없는 날짜(2월 29~31일 등)는 비어 있는 게 정상이다
      var mm = tabName.match(/26년 (\d+)월/);
      var 일수 = mm ? new Date(2026, Number(mm[1]), 0).getDate() : 31;

      var rg = sh.getRange(1, 7, lastRow, 31);          // G~AK
      var fs = rg.getFormulas();
      var vs = rg.getDisplayValues();                    // 값도 함께 본다
      var labels = sh.getRange(1, 2, lastRow, 1).getDisplayValues();

      for (var r = 0; r < fs.length; r++) {
        var filled = [], 진짜구멍 = [], 수기값 = [];
        for (var c = 0; c < 31; c++) {
          if (c + 1 > 일수) continue;                    // 그 달에 없는 날 — 건너뜀
          if (fs[r][c]) { filled.push(c); continue; }
          // 수식은 없는데 값이 있으면 손으로 넣은 것이다. 덮어쓰면 그 숫자가 사라진다.
          if (String(vs[r][c] || '').trim() !== '') 수기값.push(c);
          else 진짜구멍.push(c);
        }
        if (filled.length < HOLE_MIN_FILLED) continue;   // 원래 비어있는 행
        if (!진짜구멍.length && !수기값.length) continue;
        if (!holeAllowed_(branch, tabName, r + 1)) continue;   // 대상 밖

        var label = String(labels[r][0] || '').trim();
        var 날짜표기 = function (c) { return colLetter_(c + 7) + '(' + (c + 1) + '일)'; };

        if (수기값.length) {
          Logger.log('  ⚠️ ' + tabName + ' ' + (r + 1) + '행 [' + label + '] — 손으로 넣은 값 ' +
                     수기값.length + '칸: ' +
                     수기값.map(function (c) { return 날짜표기(c) + '=' + vs[r][c]; }).join(', '));
          Logger.log('        건드리지 않습니다. 수식으로 바꾸려면 직접 지우고 다시 실행하세요.');
        }
        if (!진짜구멍.length) continue;

        Logger.log('  ' + tabName + ' ' + (r + 1) + '행 [' + label + '] — 빈 칸 ' +
                   진짜구멍.length + '개: ' + 진짜구멍.map(날짜표기).join(', '));
        총 += 진짜구멍.length;

        if (!dryRun) {
          var srcCol = filled[0] + 7;
          진짜구멍.forEach(function (c) {
            // PASTE_FORMULA 는 상대 참조(G$11 등)를 열에 맞춰 자동 보정한다
            sh.getRange(r + 1, srcCol).copyTo(
              sh.getRange(r + 1, c + 7),
              SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
          });
          SpreadsheetApp.flush();
          Logger.log('      → 채움');
        }
      }
    });
  });

  if (!총) { Logger.log('\n구멍 없음 ✅'); return; }
  Logger.log(dryRun
    ? '\n※ ' + 총 + '칸 채울 예정. 아무것도 바꾸지 않았습니다.'
    : '\n✅ ' + 총 + '칸 채움');
}

function 분류정리_미리보기() { runRenamePlan_(true); }
function 분류정리_적용()   { runRenamePlan_(false); }

function runRenamePlan_(dryRun) {
  Logger.log(dryRun ? '════ 미리보기 (변경 없음) ════' : '════ 실제 적용 ════');
  RENAME_PLAN.forEach(function (p, i) {
    Logger.log('\n[' + (i + 1) + '/' + RENAME_PLAN.length + '] ' + p.branch +
               '  "' + p.from + '" → "' + p.to + '"   (' + p.비고 + ')');
    renameCategory_(dryRun, p.branch, p.from, p.to);
  });
  Logger.log(dryRun
    ? '\n※ 아무것도 바꾸지 않았습니다. 맞으면 분류정리_적용() 을 실행하세요.'
    : '\n✅ 전부 완료 → 계정대조() 로 다시 확인하세요.');
}

function renameCategory_(dryRun, branch, FROM, TO) {
  var ss = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId);

  // ① 로그 분류
  var sh = ss.getSheetByName('지출및매출로그');
  var 로그건수 = 0;
  if (sh && sh.getLastRow() > 1) {
    var rg = sh.getRange(2, 2, sh.getLastRow() - 1, 1);
    var vals = rg.getValues();
    vals.forEach(function (r, i) {
      if (String(r[0]).trim() === FROM) { vals[i][0] = TO; 로그건수++; }
    });
    if (로그건수 && !dryRun) { rg.setValues(vals); SpreadsheetApp.flush(); }
  }
  if (로그건수) Logger.log('    ① 로그 ' + 로그건수 + '건');

  // ② 월별탭 수식
  var targets = ['26년 x월 손익계산서'];
  for (var m = 1; m <= 12; m++) targets.push('26년 ' + m + '월 손익계산서');
  var 수식건수 = 0;

  targets.forEach(function (tabName) {
    var t = ss.getSheetByName(tabName);
    if (!t) return;
    var lastRow = Math.min(t.getLastRow(), 60);
    var lastCol = Math.min(t.getLastColumn(), 40);
    if (lastRow < 1 || lastCol < 1) return;

    // ⚠️ 절대 range.setFormulas(전체배열) 를 쓰지 말 것.
    //    getFormulas() 는 값만 든 칸을 '' 로 돌려주는데, 그걸 되돌려 쓰면
    //    직접 입력된 숫자가 전부 지워진다. (2026-08-17 사고)
    //    바꿀 칸만 하나씩 setFormula 한다.
    var fs = t.getRange(1, 1, lastRow, lastCol).getFormulas();
    var 바꿀칸 = [];

    for (var r = 0; r < fs.length; r++) {
      for (var c = 0; c < fs[r].length; c++) {
        var f = fs[r][c];
        if (!f || f.indexOf('"' + FROM + '"') < 0) continue;
        바꿀칸.push({ row: r + 1, col: c + 1,
                     formula: f.split('"' + FROM + '"').join('"' + TO + '"') });
      }
    }
    if (!바꿀칸.length) return;
    Logger.log('    ② ' + tabName + ' 수식 ' + 바꿀칸.length + '칸');
    수식건수 += 바꿀칸.length;

    if (!dryRun) {
      바꿀칸.forEach(function (x) { t.getRange(x.row, x.col).setFormula(x.formula); });
      SpreadsheetApp.flush();
    }
  });

  if (!로그건수 && !수식건수) Logger.log('    변경할 것 없음');
}

/**
 * 처리 대기 중인 영수증이 몇 장인지
 *
 *   dailyProcess 는 구글이 6분에 강제 종료한다. 1장당 5~12초라
 *   한 번에 30~45장이 한계다. 그 이상 쌓이면 며칠에 걸쳐 나눠 처리되고
 *   그동안 손익계산서 숫자가 비어 있게 된다.
 */
/**
 * 영수증 자동 처리가 언제까지 잘 됐나
 *
 *   "언제부터 안 들어왔지?" 를 알아야 그 사이 손익이 얼마나 비었는지 가늠할 수 있습니다.
 *   원본파일명이 [웹앱] 으로 시작하면 사진에서 AI가 읽은 것입니다.
 */
function 마지막처리확인() {
  Object.keys(BRANCH_CONFIG).forEach(function (branch) {
    var ss = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId);
    var sh = ss.getSheetByName('지출및매출로그');
    Logger.log('\n════════ [' + branch + '] ════════');
    if (!sh || sh.getLastRow() < 2) { Logger.log('  기록 없음'); return; }

    var v = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
    var 마지막 = null, 건수 = 0, 일자별 = {};

    v.forEach(function (r) {
      var src = String(r[5] || '');
      if (src.indexOf('[웹앱]') !== 0) return;      // AI가 읽은 것만
      건수++;
      var t = r[6];                                  // 처리시각
      var ts = (t instanceof Date)
        ? Utilities.formatDate(t, TIMEZONE, 'yyyy-MM-dd')
        : String(t).slice(0, 10);
      if (!ts) return;
      일자별[ts] = (일자별[ts] || 0) + 1;
      if (!마지막 || ts > 마지막) 마지막 = ts;
    });

    if (!건수) { Logger.log('  AI가 읽은 기록이 없습니다'); return; }

    Logger.log('  AI 분석 기록 ' + 건수 + '건');
    Logger.log('  마지막 처리일: ' + 마지막);

    var 오늘 = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
    var 경과 = Math.round((new Date(오늘) - new Date(마지막)) / 86400000);
    // 대기 중인 파일이 있는데 최근 처리가 없으면 지금 고장난 것이다
    var 대기 = 0;
    try {
      var files = DriveApp.getFolderById(BRANCH_CONFIG[branch].folderId).getFiles();
      while (files.hasNext()) {
        var n = files.next().getName().trim();
        if (!n.startsWith('[완료]') && !n.startsWith('[확인요망]')) 대기++;
      }
    } catch (e) {}

    if (경과 >= 2) {
      Logger.log('  ⚠️ ' + 경과 + '일째 새로 들어온 것이 없습니다');
    } else {
      Logger.log('  이력상 ' + 경과 + '일 전까지 처리됨');
    }
    if (대기 > 0) {
      Logger.log('  ⚠️ 처리 대기 ' + 대기 + '장 — 아직 안 들어간 영수증입니다');
    }
    Logger.log('  ※ 이건 과거 이력입니다. 지금 키가 살아있는지는 checkApiKey() 로 확인하세요.');

    Logger.log('\n  최근 처리일 10개');
    Object.keys(일자별).sort().reverse().slice(0, 10).forEach(function (d) {
      Logger.log('     ' + d + '  ' + 일자별[d] + '건');
    });
  });
  Logger.log('\n※ 마지막 처리일 다음날부터 올린 영수증은 아직 안 들어갔습니다.');
}

function checkBacklog() {
  var 총 = 0;
  Object.keys(BRANCH_CONFIG).forEach(function (branch) {
    var folder = DriveApp.getFolderById(BRANCH_CONFIG[branch].folderId);
    var files = folder.getFiles();
    var 대기 = 0, 확인요망 = 0, 완료 = 0;
    while (files.hasNext()) {
      var n = files.next().getName().trim();
      if (n.startsWith('[완료]')) 완료++;
      else if (n.startsWith('[확인요망]')) 확인요망++;
      else 대기++;
    }
    총 += 대기;
    Logger.log('[' + branch + ']  대기 ' + 대기 + '장 · 확인요망 ' + 확인요망 + '장 · 완료 ' + 완료 + '장');
    if (확인요망 > 0) Logger.log('   ↳ retryFailedFiles() 로 재시도할 수 있습니다');
  });

  var 예상초 = 총 * 8;
  Logger.log('\n대기 합계 ' + 총 + '장  →  예상 ' + Math.round(예상초 / 60) + '분');
  if (예상초 > 300) {
    Logger.log('⚠️ 6분 제한을 넘습니다. 오늘 다 못 하고 내일로 넘어갑니다.');
    Logger.log('   → 하루 10장 이내로 올리시면 여유롭습니다.');
  } else {
    Logger.log('✅ 한 번에 처리 가능합니다.');
  }
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

    // ── 사진 없이 금액만 직접 넣기 ─────────────────────────
    //    당근 광고비처럼 「충전식」이라 영수증이 없는 것들을 위한 통로입니다.
    //    앱에서 계정을 고르고 금액을 적어 보내면 로그에 한 줄 들어갑니다.
    if (data.action === 'direct') return 직접입력_(data);

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
        if (!candidate) {
          Logger.log("  ⚠️ 응답에 결과가 없음: " + body.slice(0, 200));
          if (attempt < 3) Utilities.sleep(3000 * attempt);
          continue;
        }
        if (candidate.finishReason === "SAFETY") {
          Logger.log("  ⛔ 안전 필터에 걸림 — 이 이미지는 분석 불가");
          return null;
        }

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
        // 할당량 초과 — 기다렸다 다시 시도
        Logger.log("  ⏳ 429 할당량 초과 — " + Math.pow(2, attempt) * 5 + "초 대기 후 재시도");
        Utilities.sleep(Math.pow(2, attempt) * 5000);

      } else if (code === 400 || code === 403) {
        // 재시도해도 소용없는 오류. 다만 이유는 반드시 남긴다.
        // (예전엔 로그 없이 return null 이라 "왜 실패했는지" 알 수가 없었다)
        var 사유 = code === 403
          ? '키 권한 문제 — API 키가 삭제됐거나 이 API를 못 쓰는 키'
          : '요청 거부 — 이미지 형식·크기 문제이거나 키가 잘못됨';
        Logger.log("  ❌ " + code + " " + 사유);
        Logger.log("     응답: " + body.slice(0, 300));
        return null;

      } else {
        Logger.log("  ⚠️ HTTP " + code + " — " + body.slice(0, 200));
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

// ─────────────────────────────────────────────────────────────
// AI 응답 문지기
//
//  프롬프트로 "합계 행은 출력하지 마세요" 라고 해도 AI는 가끔 어긴다.
//  실제로 마감정산서에서 '매출 합계' 가 기타잡비용으로 두 건 들어와,
//  매출이 비용으로 잡혀 있었다. (2026-08-18 발견)
//
//  부탁이 아니라 코드로 막는다.
// ─────────────────────────────────────────────────────────────

// 합계·소계로 보이는 항목명 — 개별 항목이 이미 따로 들어오므로 중복이다
var SUM_ROW_PATTERN = /합\s*계|소\s*계|총\s*액|total/i;

// 문서 종류별로 허용되는 분류. 없으면 검사하지 않는다.
var ALLOWED_CATEGORIES = {
  '마감정산서': ['현금매출', '카드매출', '배달매출'],
};

/** 기록해도 되는 항목인지 판단. 문제가 있으면 사유를 돌려준다. */
function rejectReason_(item, docType) {
  var name = String(item.항목명 || '').trim();
  var cat  = String(item.분류 || '').trim();

  if (SUM_ROW_PATTERN.test(name)) return '합계 행 (개별 항목과 중복)';

  var allow = ALLOWED_CATEGORIES[docType];
  if (allow && allow.indexOf(cat) === -1) {
    return docType + '에 없는 분류 "' + cat + '" (허용: ' + allow.join(', ') + ')';
  }

  // 날짜가 터무니없으면 사람이 봐야 한다
  var y = Number(String(item.날짜 || '').slice(0, 4));
  if (y && (y < 2024 || y > new Date().getFullYear() + 1)) {
    return '날짜가 이상함 (' + item.날짜 + ')';
  }
  return null;
}

/**
 * 이미 시트에 있는 것을 다시 넣지 않기 위한 열쇠 꾸러미
 *
 * ⚠️ 왜 파일 이름이 아니라 「내용」으로 판단하나 (2026-08-31)
 *
 *   예전에는 파일 이름만 비교했습니다. 그런데 사진을 여러 장 한꺼번에 올리면
 *   이름이 초 단위라 똑같아집니다. 그러면 첫 장만 들어가고 나머지는
 *   「이미 했다」며 [완료] 딱지만 붙은 채 사라졌습니다.
 *   원당 넉 달치 매출 1억 8천만원이 그렇게 안 잡혔습니다.
 *
 *   이름은 우연히 겹치지만, **날짜·분류·금액이 셋 다 같은 것**은 같은 것입니다.
 *
 * 열쇠 = 날짜 + 분류 + 금액
 *
 * ⚠️ 금액을 꼭 넣어야 합니다 (2026-08-31 첫 시도에서 실수함)
 *
 *   처음엔 매출만 「날짜 + 분류」로 했습니다. 하루에 카드매출은 하나일 거라 봤는데
 *   마감정산서는 카드매출을 **두 줄** 만듭니다.
 *       신용카드   → 카드매출
 *       간편결제   → 카드매출   (카카오페이 · 네이버페이 · 페이코)
 *   그래서 간편결제가 통째로 막혔습니다. 실제 로그에서 잡았습니다.
 *       2026-07-19 카드매출 1,625,000원  들어감
 *       2026-07-19 카드매출   117,000원  막힘  ← 간편결제였음
 *
 *   같은 날 미락 영수증이 두 장 오는 일도 있습니다. 금액이 다르면 둘 다 기록해야 합니다.
 *
 * ⚠️ 남는 약점 — 같은 날 · 같은 분류 · 같은 금액이 진짜로 두 건이면 하나만 들어갑니다.
 *    드문 일이고, 「두 번 잡히는 것」보다는 나은 쪽을 골랐습니다.
 */
function 기존기록키_(sheet) {
  var set = {};
  var last = sheet.getLastRow();
  if (last < 2) return set;

  var v = sheet.getRange(2, 1, last - 1, 4).getValues();
  v.forEach(function (r) {
    var cat = String(r[1]).trim();
    var d = toDate_(r[0]);
    if (!d || !cat) return;
    set[Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd') + '|' + cat + '|' + (Number(r[3]) || 0)] = true;
  });
  return set;
}

/** 이 항목의 열쇠. 못 만들면 null (날짜를 못 읽은 것) */
function 기록키_(item, amount) {
  var d = toDate_(item.날짜);
  if (!d) return null;
  return Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd') + '|' +
         String(item.분류 || '기타').trim() + '|' + amount;
}

function recordDataSafely(sheet, items, branchName, fileName, fileId, docType) {
  var timestamp = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
  var rows = [], 거른것 = [];
  var 이미있음 = 기존기록키_(sheet);   // 시트에 이미 있는 것
  var 중복 = 0;

  items.forEach(function(item) {
    var amount = parseInt(String(item.금액 || "0").replace(/[^0-9]/g, "")) || 0;
    if (amount === 0) return;

    var 사유 = rejectReason_(item, docType);
    if (사유) {
      거른것.push('   ⛔ ' + (item.항목명 || '(무명)') + ' ' + amount.toLocaleString() + '원 — ' + 사유);
      return;
    }

    // ── 이미 들어간 것인가 ──────────────────────────────────
    var key = 기록키_(item, amount);
    if (key && 이미있음[key]) {
      중복++;
      거른것.push('   ♻️ ' + item.날짜 + ' ' + item.분류 + ' ' +
                  amount.toLocaleString() + '원 — 이미 시트에 있음');
      return;
    }
    if (key) 이미있음[key] = true;   // 같은 사진 안에서 두 번 나오는 것도 막는다

    rows.push([item.날짜||"", item.분류||"기타", item.항목명||"", amount, branchName, fileName, timestamp, fileId||""]);
    Logger.log("   " + item.날짜 + " | " + item.분류 + " | " + amount.toLocaleString() + "원");
  });

  거른것.forEach(function(l) { Logger.log(l); });

  if (rows.length === 0) return { success: false, count: 0, 거름: 거른것.length, 중복: 중복 };
  rows.forEach(function(r) { sheet.appendRow(r); });
  SpreadsheetApp.flush();
  return { success: true, count: rows.length, 거름: 거른것.length, 중복: 중복 };
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
    _RUN_STAT = { 성공: 0, 오류: 0, 거름: 0 };
    processFiles("원당점");
    processFiles("백석점");

    // ── 고기값 / 주류·음료 원가 자동 동기화 (추가) ──
    // 최근 2개월만 — 전체를 매일 다시 쓰면 6분 제한을 잡아먹는다
    syncMeatCosts("백석점", SYNC_RECENT_MONTHS);
    syncLiquorCosts("백석점", SYNC_RECENT_MONTHS);

    // 알바 데이터 스냅샷 — 알바 시트 A1 이 날아가도 되돌릴 수 있게
    알바데이터_백업();

    // 처리 결과 점검 — 전부 실패했으면 메일로 알린다
    //
    //   2026-08-19: Gemini API 키가 무효가 되어 영수증이 하나도 안 들어가고
    //   있었는데, 로그를 열어보기 전까지 아무도 몰랐다.
    //   영수증이 안 들어가면 손익 숫자가 조용히 비어간다.
    checkRunHealth_();

    // ⚠️ 2026-09-05 — 원당 고기값 자동계상을 켰습니다.
    //    원당 입고앱(index.html)이 새 원당 GAS 로 옮겨지면서
    //    「입고기록」 시트에 '원당점' 으로 쌓이기 시작합니다.
    //    고기 단가는 백석과 같습니다 (사장님 확인).
    //
    //    ⚠️ 원당 입고가 아직 하나도 없으면 그냥 0건으로 지나갑니다. 무해합니다.
    syncMeatCosts("원당점", SYNC_RECENT_MONTHS);
    syncLiquorCosts("원당점", SYNC_RECENT_MONTHS);

    Logger.log("=== 자동 처리 완료 ===");
  } catch (e) {
    Logger.log("FATAL: " + e.message);
  } finally {
    lock.releaseLock();
  }
}

// 구글이 6분에 스크립트를 강제 종료한다. 그 순간 처리 중이던 파일은
// 이름이 안 바뀌어 다음 실행 때 다시 처리되지만, 로그가 끊겨 원인 파악이 어렵다.
// 5분에서 스스로 멈추고 남은 장수를 남기면 상황이 명확해진다.
var _RUN_START = null;
var MAX_RUN_MS = 5 * 60 * 1000;

// 이번 실행의 처리 결과 — checkRunHealth_ 가 읽는다
var _RUN_STAT = { 성공: 0, 오류: 0, 거름: 0 };

var OWNER_EMAIL = 'seungjin0216@gmail.com';

/**
 * 실행이 끝난 뒤 결과를 보고 이상하면 메일을 보낸다
 *
 *   영수증이 안 들어가면 손익 숫자가 조용히 비어갑니다.
 *   로그를 매일 열어보는 사람은 없으므로 알림이 필요합니다.
 *
 *   Gemini 키가 무효가 되어 전부 실패하던 걸 며칠 뒤에야 발견한 적이 있습니다.
 *   (2026-08-19)
 */
function checkRunHealth_() {
  var s = _RUN_STAT;
  Logger.log('\n── 이번 실행 결과 ── 성공 ' + s.성공 + ' · 오류 ' + s.오류 + ' · 거름 ' + s.거름);

  // 처리할 게 있었는데 하나도 성공 못 했으면 뭔가 고장난 것
  if (s.오류 > 0 && s.성공 === 0) {
    notifyOwner_(
      '영수증 처리가 전부 실패했습니다',
      '오류 ' + s.오류 + '건 · 성공 0건\n\n' +
      '자주 나오는 원인\n' +
      ' · Gemini API 키 무효 → 프로젝트 설정 > 스크립트 속성 GEMINI_API_KEY 확인\n' +
      ' · 할당량 초과 → 구글 클라우드 콘솔 확인\n\n' +
      'GAS 편집기에서 checkApiKey() 를 실행하면 바로 알 수 있습니다.'
    );
    return;
  }

  // 절반 넘게 실패하면 뭔가 이상한 것
  if (s.오류 > 0 && s.오류 >= s.성공) {
    notifyOwner_(
      '영수증 처리 실패가 많습니다',
      '성공 ' + s.성공 + '건 · 오류 ' + s.오류 + '건\n\n' +
      '드라이브 폴더에서 [확인요망] 파일을 확인해 주세요.'
    );
  }
}

/** 사장님께 메일. 솔라피와 무관한 경로라 그쪽이 막혀도 나간다 */
function notifyOwner_(제목, 내용) {
  Logger.log('🚨 ' + 제목);
  try {
    MailApp.sendEmail(OWNER_EMAIL, '🚨 [손익계산서] ' + 제목,
      내용 + '\n\n시각: ' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm'));
  } catch (e) {
    Logger.log('메일 전송 실패: ' + e.message);
  }
}

// 매일 도는 동기화가 볼 기간 (개월). 과거는 이미 들어가 있고 바뀌지 않는다.
var SYNC_RECENT_MONTHS = 2;

/** 오늘로부터 n개월 전 1일의 yyyy-MM-dd. n 이 없으면 null(=전체) */
function monthsAgoYmd_(n) {
  if (!n) return null;
  var d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(1);
  return Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');
}

/**
 * 입고기록·식자재발주를 소급 수정했을 때만 손으로 실행
 *   과거 전체를 다시 맞춘다. 몇 분 걸릴 수 있다.
 */
function 원가_전체동기화() {
  Logger.log('=== 전체 기간 재동기화 (수동) ===');
  syncMeatCosts('백석점');
  syncLiquorCosts('백석점');
  Logger.log('=== 완료 ===');
}

function processFiles(branchName) {
  Logger.log("\n========== [" + branchName + "] ==========");
  var config = BRANCH_CONFIG[branchName];
  if (!config) return;

  var ss       = SpreadsheetApp.openById(config.ssId);
  var folder   = DriveApp.getFolderById(config.folderId);
  var logSheet = ss.getSheetByName("지출및매출로그") || ss.insertSheet("지출및매출로그");
  ensureHeaders(logSheet);

  var processed = 0, skipped = 0, errors = 0, 남음 = 0;
  var files = folder.getFiles();
  if (!_RUN_START) _RUN_START = new Date().getTime();

  while (files.hasNext()) {
    var file = files.next();
    var name = file.getName().trim();

    // 시간이 다 되면 멈춘다. 처리한 파일은 이미 [완료]로 바뀌어 있어
    // 다음 실행이 이어서 한다. 손실은 없고 지연만 생긴다.
    if (new Date().getTime() - _RUN_START > MAX_RUN_MS) {
      if (!name.startsWith("[완료]") && !name.startsWith("[확인요망]")) 남음++;
      continue;
    }

    if (name.startsWith("[완료]") || name.startsWith("[확인요망]") ||
        name.startsWith("[중복확인]")) { skipped++; continue; }
    if (!file.getMimeType().startsWith("image/")) continue;

    // ⚠️ 2026-08-31 — 파일 이름 비교(isAlreadyProcessed)를 뺐습니다.
    //    사진을 한꺼번에 올리면 이름이 초 단위라 겹칩니다.
    //    그때 이 검사가 「이미 했다」며 시트엔 아무것도 안 쓰고 [완료] 만 붙였습니다.
    //    원당 넉 달치 매출 1억 8천만원이 그렇게 사라졌습니다.
    //    이제 중복은 recordDataSafely 가 **날짜·분류·금액**으로 판단합니다.
    if (isAlreadyProcessedById(logSheet, file.getId())) {
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

      var result = recordDataSafely(logSheet, res, branchName, name, file.getId(), docType);
      if (result.success) { safeRename(file, "[완료] " + name); processed++; }
      else if (result.중복 > 0) {
        // 읽기는 잘 됐는데 전부 이미 시트에 있는 것이었다.
        // [완료] 를 붙이면 예전처럼 조용히 묻히므로 눈에 띄는 딱지를 붙인다.
        safeRename(file, "[중복확인] " + name);
        Logger.log("   ♻️ 이미 들어간 내용 — [중복확인] 으로 표시");
        skipped++;
      }
      else { safeRename(file, "[확인요망] 기록실패_" + name); errors++; }
    } catch (e) {
      safeRename(file, "[확인요망] 오류_" + name); errors++;
    }
    Utilities.sleep(2000);
  }

  _RUN_STAT.성공 += processed;
  _RUN_STAT.오류 += errors;
  Logger.log("✅ 성공: " + processed + " | ⏭ 스킵: " + skipped + " | ❌ 오류: " + errors);
  if (남음 > 0) {
    Logger.log("⏳ 시간 초과로 " + 남음 + "장을 남겼습니다 — 내일 새벽 2시에 이어서 처리됩니다.");
    Logger.log("   매일 조금씩(10장 이내) 올리시면 이런 일이 없습니다.");
  }
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

/**
 * 광고비 소급 동기화 — 1월부터 지난달까지 한꺼번에
 *
 *   2026-09-04 — 열 밀림 버그 때문에 네이버 광고비가 한 번도 안 들어갔습니다.
 *   버그를 고쳤으니 밀린 달을 한 번에 채웁니다.
 *
 *   ⚠️ upsert 방식이라 여러 번 돌려도 두 번 잡히지 않습니다.
 *      같은 표시([자동]네이버광고_지점_연월)를 찾아 갱신합니다.
 */
function 광고비_소급_미리보기() { 광고비소급_(true);  }
function 광고비_소급_적용()   { 광고비소급_(false); }

function 광고비소급_(dryRun) {
  var now = new Date();
  var 올해 = now.getFullYear();
  var 끝달 = now.getMonth() + 1;   // 이번 달까지 (진행 중이어도 지금까지 쓴 것)

  Logger.log(dryRun ? '=== 광고비 소급 (미리보기) ===' : '=== 광고비 소급 (적용) ===');

  ['원당점', '백석점'].forEach(function (branch) {
    Logger.log('\n──── [' + branch + '] ────');
    var 합 = 0;
    for (var m = 1; m <= 끝달; m++) {
      var cost = 0;
      try {
        cost = getNaverAdCostForMonth(BRANCH_CONFIG[branch].naverSheetId, 올해, m);
      } catch (e) { Logger.log('  ' + m + '월 오류: ' + e.message); continue; }
      if (cost <= 0) continue;
      Logger.log('  ' + olheMonth_(올해, m) + '  ' + cost.toLocaleString() + '원');
      합 += cost;
      if (!dryRun) writeNaverAdCostToSheet(branch, 올해, m, cost);
    }
    Logger.log('  합계 ' + 합.toLocaleString() + '원');
  });

  Logger.log(dryRun ? '\n※ 미리보기입니다. 아무것도 안 바꿨습니다.'
                    : '\n✅ 완료. 손익계산서 「광고비」 줄에 반영됩니다.');
  Logger.log('※ 당근 광고비는 영수증앱의 「금액만 넣기」로 따로 넣으셔야 합니다.');
}

function olheMonth_(y, m) { return y + '-' + ('0' + m).slice(-2); }

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

/**
 * 트래커 「광고성과」 탭에서 그 달 네이버 광고비를 합산한다.
 *
 * ⚠️ 2026-09-04 — 열 번호가 한 칸씩 밀려 있던 것을 고쳤습니다.
 *
 *   광고성과 탭에 나중에 「id」 열이 앞에 붙으면서 전부 밀렸는데
 *   코드는 옛 자리를 그대로 보고 있었습니다.
 *
 *       코드가 보던 것   row[0] = 날짜 · row[5] = 비용
 *       실제            row[0] = id   · row[1] = 날짜 · row[6] = 비용
 *
 *   그래서 id 를 날짜로 읽어 전부 걸러졌고, 네이버 광고비가
 *   **한 번도 손익계산서에 안 들어갔습니다.** 조용한 실패였습니다.
 *
 * ⚠️ 열 위치로 찾지 말고 **머리글 이름으로** 찾습니다.
 *    열이 또 늘어나도 안 깨집니다.
 */
function getNaverAdCostForMonth(naverSheetId, year, month) {
  var ss    = SpreadsheetApp.openById(naverSheetId);
  var sheet = ss.getSheetByName("광고성과");
  if (!sheet) return 0;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;

  var lastCol = sheet.getLastColumn();
  var head    = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
                     .map(function (h) { return String(h).trim(); });
  var iDate = head.indexOf('날짜');
  var iCost = head.indexOf('비용');
  if (iDate < 0 || iCost < 0) {
    Logger.log('  ⚠️ 광고성과 탭에 「날짜」 또는 「비용」 머리글이 없습니다: ' + head.join(', '));
    return 0;
  }

  var data  = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var total = 0;
  data.forEach(function(row) {
    if (!row[iDate] || row[iCost] === "" || row[iCost] === null) return;
    var d = (row[iDate] instanceof Date) ? row[iDate] : toDate_(row[iDate]);
    if (!d || isNaN(d.getTime())) return;
    if (d.getFullYear() === year && (d.getMonth() + 1) === month) {
      total += parseInt(String(row[iCost]).replace(/[^0-9]/g, "")) || 0;
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
  logSheet.appendRow([dateStr, "광고비", year+"년 "+month+"월 네이버 광고", cost, branchName, marker, nowStr, ""]);
  SpreadsheetApp.flush();
}


// ════════════════════════════════════════════════════════════
// 🧹 분류이름정리 — 괄호가 붙어 계상이 안 되던 것들
//
//   증상 (2026-09-02 발견)
//     시트는 B열 라벨과 **글자 그대로 같은** 분류만 SUMIFS 로 잡습니다.
//     괄호가 하나 붙으면 다른 계정으로 봅니다. 그래서 조용히 빠집니다.
//
//        가스사용료(매장)        8/21  248,530원   ← 8월 손익에 안 잡힘
//        매장관리비(전기,수도)   7/01 1,177,780원  ← 7월 손익에 안 잡힘
//
//   ⚠️ 「중복제외」는 일부러 그대로 둡니다
//     양깃머리 335,920원은 **가게카드에 이미 포함**된 건이라 뺀 것입니다.
//     계정이 아니라 「빼놓은 표시」이므로 계상이 안 되는 게 맞습니다.
//     괄호만 없애고 계정으로는 안 씁니다.
//
//   ⚠️ 「네이버 광고비용」 → 「광고비」
//     퍼플 · 네이버 · 당근을 한 계정으로 모으기로 했습니다 (2026-09-02 결정).
//     로그의 옛 이름도 같이 바꿉니다.
// ════════════════════════════════════════════════════════════

var 분류바꾸기_ = {
  '가스사용료(매장)':      '가스사용료',
  '매장관리비(전기,수도)': '매장관리비',
  '중복제외(카드포함)':    '중복제외',
  '네이버 광고비용':       '광고비',
};

function 분류이름정리_미리보기() { 분류이름정리_(true);  }
function 분류이름정리_적용()   { 분류이름정리_(false); }

function 분류이름정리_(dryRun) {
  Logger.log(dryRun ? '=== 분류 이름 정리 (미리보기) ===' : '=== 분류 이름 정리 (적용) ===');

  Object.keys(BRANCH_CONFIG).forEach(function (branch) {
    var ss = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId);
    var sh = ss.getSheetByName('지출및매출로그');
    if (!sh || sh.getLastRow() < 2) return;

    Logger.log('\n──── [' + branch + '] ────');
    var last = sh.getLastRow();
    var 분류들 = sh.getRange(2, 2, last - 1, 1).getValues();
    var 금액들 = sh.getRange(2, 4, last - 1, 1).getValues();
    var 날짜들 = sh.getRange(2, 1, last - 1, 1).getValues();
    var 바꾼수 = 0;

    for (var i = 0; i < 분류들.length; i++) {
      var 옛 = String(분류들[i][0]).trim();
      var 새 = 분류바꾸기_[옛];
      if (!새) continue;

      var d = toDate_(날짜들[i][0]);
      Logger.log('  ' + (d ? Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd') : '?') +
                 '  ' + Number(금액들[i][0]).toLocaleString() + '원   ' +
                 옛 + '  →  ' + 새);
      바꾼수++;
      if (!dryRun) sh.getRange(i + 2, 2).setValue(새);   // 그 칸만 하나씩 쓴다
    }

    if (!바꾼수) Logger.log('  바꿀 것 없음 ✅');
    else if (!dryRun) { SpreadsheetApp.flush(); Logger.log('  ✅ ' + 바꾼수 + '건 바꿈'); }
  });

  Logger.log(dryRun ? '\n※ 미리보기입니다. 아무것도 안 바꿨습니다.'
                    : '\n✅ 완료. 손익계산서 숫자가 바로 바뀝니다.');
  Logger.log('※ 「중복제외」는 계정이 아니라 표시용이라 계상되지 않는 것이 맞습니다.');
}


// ════════════════════════════════════════════════════════════
// 🕐 시간대고치기 — 백석 시트가 하루 뒤처져 있던 문제
//
//   증거 (2026-09-04 확인)
//     같은 시각에 두 시트에 TODAY() 를 물었더니 답이 달랐습니다.
//        백석   TODAY = 2026-09-03      B7 = 2026-08-31
//        원당   TODAY = 2026-09-04      B7 = 2026-09-01
//     B7 에 든 값은 똑같은데 시트마다 다르게 읽었습니다.
//     백석 시트의 시간대가 서울보다 뒤처져 있어 하루가 밀린 것입니다.
//
//   무엇이 망가지나
//     A51 = EOMONTH(B7,0)      9월 말일이 아니라 8월 말일이 나옴
//     A52 = MIN(A51, TODAY())  일할계산 기준일이 지난달에 머무름
//     → 9월 시트가 8월 손익을 그대로 보여줍니다.
//
//   ⚠️ 파일 → 설정 → 시간대 에서 「서울」로 보였는데도 안 먹었습니다.
//      그래서 코드로 직접 박습니다.
//
//   ⚠️ 시간대를 바꾸면 「처리시각」처럼 시각이 든 칸의 표시가 몇 시간 밀립니다.
//      날짜만 든 칸은 그대로입니다. 지금이 틀린 상태이므로 바꾸는 게 맞습니다.
// ════════════════════════════════════════════════════════════

function 시간대_미리보기() { 시간대고치기_(true);  }
function 시간대_적용()   { 시간대고치기_(false); }

function 시간대고치기_(dryRun) {
  var 목표 = 'Asia/Seoul';
  Logger.log(dryRun ? '=== 시간대 확인 (미리보기) ===' : '=== 시간대 적용 ===');

  Object.keys(BRANCH_CONFIG).forEach(function (branch) {
    var ss = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId);
    var 현재 = null;
    try { 현재 = ss.getSpreadsheetTimeZone(); } catch (e) {}
    var 유효 = (typeof 현재 === 'string' && 현재.length > 0);

    Logger.log('\n[' + branch + ']  지금: ' + (유효 ? 현재 : '(비어 있음)'));

    if (유효 && 현재 === 목표) { Logger.log('  이미 서울입니다 ✅'); return; }
    if (dryRun) { Logger.log('  → ' + 목표 + ' 로 바꿀 예정'); return; }

    ss.setSpreadsheetTimeZone(목표);
    SpreadsheetApp.flush();
    var 확인 = null;
    try { 확인 = ss.getSpreadsheetTimeZone(); } catch (e) {}
    Logger.log('  → 바꿈. 다시 읽으니: ' + (확인 || '(비어 있음)'));

    // 시트가 실제로 어떤 오늘을 보는지 확인
    var sh = ss.getSheets()[0];
    var 임시 = sh.getRange(1, 40);
    try {
      임시.setFormula('=TEXT(TODAY(),"yyyy-MM-dd")');
      SpreadsheetApp.flush();
      Logger.log('  시트가 보는 오늘: ' + 임시.getValue());
    } catch (e) {
    } finally { 임시.clearContent(); SpreadsheetApp.flush(); }
  });

  Logger.log(dryRun ? '\n※ 미리보기입니다. 아무것도 안 바꿨습니다.'
                    : '\n✅ 완료. 이어서 fixBaseDatesForCurrentMonth() 를 실행하세요.');
  Logger.log('※ B7 을 「값」이 아니라 =DATE() 「수식」으로 되돌려야 완전히 안전해집니다.');
}


// ════════════════════════════════════════════════════════════
// 📣 광고비계정정리 — 시트 라벨과 수식의 「네이버 광고비용」을 「광고비」로
//
//   왜 (2026-09-02 결정)
//     광고를 세 곳에서 돌렸습니다.
//        퍼플    1~2월. 이미 「광고비」로 계상 완료. 지금은 안 씀
//        네이버  트래커가 가져오는 중. 한 번도 계상 안 됨
//        당근    한 번도 계상 안 됨. 충전식이라 영수증 없음
//     나눠 볼 이유가 없어 **한 계정으로 모으기로** 했습니다.
//
//   ⚠️ 로그만 바꾸면 안 됩니다
//     시트는 B열 라벨과 **수식 안의 분류 이름**으로 SUMIFS 를 겁니다.
//     둘 다 바꿔야 잡힙니다. 이 함수는 두 곳을 같이 고칩니다.
//
//   ⚠️ 수식을 건드리는 함수입니다. 반드시 미리보기부터 보세요.
//      2026-08-17 에 setFormulas 로 9개월치를 날린 사고가 있었습니다.
//      그래서 여기서는 **바꿀 칸만 setFormula 로 하나씩** 씁니다.
// ════════════════════════════════════════════════════════════

function 광고비계정_미리보기() { 광고비계정정리_(true);  }
function 광고비계정_적용()   { 광고비계정정리_(false); }

function 광고비계정정리_(dryRun) {
  var 옛이름 = '네이버 광고비용';
  var 새이름 = '광고비';

  Logger.log(dryRun ? '=== 광고비 계정 정리 (미리보기) ===' : '=== 광고비 계정 정리 (적용) ===');

  var 바꾼수 = 0;

  Object.keys(BRANCH_CONFIG).forEach(function (branch) {
    var ss = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId);
    Logger.log('\n──── [' + branch + '] ────');

    var targets = ['26년 x월 손익계산서'];
    for (var m = 1; m <= 12; m++) targets.push('26년 ' + m + '월 손익계산서');

    targets.forEach(function (tabName) {
      var sh = ss.getSheetByName(tabName);
      if (!sh) return;

      var row = findLabelRow_(sh, 옛이름.replace(/\s+/g, ''));
      if (row < 0) return;    // 이미 바꿨거나 그 지점엔 없는 행

      // 그 행의 C열 ~ AK열에서 옛 이름이 든 수식을 찾는다
      var 고칠칸 = [];
      var lastCol = Math.min(sh.getLastColumn(), 37);
      var fs = sh.getRange(row, 3, 1, lastCol - 2).getFormulas()[0];
      for (var i = 0; i < fs.length; i++) {
        if (fs[i] && fs[i].indexOf(옛이름) >= 0) 고칠칸.push({ col: i + 3, f: fs[i] });
      }

      Logger.log('  ' + tabName + '  ' + row + '행   라벨 + 수식 ' + 고칠칸.length + '칸');
      바꾼수++;

      if (dryRun) return;

      sh.getRange(row, 2).setValue(새이름);                 // B열 라벨
      고칠칸.forEach(function (c) {                          // 바꿀 칸만 하나씩
        sh.getRange(row, c.col).setFormula(c.f.split(옛이름).join(새이름));
      });
      SpreadsheetApp.flush();
    });
  });

  if (!바꾼수) {
    Logger.log('\n바꿀 것이 없습니다. 이미 「광고비」로 되어 있거나 그 행이 없습니다.');
    Logger.log('⚠️ 시트에서 B열 라벨을 직접 확인해 보세요.');
    return;
  }

  Logger.log(dryRun ? '\n※ ' + 바꾼수 + '곳 변경 예정. 아무것도 안 바꿨습니다.'
                    : '\n✅ ' + 바꾼수 + '곳 적용 완료. 퍼플 6건이 바로 잡힙니다.');
}


// ════════════════════════════════════════════════════════════
// 🧾 관리비분리 — 7월 미납분이 8월과 한 줄로 들어간 건 정리
//
//   사정 (2026-09-02)
//     7월 관리비를 미납해서 8월 고지서에 두 달치가 함께 나왔습니다.
//     영수증 한 장에 두 달치가 적혀 있어 AI 가 한 줄로 넣었습니다.
//
//        7/01  매장관리비(전기,수도)  1,177,780원   ← 두 달치
//
//     발생한 달에 각각 잡혀야 손익이 맞습니다.
//        7월  529,430원   (7월분 519,770 + 미납가산 9,660)
//        8월  648,350원
//
//   ⚠️ 이번 한 번뿐인 일이라 이 함수도 일회용입니다. 두 번 돌리지 마세요.
//      (안전장치가 있어 두 번 돌려도 아무 일 안 일어나게 해뒀습니다)
// ════════════════════════════════════════════════════════════

function 관리비분리_미리보기() { 관리비분리_(true);  }
function 관리비분리_적용()   { 관리비분리_(false); }

function 관리비분리_(dryRun) {
  var 원본금액 = 1177780;
  var 칠월     = 529430;   // 519,770 + 미납가산 9,660
  var 팔월     = 648350;

  Logger.log(dryRun ? '=== 7월 관리비 분리 (미리보기) ===' : '=== 7월 관리비 분리 (적용) ===');

  var ss = SpreadsheetApp.openById(BRANCH_CONFIG['백석점'].ssId);
  var sh = ss.getSheetByName('지출및매출로그');
  var last = sh.getLastRow();
  var v = sh.getRange(2, 1, last - 1, 4).getValues();

  var 찾음 = -1;
  for (var i = 0; i < v.length; i++) {
    var cat = String(v[i][1]).trim();
    if ((cat === '매장관리비(전기,수도)' || cat === '매장관리비') &&
        Number(v[i][3]) === 원본금액) { 찾음 = i; break; }
  }

  if (찾음 < 0) {
    Logger.log('  대상을 못 찾았습니다 (' + 원본금액.toLocaleString() + '원).');
    Logger.log('  이미 나눈 뒤이거나 금액이 다릅니다. 그대로 두세요.');
    return;
  }

  Logger.log('  찾음: ' + (찾음 + 2) + '행  ' + 원본금액.toLocaleString() + '원');
  Logger.log('    → 7월  ' + 칠월.toLocaleString() + '원  (7월분 519,770 + 미납가산 9,660)');
  Logger.log('    → 8월  ' + 팔월.toLocaleString() + '원  (당월분)');

  if (dryRun) { Logger.log('\n※ 미리보기입니다. 아무것도 안 바꿨습니다.'); return; }

  // 원래 줄을 7월분으로 고치고, 8월분은 한 줄 새로 넣는다
  sh.getRange(찾음 + 2, 2).setValue('매장관리비');
  sh.getRange(찾음 + 2, 3).setValue('관리비 (7월분 + 미납가산)');
  sh.getRange(찾음 + 2, 4).setValue(칠월);

  var nowStr = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  sh.appendRow(['2026-08-01', '매장관리비', '관리비 (8월 당월분)', 팔월, '백석점', '[분리]7월관리비', nowStr, '']);
  SpreadsheetApp.flush();

  Logger.log('\n✅ 나눴습니다. 7월·8월 손익이 각각 맞춰집니다.');
}


// ════════════════════════════════════════════════════════════
// ✍️ 직접입력 — 영수증이 없는 지출을 금액만으로 기록
//
//   왜 필요한가 (2026-09-02)
//     당근 광고비는 **충전식**입니다. 10만원 충전하면 그것으로 끝이고
//     따로 받을 영수증이 없습니다. 네이버 광고비는 트래커가 자동으로 가져오지만
//     당근은 연동할 방법이 없습니다.
//
//     수기로 시트에 적으면 결국 안 하게 됩니다.
//     매장관리비가 여덟 달 내내 하드코딩이던 것도 같은 이유였습니다.
//     **앱에서 두 번 눌러 끝나야** 계속 씁니다.
//
//   ⚠️ 중복은 막지 않고 알려만 줍니다
//     사람이 직접 누르는 것이라, 같은 날 같은 금액을 두 번 충전할 수도 있습니다.
//     막아버리면 진짜 두 건일 때 하나가 사라집니다.
//     그래서 기록은 하되 「같은 것이 이미 있습니다」를 돌려줍니다.
// ════════════════════════════════════════════════════════════

function 직접입력_(data) {
  var store  = data.store || '백석점';
  var cat    = String(data.분류 || data.category || '').trim();
  var amount = parseInt(String(data.금액 || data.amount || '0').replace(/[^0-9]/g, ''), 10) || 0;
  var memo   = String(data.항목명 || data.memo || '').trim();
  var ymd    = String(data.날짜 || data.date || '').trim();

  if (!cat)      return jsonOut_({ success: false, error: '분류가 비었습니다' });
  if (amount <= 0) return jsonOut_({ success: false, error: '금액이 0원입니다' });

  var config = BRANCH_CONFIG[store];
  if (!config) return jsonOut_({ success: false, error: '알 수 없는 지점: ' + store });

  // 날짜를 안 주면 오늘
  var d = ymd ? toDate_(ymd) : new Date();
  if (!d) return jsonOut_({ success: false, error: '날짜를 못 읽었습니다: ' + ymd });
  var 날짜문자 = Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');

  var ss = SpreadsheetApp.openById(config.ssId);
  var logSheet = ss.getSheetByName('지출및매출로그') || ss.insertSheet('지출및매출로그');
  ensureHeaders(logSheet);

  // 같은 것이 이미 있나 — 막지는 않고 알려만 준다
  var 이미있음 = !!기존기록키_(logSheet)[날짜문자 + '|' + cat + '|' + amount];

  var nowStr = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  logSheet.appendRow([날짜문자, cat, memo || cat, amount, store, '[직접입력]', nowStr, '']);
  SpreadsheetApp.flush();

  Logger.log('✍️ 직접입력 [' + store + '] ' + 날짜문자 + ' ' + cat + ' ' +
             amount.toLocaleString() + '원' + (이미있음 ? '  ⚠️ 같은 것이 이미 있었음' : ''));

  return jsonOut_({
    success: true,
    날짜: 날짜문자, 분류: cat, 금액: amount,
    중복의심: 이미있음,
    message: (이미있음 ? '⚠️ 같은 날 같은 금액이 이미 있습니다. 두 번 넣으신 게 맞나요?' : '기록했습니다')
  });
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

/**
 * 식자재 원가 소급 — 발주 기록 전체를 다시 훑어 계상
 *
 *   2026-09-04 — 콩나물 단가가 없어 계상이 통째로 빠져 있었습니다.
 *   단가를 넣었으니 그동안의 발주를 한 번에 채웁니다.
 *
 *   ⚠️ upsert 방식이라 여러 번 돌려도 두 번 잡히지 않습니다.
 *      같은 표시([자동]분류_지점_날짜_row번호)를 찾아 갱신합니다.
 *   ⚠️ 6분 제한이 있습니다. 끊기면 한 번 더 돌리세요.
 */
function 식자재원가_전체동기화() {
  ['백석점', '원당점'].forEach(function (b) {
    try { syncLiquorCosts(b, null); }        // null = 기간 제한 없음
    catch (e) { Logger.log('[' + b + '] 오류: ' + e.message); }
  });
  Logger.log('\n✅ 완료. 주류원가 · 음료원가 · 콩나물이 채워집니다.');
  Logger.log('※ 「단가 없음」이 찍힌 품목이 있으면 단가표를 채워야 합니다 (지금은 복분자).');
}

// ── 콩나물 단가 (1개) — 2026-09-04 추가
//    발주 앱에 기록은 남는데 금액 계산을 안 해서 계상이 빠져 있었습니다.
//    주류·음료와 같은 방식으로 붙였습니다.
var BEANSPROUT_PRICES = {
  '콩나물': 9000
};

// ── 음료수 단가 (1케이스)
//    ⚠️ 원당은 「웰치스포도」를 안 씁니다. 단가는 백석과 같습니다.
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
/**
 * @param {number} [months] 최근 몇 개월만 볼지. 생략하면 전체.
 *
 *   매일 도는 자동 실행이 5월치까지 매번 다시 쓰고 있었다.
 *   덮어쓰기라 결과는 같지만 시트 쓰기가 느려 6분 제한을 잡아먹는다.
 *   과거는 이미 들어가 있고 바뀔 일도 없으니 최근 것만 본다.
 *   입고기록을 소급 수정했을 때만 고기값_전체동기화() 를 손으로 실행.
 */
function syncMeatCosts(branchName, months) {
  var 기준 = monthsAgoYmd_(months);
  Logger.log('\n--- [' + branchName + '] 고기값 동기화 시작' +
             (기준 ? ' (' + 기준 + ' 이후)' : ' (전체)') + ' ---');

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
    if (기준 && parsed.ymd < 기준) continue;   // 오래된 건 건너뛴다

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
/** @param {number} [months] 최근 몇 개월만. 생략하면 전체. (syncMeatCosts 와 동일) */
/**
 * 식자재 발주 → 손익계산서 원가 계상
 *
 * ⚠️ 이름은 「주류」로 시작하지만 실제로는 **주류 · 음료 · 콩나물** 셋을 다 봅니다.
 *    2026-09-04 에 콩나물이 추가됐습니다. 이름은 옛것을 그대로 뒀습니다
 *    (트리거·다른 코드에서 부르고 있어서 바꾸면 끊깁니다).
 *
 * 「식자재발주」 시트 한 줄이 이렇게 생겼습니다
 *      날짜 | 지점 | 업체 | "콩나물 3, ..."
 * 업체별 단가표에서 단가를 찾아 수량을 곱해 로그에 씁니다.
 *
 * ⚠️ 단가가 없는 품목은 조용히 0원이 됩니다. 로그에 「단가 없음」이 찍히니 확인하세요.
 *    지금은 복분자가 0원입니다 (단가 미확인).
 */
function syncLiquorCosts(branchName, months) {
  var 기준 = monthsAgoYmd_(months);
  Logger.log('\n--- [' + branchName + '] 주류·음료·콩나물 동기화 시작' +
             (기준 ? ' (' + 기준 + ' 이후)' : ' (전체)') + ' ---');

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
    // ⚠️ 2026-09-04 — 콩나물을 여기 넣었습니다.
    //    발주 기록은 남는데 금액 계산이 없어 계상이 통째로 빠져 있었습니다.
    if (supplier !== '주류' && supplier !== '음료수' && supplier !== '콩나물') continue;

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
    if (기준 && ymd < 기준) continue;   // 오래된 건 건너뛴다

    // body 파싱: "[백석점 발주 ...]\n품목 수량, ..." 또는 "품목 수량, ..." 두 형식 모두 처리
    var itemLine;
    if (bodyText.includes('\n')) {
      itemLine = bodyText.split('\n').slice(1).join(' ').trim();
    } else {
      itemLine = bodyText.trim();
    }
    if (!itemLine) { Logger.log('품목 정보 없음 (row ' + (i+1) + ')'); continue; }

    var prices   = (supplier === '주류')   ? LIQUOR_PRICES
                 : (supplier === '콩나물') ? BEANSPROUT_PRICES
                 : DRINK_PRICES;
    var category = (supplier === '주류')   ? '주류원가'
                 : (supplier === '콩나물') ? '콩나물'
                 : '음료원가';
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


// ═══════════════════════════════════════════════════════════
// 알바 데이터 자동 백업
//
//  알바계산기는 데이터를 시트 한 칸(A1)에 JSON 통째로 넣습니다.
//  그 칸이 지워지거나 빈 값으로 덮이면 전부 사라집니다.
//  알바 백엔드에는 동시저장 보호도 데이터 검증도 없습니다.
//
//  그래서 매일 한 번 받아서 여기에 쌓아둡니다.
//  알바 쪽 코드는 하나도 건드리지 않습니다. 읽기만 합니다.
//
//  구글 시트 한 칸은 5만 자까지라, 커지면 여러 칸에 나눠 담습니다.
// ═══════════════════════════════════════════════════════════
var ALBA_BACKUP_TAB  = '알바백업';
var ALBA_BACKUP_KEEP = 60;      // 보관할 스냅샷 개수 (약 2개월)
var CHUNK_SIZE       = 45000;   // 한 칸에 담을 글자 수
var CHUNK_COLS       = 5;       // 최대 칸 수 → 22만 자까지

function albaBackupSheet_() {
  var ss = SpreadsheetApp.openById(BRANCH_CONFIG['백석점'].ssId);
  var sh = ss.getSheetByName(ALBA_BACKUP_TAB);
  if (!sh) {
    sh = ss.insertSheet(ALBA_BACKUP_TAB);
    sh.appendRow(['백업시각', '지점', '알바', '지급', '글자수',
                  'JSON1', 'JSON2', 'JSON3', 'JSON4', 'JSON5']);
    sh.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#dcfce7');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** 지금 알바 데이터를 받아 한 줄 쌓는다 */
function 알바데이터_백업() {
  var raw;
  try {
    raw = UrlFetchApp.fetch(ALBA_SCRIPT_URL + '?t=' + Date.now(),
                            { muteHttpExceptions: true }).getContentText();
  } catch (e) { Logger.log('❌ 알바계산기 호출 실패: ' + e.message); return; }

  var j;
  try { j = JSON.parse(raw); }
  catch (e) { Logger.log('❌ 응답 파싱 실패: ' + raw.slice(0, 200)); return; }
  if (!j.ok || !j.data) { Logger.log('❌ 데이터 없음'); return; }

  var d = j.data;
  var 알바수 = (d.workers || []).length;

  // 빈 데이터를 백업하면 나중에 그걸로 복원했다가 진짜로 날아간다
  if (!알바수) { Logger.log('⚠️ 알바가 0명 — 백업하지 않습니다'); return; }

  var text = JSON.stringify(d);
  if (text.length > CHUNK_SIZE * CHUNK_COLS) {
    Logger.log('⚠️ 너무 큽니다 (' + text.length.toLocaleString() + '자) — CHUNK_COLS 를 늘리세요');
    return;
  }

  var sh = albaBackupSheet_();

  // 직전과 같으면 안 쌓는다 (같은 내용이 매일 늘어나는 것 방지)
  var last = sh.getLastRow();
  if (last > 1) {
    var prev = '';
    for (var c = 6; c < 6 + CHUNK_COLS; c++) prev += String(sh.getRange(last, c).getValue() || '');
    if (prev === text) { Logger.log('변경 없음 — 건너뜀'); return; }
  }

  var row = [
    Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
    (d.branches || []).length, 알바수, (d.payments || []).length, text.length,
  ];
  for (var i = 0; i < CHUNK_COLS; i++) row.push(text.substr(i * CHUNK_SIZE, CHUNK_SIZE));
  sh.appendRow(row);

  var over = sh.getLastRow() - 1 - ALBA_BACKUP_KEEP;
  if (over > 0) sh.deleteRows(2, over);

  SpreadsheetApp.flush();
  Logger.log('💾 알바 백업 — 알바 ' + 알바수 + '명 · 지급 ' + (d.payments || []).length +
             '건 · ' + text.length.toLocaleString() + '자');
}

/** 쌓인 백업 목록 */
function 알바백업_목록() {
  var sh = albaBackupSheet_();
  var last = sh.getLastRow();
  if (last < 2) { Logger.log('백업 없음'); return; }

  Logger.log('═══ 알바 백업 (' + (last - 1) + '개) ═══');
  sh.getRange(2, 1, last - 1, 5).getValues().forEach(function (r, i) {
    Logger.log('  ' + (i + 2) + '행 | ' + r[0] + ' | 지점 ' + r[1] +
               ' · 알바 ' + r[2] + '명 · 지급 ' + r[3] + '건 · ' +
               Number(r[4]).toLocaleString() + '자');
  });
  Logger.log('\n※ 되돌리려면 알바백업_복원용출력() 안의 행번호를 바꿔 실행하세요.');
}

/**
 * 특정 백업의 JSON 을 로그에 찍는다 (수동 복원용)
 *   복사해서 알바 시트 「알바비데이터」 A1 에 붙여넣으면 그 시점으로 돌아갑니다.
 *   자동으로 되돌리지 않는 이유 — 실수로 최신 데이터를 덮어쓰는 게 더 무섭습니다.
 */
function 알바백업_복원용출력() {
  var 행번호 = 0;   // 0 이면 가장 최근 것

  var sh = albaBackupSheet_();
  var last = sh.getLastRow();
  if (last < 2) { Logger.log('백업 없음'); return; }
  var r = 행번호 || last;

  var meta = sh.getRange(r, 1, 1, 5).getValues()[0];
  var text = '';
  for (var c = 6; c < 6 + CHUNK_COLS; c++) text += String(sh.getRange(r, c).getValue() || '');

  Logger.log('═══ ' + meta[0] + ' 백업 ═══');
  Logger.log('알바 ' + meta[2] + '명 · 지급 ' + meta[3] + '건\n');
  Logger.log('아래를 통째로 복사 → 알바 시트 「알바비데이터」 A1 에 붙여넣기\n');
  Logger.log(text);
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


// ════════════════════════════════════════════════════════════
// 🔍 양식대조 — 백석과 원당의 월별 시트를 나란히 놓고 다른 곳 찾기
//
//  왜 필요한가 (2026-08-25)
//    영수증을 읽는 코드는 두 지점이 이미 같은 것을 씁니다 (BRANCH_CONFIG).
//    다른 것은 **시트 안의 수식**입니다.
//    백석은 여러 번 손봐서 자리를 잡았는데 원당은 손댄 적이 거의 없습니다.
//
//  ⚠️ 읽기만 합니다. 아무것도 고치지 않습니다.
//     "백석 기준으로 싹 덮기" 를 하면 원당에만 있는 값이 날아갑니다.
//     2026-08-17 에 백석에서 그렇게 9개월치를 날린 적이 있습니다.
//     무엇이 다른지 다 본 뒤에 하나씩 판단하는 것이 순서입니다.
//
//  실행: 편집기에서 양식대조() 선택 → 실행 → 로그 확인
// ════════════════════════════════════════════════════════════

var 대조_기준지점 = '백석점';    // 이쪽을 기준으로 본다
var 대조_대상지점 = '원당점';
var 대조_탭목록   = [];          // 비워두면 템플릿 + 1~12월 전부

function 양식대조() {
  var 기준ss = SpreadsheetApp.openById(BRANCH_CONFIG[대조_기준지점].ssId);
  var 대상ss = SpreadsheetApp.openById(BRANCH_CONFIG[대조_대상지점].ssId);

  var tabs = 대조_탭목록.length ? 대조_탭목록 : (function () {
    var t = ['26년 x월 손익계산서'];
    for (var m = 1; m <= 12; m++) t.push('26년 ' + m + '월 손익계산서');
    return t;
  })();

  Logger.log('════════════════════════════════════════');
  Logger.log('기준: ' + 대조_기준지점 + '  /  대상: ' + 대조_대상지점);
  Logger.log('※ 읽기만 합니다. 고치지 않습니다.');
  Logger.log('════════════════════════════════════════');

  var 전체차이 = 0;

  tabs.forEach(function (tabName) {
    var a = 기준ss.getSheetByName(tabName);
    var b = 대상ss.getSheetByName(tabName);

    if (!a && !b) return;                 // 둘 다 없으면 조용히 넘어간다
    if (!a) { Logger.log('\n[' + tabName + '] ⚠️ ' + 대조_기준지점 + '에 없음'); return; }
    if (!b) { Logger.log('\n[' + tabName + '] ⚠️ ' + 대조_대상지점 + '에 없음 — 탭을 만들어야 합니다'); 전체차이++; return; }

    var 기준 = 행정보_(a);
    var 대상 = 행정보_(b);

    var 기준만 = [], 대상만 = [], 수식다름 = [], 구멍 = [];

    Object.keys(기준).forEach(function (label) {
      if (!대상[label]) { 기준만.push(기준[label]); return; }
      var x = 기준[label], y = 대상[label];

      // ① 월 합계(C열) 수식이 다른가
      if (정리_(x.c) !== 정리_(y.c)) {
        수식다름.push({ label: label, 기준행: x.row, 대상행: y.row, 기준: x.c, 대상: y.c });
      }
      // ② 일별(G~AK) 수식이 몇 칸 차 있는가
      //    백석은 차 있는데 원당은 비어 있으면 그 날짜 지출이 조용히 누락된다.
      if (x.일별 >= 25 && y.일별 < x.일별 - 2) {
        구멍.push({ label: label, 대상행: y.row, 기준: x.일별, 대상: y.일별 });
      }
    });
    Object.keys(대상).forEach(function (label) {
      if (!기준[label]) 대상만.push(대상[label]);
    });

    var 차이 = 기준만.length + 대상만.length + 수식다름.length + 구멍.length;
    if (!차이) return;                    // 같으면 안 찍는다. 다른 것만 봐야 한다.
    전체차이 += 차이;

    Logger.log('\n════════ ' + tabName + ' ════════');

    if (기준만.length) {
      Logger.log('\n📋 ' + 대조_기준지점 + '에만 있는 행 (' + 기준만.length + ')');
      기준만.forEach(function (r) { Logger.log('   ' + r.row + '행  ' + r.label); });
    }
    if (대상만.length) {
      Logger.log('\n📋 ' + 대조_대상지점 + '에만 있는 행 (' + 대상만.length + ')');
      대상만.forEach(function (r) { Logger.log('   ' + r.row + '행  ' + r.label); });
    }
    if (수식다름.length) {
      Logger.log('\n📐 월합계(C열) 수식이 다름 (' + 수식다름.length + ')');
      수식다름.forEach(function (d) {
        Logger.log('   [' + d.label + ']  ' + 대조_기준지점 + ' ' + d.기준행 + '행 / ' + 대조_대상지점 + ' ' + d.대상행 + '행');
        Logger.log('      ' + 대조_기준지점 + ': ' + (d.기준 || '(비어 있음)'));
        Logger.log('      ' + 대조_대상지점 + ': ' + (d.대상 || '(비어 있음)'));
      });
    }
    if (구멍.length) {
      Logger.log('\n🕳 일별 수식에 구멍 (' + 구멍.length + ') — 그 날짜 지출이 조용히 누락됩니다');
      구멍.forEach(function (d) {
        Logger.log('   [' + d.label + '] ' + d.대상행 + '행  ' +
                   대조_기준지점 + ' ' + d.기준 + '칸 / ' + 대조_대상지점 + ' ' + d.대상 + '칸');
      });
    }
  });

  Logger.log('\n════════════════════════════════════════');
  if (!전체차이) Logger.log('✅ 다른 곳이 없습니다');
  else Logger.log('총 ' + 전체차이 + '군데가 다릅니다. 하나씩 판단해서 고치세요.');
  Logger.log('════════════════════════════════════════');
}

/** 한 탭에서 B열 라벨 → {row, label, c(월합계 수식), 일별(G~AK 중 찬 칸 수)} */
function 행정보_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  var lastCol = Math.min(sheet.getLastColumn(), 37);   // AK = 37

  var vals = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var fs   = sheet.getRange(1, 1, lastRow, lastCol).getFormulas();

  var out = {};
  for (var r = 0; r < lastRow; r++) {
    var label = String(vals[r][1] || '').replace(/\s/g, '').trim();   // B열, 공백 무시
    if (!label) continue;
    if (out[label]) continue;                                        // 같은 라벨이 또 나오면 첫 것만

    var 일별 = 0;
    for (var c = 6; c < lastCol; c++) {                              // G(7번째) ~ AK
      if (fs[r][c]) 일별++;
    }
    out[label] = { row: r + 1, label: String(vals[r][1]).trim(), c: fs[r][2] || '', 일별: 일별 };
  }
  return out;
}

/** 수식 비교용 정리 — 공백·대소문자만 다른 것은 같은 것으로 본다 */
function 정리_(f) {
  return String(f || '').replace(/\s+/g, '').toUpperCase();
}


// ════════════════════════════════════════════════════════════
// 🔍 유실진단 — [완료]인데 시트에 안 들어간 사진 찾기
//
//   왜 이런 일이 생기나 (2026-08-26 원당에서 대규모로 발견)
//
//     파일 이름은 「올린 시각」으로 만들어집니다. 사진에 찍힌 날짜가 아닙니다.
//         var timestamp = ... "yyyyMMdd_HHmmss"
//         var fileName  = "[웹앱][" + docType + "] " + timestamp + ".jpg";
//
//     초 단위입니다. 사진 여러 장을 한 번에 선택해 올리면
//     몇 초 안에 다 저장돼서 **이름이 똑같아집니다.**
//
//     그다음 processFiles 의 중복 판정이 이렇습니다.
//         if (isAlreadyProcessedById(...) || isAlreadyProcessed(logSheet, name)) {
//           safeRename(file, "[완료] " + name);   // ← 시트엔 한 줄도 안 쓰고 완료 표시
//         }
//
//     isAlreadyProcessed 는 **파일 이름만** 비교합니다.
//     첫 장만 들어가고 나머지는 전부 조용히 사라집니다. 드라이브만 보면 정상입니다.
//
//   ⚠️ 시간 초과와 헷갈리지 마세요
//     시간 초과는 이름을 **안 바꿉니다.** 그대로 남겨두고 다음 날 이어서 합니다.
//     「[완료]인데 데이터가 없다」면 그건 시간 초과가 아니라 이름 겹침입니다.
//
//   이 함수는 아무것도 바꾸지 않습니다. 세기만 합니다.
// ════════════════════════════════════════════════════════════

function 유실진단() {
  Object.keys(BRANCH_CONFIG).forEach(function (branch) {
    Logger.log('\n════════════ [' + branch + '] ════════════');

    // ── ① 시트에 이미 들어간 것 모으기 ──────────────────────
    var ss = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId);
    var sh = ss.getSheetByName('지출및매출로그');
    var 있는ID = {}, 시트행 = 0, ID있는행 = 0;

    if (sh && sh.getLastRow() > 1) {
      var v = sh.getRange(2, 1, sh.getLastRow() - 1, COL_FILE_ID).getValues();
      v.forEach(function (r) {
        시트행++;
        var id = String(r[COL_FILE_ID - 1] || '').trim();
        if (id) { 있는ID[id] = true; ID있는행++; }
      });
    }

    Logger.log('시트 기록 ' + 시트행 + '행 (그중 파일ID가 적힌 것 ' + ID있는행 + '행)');
    if (시트행 > 0 && ID있는행 / 시트행 < 0.5) {
      Logger.log('⚠️ 파일ID가 없는 옛날 기록이 많습니다. 아래 「유실」 숫자가 실제보다 커 보일 수 있습니다.');
    }

    // ── ② 드라이브 훑기 ────────────────────────────────────
    var folder = DriveApp.getFolderById(BRANCH_CONFIG[branch].folderId);
    var files  = folder.getFiles();
    var 그룹 = {};                       // 원래이름 → 통계
    var 총 = 0, 완료 = 0, 대기 = 0, 확인요망 = 0, 유실 = 0;
    var 월별유실 = {};

    while (files.hasNext()) {
      var f    = files.next();
      var name = f.getName().trim();
      var 상태 = '대기', base = name;

      if (name.indexOf('[완료]') === 0) {
        상태 = '완료';
        base = name.slice(4).trim();
      } else if (name.indexOf('[확인요망]') === 0) {
        상태 = '확인요망';
        base = name.slice(6).trim().replace(/^(이미지준비실패|AI분석실패|기록실패|오류)_/, '');
      }

      총++;
      if (상태 === '완료') 완료++; else if (상태 === '확인요망') 확인요망++; else 대기++;

      if (!그룹[base]) 그룹[base] = { 총: 0, 들어감: 0, 유실: 0 };
      그룹[base].총++;

      if (있는ID[f.getId()]) {
        그룹[base].들어감++;
      } else if (상태 === '완료') {
        // 완료 표시가 붙었는데 시트에 흔적이 없다 = 조용히 사라진 것
        그룹[base].유실++;
        유실++;
        var ym = Utilities.formatDate(f.getDateCreated(), TIMEZONE, 'yyyy-MM');
        월별유실[ym] = (월별유실[ym] || 0) + 1;
      }
    }

    // ── ③ 요약 ─────────────────────────────────────────────
    Logger.log('\n드라이브 ' + 총 + '장   완료 ' + 완료 + ' · 대기 ' + 대기 + ' · 확인요망 ' + 확인요망);
    Logger.log('🔴 [완료]인데 시트에 없음 : ' + 유실 + '장');

    if (유실 > 0) {
      Logger.log('\n── 유실 사진을 올린 달 ──  (사진에 찍힌 날짜가 아니라 올린 날짜)');
      Object.keys(월별유실).sort().forEach(function (ym) {
        Logger.log('   ' + ym + '  ' + 월별유실[ym] + '장');
      });
    }

    // ── ④ 이름이 겹친 그룹 ─────────────────────────────────
    var 겹침 = Object.keys(그룹).filter(function (k) { return 그룹[k].총 > 1; })
                    .sort(function (a, b) { return 그룹[b].총 - 그룹[a].총; });

    Logger.log('\n── 이름이 겹친 그룹 ' + 겹침.length + '개 ──');
    겹침.slice(0, 15).forEach(function (k) {
      var g = 그룹[k];
      Logger.log('   ' + g.총 + '장 중 ' + g.들어감 + '건만 들어감  |  ' + k);
    });
    if (겹침.length > 15) Logger.log('   … 그 외 ' + (겹침.length - 15) + '개');
  });

  Logger.log('\n※ 읽기만 했습니다. 아무것도 바꾸지 않았습니다.');
  Logger.log('※ 사진은 드라이브에 그대로 있습니다. 이름표만 잘못 붙었을 뿐입니다.');
}


// ════════════════════════════════════════════════════════════
// 📅 날짜진단 — 며칠치 매출이 비었나
//
//   왜 파일이 아니라 날짜를 세나 (2026-08-31)
//
//     유실진단() 은 「사진 몇 장이 시트에 없나」를 셌습니다.
//     그런데 옛날 기록은 파일ID 칸이 없어서, 이미 들어간 것도
//     「없음」으로 세어졌습니다. 원당 707장이 그래서 부풀려진 숫자였습니다.
//
//     손익계산서에 정말 필요한 건 「사진 몇 장」이 아니라
//     **「그 달 며칠치 매출이 시트에 있나」** 입니다.
//     5월 31일 중 3일치만 있으면 28일이 빈 것이고, 그게 곧 손익 오차입니다.
//
//   ⚠️ 이 숫자를 보고 재처리를 결정하세요
//     빈 날이 없는데 사진만 남아 있다면 그건 이미 들어간 것입니다.
//     그걸 다시 돌리면 매출이 두 번 잡힙니다. 빠진 것보다 나쁩니다.
//
//   이 함수는 아무것도 바꾸지 않습니다. 세기만 합니다.
// ════════════════════════════════════════════════════════════

// 매출로 치는 분류 (마감정산서에서 나옴)
var 매출분류_ = ['현금매출', '카드매출', '배달매출'];

// 지점별 정기 휴무 (0=일 … 6=토). 없으면 연중무휴
var 휴무요일_ = { '백석점': 2, '원당점': null };

function 날짜진단() {
  var 오늘 = new Date();

  Object.keys(BRANCH_CONFIG).forEach(function (branch) {
    Logger.log('\n════════════ [' + branch + '] ════════════');

    var ss = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId);
    var sh = ss.getSheetByName('지출및매출로그');
    if (!sh || sh.getLastRow() < 2) { Logger.log('  기록 없음'); return; }

    // ── 매출이 있는 날 모으기 ──────────────────────────────
    var 있는날 = {};    // '2026-05-03' → 금액합
    var v = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
    v.forEach(function (r) {
      if (매출분류_.indexOf(String(r[1]).trim()) < 0) return;
      var d = toDate_(r[0]);
      if (!d) return;
      var key = Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');
      있는날[key] = (있는날[key] || 0) + (Number(r[3]) || 0);
    });

    var 휴무 = 휴무요일_[branch];
    var 총영업일 = 0, 총있음 = 0;

    Logger.log('월    있음/영업일   매출합계        빠진 날');
    Logger.log('────────────────────────────────────────────────────────────');

    for (var m = 1; m <= 12; m++) {
      var 첫날 = new Date(2026, m - 1, 1);
      if (첫날 > 오늘) break;

      var 마지막 = new Date(2026, m, 0).getDate();
      var 영업일 = 0, 있음 = 0, 합계 = 0, 빈날 = [];

      for (var d = 1; d <= 마지막; d++) {
        var day = new Date(2026, m - 1, d);
        if (day > 오늘) break;                          // 아직 안 온 날
        if (쉬는날_(branch, day)) continue;   // 정기 휴무 + 명절 등 특별휴무
        영업일++;

        var key = Utilities.formatDate(day, TIMEZONE, 'yyyy-MM-dd');
        if (있는날[key]) { 있음++; 합계 += 있는날[key]; }
        else 빈날.push(d);
      }
      if (!영업일) continue;

      총영업일 += 영업일; 총있음 += 있음;

      var 표시 = 빈날.length === 0 ? '없음 ✅'
               : (빈날.length === 영업일 ? '⚠️ 통째로 빔'
               : (빈날.length > 12 ? 빈날.slice(0, 12).join(',') + '… (' + 빈날.length + '일)'
               : 빈날.join(',') + '일'));

      Logger.log(
        ('  ' + m + '월').slice(-4) + '  ' +
        (있음 + '/' + 영업일 + '     ').slice(0, 8) +
        (합계 ? 합계.toLocaleString() + '원' : '0원').padEnd(15, ' ') + ' ' + 표시
      );
    }

    var 비율 = 총영업일 ? Math.round(총있음 / 총영업일 * 100) : 0;
    Logger.log('────────────────────────────────────────────────────────────');
    Logger.log('  합계  ' + 총있음 + '/' + 총영업일 + '일  (' + 비율 + '%)' +
               (휴무 === null ? '  · 연중무휴로 계산' : '  · 화요일 휴무 제외'));
  });

  Logger.log('\n※ 읽기만 했습니다.');
  Logger.log('※ 「빠진 날」이 진짜 구멍입니다. 그 날짜의 사진만 재처리하면 됩니다.');
  Logger.log('※ 빠진 날이 없는데 드라이브에 사진이 남아 있다면 이미 들어간 것입니다. 다시 돌리지 마세요.');
}


// ════════════════════════════════════════════════════════════
// ♻️ 복구준비 — 묻힌 사진에 다시 기회를 준다
//
//   무엇을 하나
//     [완료] 딱지가 붙었는데 시트에 파일ID 흔적이 없는 사진을 골라
//     딱지를 떼고 **겹치지 않는 이름**으로 바꿉니다.
//     그러면 다음 처리 때 AI 가 다시 읽습니다.
//
//   ⚠️ 왜 이름을 바꾸나
//     그냥 [완료] 만 떼면 이름이 여전히 다 같습니다.
//     예전과 똑같이 첫 장만 들어가고 나머지는 또 묻힙니다.
//     그래서 뒤에 실행시각+번호를 붙여 전부 다른 이름으로 만듭니다.
//
//   ⚠️ 두 번 들어갈 걱정은 안 하셔도 됩니다
//     recordDataSafely 가 **날짜·분류·금액**으로 이미 있는 것을 걸러냅니다.
//     이미 들어간 내용이면 [중복확인] 딱지만 붙고 시트는 안 건드립니다.
//
//   ⚠️ 한 번에 다 하지 마세요
//     Apps Script 는 6분에서 끊깁니다. 한 장에 8초쯤 걸리니 40장이 한계입니다.
//     조금씩 풀어서 매일 새벽 처리에 태우는 것이 안전합니다.
// ════════════════════════════════════════════════════════════

function 원당복구_미리보기() { 복구준비_('원당점', 40, true);  }
function 원당복구_40장()    { 복구준비_('원당점', 40, false); }
function 백석복구_미리보기() { 복구준비_('백석점', 40, true);  }
function 백석복구_40장()    { 복구준비_('백석점', 40, false); }


/**
 * 복구 전용 자동 실행 — 임시 트리거를 걸어두는 용도
 *
 *   왜 dailyProcess 를 안 쓰나
 *     dailyProcess 는 고기값 동기화 · 알바 백업 · 건강검진까지 같이 합니다.
 *     그걸 매시간 돌리면 쓸데없는 일을 스물네 번 하게 됩니다.
 *     이 함수는 **묻힌 사진 풀기 + 처리** 딱 두 가지만 합니다.
 *
 *   쓰는 법
 *     ① Apps Script 왼쪽 「트리거(시계 아이콘)」 → 트리거 추가
 *          함수      복구자동
 *          이벤트     시간 기반 → 시간 타이머 → 1시간마다
 *     ② 며칠 두고 날짜진단() 으로 확인
 *     ③ 「더 풀 것이 없습니다」가 나오면 **트리거를 지우세요**
 *
 *   ⚠️ 트리거를 안 지우면 매시간 헛돕니다. 다 끝나면 꼭 지우세요.
 *   ⚠️ 구글 계정은 하루 실행시간이 90분으로 묶여 있습니다.
 *      627장이면 84분쯤 걸리니 이틀은 잡으셔야 합니다.
 */
function 복구자동() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { Logger.log('다른 처리가 도는 중 — 건너뜁니다'); return; }
  try {
    복구준비_('원당점', 40, false);   // 묻힌 것 40장 풀기
    processFiles('원당점');           // 시간 되는 데까지 처리
  } catch (e) {
    Logger.log('FATAL: ' + e.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 기준일비교 — 왜 원당은 되고 백석은 안 되나
 *
 *   증상 (2026-09-02)
 *     백석 9월 시트에서 A51 = EOMONTH(B7, 0) 이 **8월 31일**을 돌려줬습니다.
 *     B7 은 분명 9월 1일인데도 그렇습니다. 9월 30일이 나와야 정상입니다.
 *     원당은 같은 수식인데 멀쩡합니다.
 *
 *   짚이는 것
 *     ① 두 스프레드시트의 **시간대 설정이 다르다**
 *        파일마다 따로 설정됩니다. 백석만 한국이 아닐 수 있습니다.
 *        시간대가 밀리면 9/1 00:00 이 그 시트에서는 8/31 저녁이 됩니다.
 *     ② B7 이 수식이 아니라 **값**으로 들어가 있다
 *        값으로 넣으면 시간대 차이를 그대로 맞습니다.
 *        그래서 setupBaseDate_ 는 =DATE() 수식으로 넣게 돼 있는데,
 *        나중에 누가 값으로 덮었을 수 있습니다.
 *     ③ 두 지점 양식이 다르다
 *        백석은 A50~A52, 원당은 A56~A58 을 씁니다.
 *
 *   이 함수는 아무것도 바꾸지 않습니다.
 */
function 기준일비교() {
  var now = new Date();
  var 시트명 = String(now.getFullYear()).slice(2) + '년 ' + (now.getMonth() + 1) + '월 손익계산서';

  ['백석점', '원당점'].forEach(function (branch) {
    var config = BRANCH_CONFIG[branch];
    if (!config) return;
    var ss = SpreadsheetApp.openById(config.ssId);

    Logger.log('\n════════════ [' + branch + '] ' + 시트명 + ' ════════════');

    // ① 스프레드시트 시간대 — 파일마다 따로 설정된다
    //    ⚠️ 값이 비어 있는(빈 문자열) 스프레드시트가 실제로 있습니다.
    //       그대로 Utilities.formatDate 에 넘기면 죽습니다. 2026-09-02 겪음.
    var tz생값 = null;
    try { tz생값 = ss.getSpreadsheetTimeZone(); } catch (e) {}
    var tz유효 = (typeof tz생값 === 'string' && tz생값.length > 0);
    var tz = tz유효 ? tz생값 : TIMEZONE;   // 표시용으로만 대체값을 쓴다

    Logger.log('  시트 시간대   ' +
      (!tz유효 ? '⚠️ 비어 있음 — 이것이 원인입니다'
               : tz생값 + (tz생값 === 'Asia/Seoul' ? '  ✅' : '  ⚠️ 서울이 아닙니다')));
    Logger.log('  스크립트 시간대 ' + TIMEZONE);

    var sh = ss.getSheetByName(시트명);
    if (!sh) { Logger.log('  ⚠️ 시트 없음'); return; }

    // ② B7 이 수식인가 값인가
    var b7 = sh.getRange('B7');
    var m = b7.getMergedRanges();
    if (m.length) b7 = m[0].getCell(1, 1);
    var f7 = b7.getFormula();
    var v7 = b7.getValue();
    Logger.log('  B7  ' + (f7 ? '수식 ' + f7 : '⚠️ 수식 없음 — 값으로 들어가 있음') +
               '   →  ' + (v7 instanceof Date ? Utilities.formatDate(v7, tz, 'yyyy-MM-dd HH:mm') : JSON.stringify(v7)));

    // ③ A45~A60 중 뭔가 든 칸 전부 (지점마다 쓰는 칸이 다르다)
    Logger.log('  ── A45~A60 중 내용이 있는 칸 ──');
    var vals = sh.getRange(45, 1, 16, 1).getValues();
    var fs   = sh.getRange(45, 1, 16, 1).getFormulas();
    for (var i = 0; i < 16; i++) {
      var v = vals[i][0], f = fs[i][0];
      if (v === '' && !f) continue;
      var 보임 = (v instanceof Date) ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : JSON.stringify(v);
      Logger.log('    A' + (45 + i) + '  ' + 보임 + (f ? '   ← ' + f : ''));
    }

    // ④ 시트가 직접 계산하게 해서 진짜 답을 본다
    var 임시 = sh.getRange(1, 40);   // AN1 — 비어 있는 칸
    try {
      임시.setFormula('=TEXT(EOMONTH(B7,0),"yyyy-MM-dd")&" / "&TEXT(B7,"yyyy-MM-dd")&" / "&TEXT(TODAY(),"yyyy-MM-dd")');
      SpreadsheetApp.flush();
      Logger.log('  ── 시트가 직접 계산한 값 ──');
      Logger.log('    EOMONTH(B7,0) / B7 / TODAY  =  ' + 임시.getValue());
    } catch (e) {
      Logger.log('    계산 실패: ' + e.message);
    } finally {
      임시.clearContent();
      SpreadsheetApp.flush();
    }
  });

  Logger.log('\n※ 읽기만 했습니다 (임시 계산 칸은 지웠습니다).');
  Logger.log('※ 시간대가 두 시트에서 다르면 그것이 원인입니다.');
  Logger.log('※ B7 에 「수식 없음」이 뜨면 값으로 덮인 것이라 그것도 원인이 됩니다.');
}

/** 복구가 끝났는지 한눈에 — 트리거를 언제 지울지 판단용 */
function 복구남은것() {
  ['원당점', '백석점'].forEach(function (branch) {
    var config = BRANCH_CONFIG[branch];
    var sh = SpreadsheetApp.openById(config.ssId).getSheetByName('지출및매출로그');
    var 있는ID = {};
    if (sh && sh.getLastRow() > 1) {
      sh.getRange(2, COL_FILE_ID, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
        var id = String(r[0] || '').trim(); if (id) 있는ID[id] = true;
      });
    }
    var files = DriveApp.getFolderById(config.folderId).getFiles();
    var 풀것 = 0, 대기 = 0, 중복확인 = 0, 확인요망 = 0;
    while (files.hasNext()) {
      var f = files.next(), n = f.getName().trim();
      if (n.indexOf('[완료]') === 0) { if (!있는ID[f.getId()]) 풀것++; }
      else if (n.indexOf('[중복확인]') === 0) 중복확인++;
      else if (n.indexOf('[확인요망]') === 0) 확인요망++;
      else 대기++;
    }
    Logger.log('[' + branch + ']  더 풀 것 ' + 풀것 + '장 · 처리 대기 ' + 대기 +
               '장 · 중복확인 ' + 중복확인 + '장 · 확인요망 ' + 확인요망 + '장');
    if (풀것 === 0 && 대기 === 0) Logger.log('   ✅ 끝났습니다. 트리거를 지우셔도 됩니다.');
  });
  Logger.log('\n※ 「중복확인」은 이미 시트에 있던 내용입니다. 정상입니다.');
  Logger.log('※ 「확인요망」은 AI 가 날짜·금액을 못 읽은 것입니다. 손으로 보셔야 합니다.');
}

function 복구준비_(branchName, 개수, dryRun) {
  var config = BRANCH_CONFIG[branchName];
  if (!config) { Logger.log('알 수 없는 지점: ' + branchName); return; }

  Logger.log(dryRun ? '=== 복구 준비 (미리보기 · 이름 안 바꿈) ===' : '=== 복구 준비 (실제 적용) ===');
  Logger.log('[' + branchName + '] 최대 ' + 개수 + '장\n');

  // 시트에 이미 파일ID 가 박힌 것 모으기
  var ss = SpreadsheetApp.openById(config.ssId);
  var sh = ss.getSheetByName('지출및매출로그');
  var 있는ID = {};
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, COL_FILE_ID, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
      var id = String(r[0] || '').trim();
      if (id) 있는ID[id] = true;
    });
  }

  var 도장 = Utilities.formatDate(new Date(), TIMEZONE, 'MMddHHmm');
  var files = DriveApp.getFolderById(config.folderId).getFiles();
  var 대상 = 0, 이미확인 = 0, 남은것 = 0;

  while (files.hasNext()) {
    var f = files.next();
    var name = f.getName().trim();

    if (name.indexOf('[완료]') !== 0) continue;          // [완료] 인 것만
    if (있는ID[f.getId()]) { 이미확인++; continue; }      // 시트에 흔적이 있다 → 그대로 둔다

    if (대상 >= 개수) { 남은것++; continue; }
    대상++;

    var base = name.slice(4).trim();
    var 새이름 = base.replace(/\.(jpg|jpeg|png|heic)$/i, '') +
                 '_재' + 도장 + '_' + ('00' + 대상).slice(-3) +
                 (base.match(/\.(jpg|jpeg|png|heic)$/i) || ['.jpg'])[0];

    if (대상 <= 5) Logger.log('  ' + name + '\n    → ' + 새이름);
    if (!dryRun) safeRename(f, 새이름);
  }

  if (대상 > 5) Logger.log('  … 그 외 ' + (대상 - 5) + '장');

  Logger.log('\n──────────────────────────────────────────');
  Logger.log('  이번에 푼 것        ' + 대상 + '장');
  Logger.log('  시트에 흔적 있어 그대로 둔 것  ' + 이미확인 + '장');
  Logger.log('  아직 안 푼 것       ' + 남은것 + '장');

  if (dryRun) {
    Logger.log('\n※ 미리보기입니다. 아무것도 안 바꿨습니다.');
    Logger.log('※ 실제로 하려면 ' + branchName.replace('점', '') + '복구_40장() 을 실행하세요.');
  } else {
    Logger.log('\n✅ ' + 대상 + '장을 풀었습니다.');
    Logger.log('   이제 dailyProcess 가 돌 때 다시 읽습니다 (매일 새벽 자동).');
    Logger.log('   지금 바로 하려면 test원당점() · test백석점() 을 실행하세요.');
    if (남은것 > 0) Logger.log('   ' + 남은것 + '장이 남았습니다. 내일 또 이 함수를 돌리세요.');
  }
  Logger.log('\n⚠️ 재처리해도 이미 시트에 있는 내용은 [중복확인] 딱지만 붙고 안 들어갑니다.');
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  🔍 확인요망진단() — 막혀 있는 사진 172장의 정체를 밝힌다
//
//  2026-09-06 추가.
//
//  왜 만들었나
//    복구남은것() 은 「확인요망 172장」 이라고만 알려준다.
//    172장이 왜 막혔는지를 모르면 무엇을 해야 할지 정할 수 없다.
//    사유마다 손쓰는 방법이 완전히 다르다.
//
//        AI분석실패      → retryFailedFiles() 한 번이면 대부분 살아난다
//        이미지준비실패   → 파일이 깨진 것. 사진을 다시 받아야 한다
//        기록실패        → 읽긴 읽었다. 시트 쪽 문제라 코드를 봐야 한다
//        오류            → 그 밖의 사고. 하나씩 봐야 한다
//
//  ⚠️ 읽기만 합니다. 파일 이름도 시트도 건드리지 않습니다.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function 확인요망진단() {
  ['원당점', '백석점'].forEach(function (branch) {

    Logger.log('\n\n ════════════ [' + branch + '] ════════════');

    var folder = DriveApp.getFolderById(BRANCH_CONFIG[branch].folderId);
    var files  = folder.getFiles();

    var 사유별  = {};      // 사유 → 장수
    var 샘플    = {};      // 사유 → 파일이름 몇 개
    var 월별    = {};      // 사유 → { 'yyyy-MM': 장수 }
    var 전체월별 = {};      // 'yyyy-MM' → 장수 (사유 안 가림)
    var 총확인요망 = 0;

    while (files.hasNext()) {
      var f    = files.next();
      var name = f.getName().trim();
      if (name.indexOf('[확인요망]') !== 0) continue;

      총확인요망++;

      // 「[확인요망] AI분석실패_원본이름.jpg」 에서 사유만 떼어낸다
      var 남은이름 = name.slice(6).trim();
      var m = 남은이름.match(/^(이미지준비실패|AI분석실패|기록실패|오류)_/);
      var 사유 = m ? m[1] : '사유표시없음';

      사유별[사유] = (사유별[사유] || 0) + 1;

      if (!샘플[사유]) 샘플[사유] = [];
      if (샘플[사유].length < 3) 샘플[사유].push(남은이름.replace(/^[^_]+_/, ''));

      // 올린 달 (사진에 찍힌 날짜가 아니라 드라이브에 들어온 날짜)
      var ym = Utilities.formatDate(f.getDateCreated(), TIMEZONE, 'yyyy-MM');
      if (!월별[사유]) 월별[사유] = {};
      월별[사유][ym] = (월별[사유][ym] || 0) + 1;
      전체월별[ym]   = (전체월별[ym] || 0) + 1;
    }

    if (총확인요망 === 0) {
      Logger.log('  ✅ 막힌 사진이 하나도 없습니다.');
      return;
    }

    // ── ① 사유별 ────────────────────────────────────────────
    Logger.log('\n  막힌 사진 ' + 총확인요망 + '장\n');
    Logger.log('  사유              장수     손쓰는 법');
    Logger.log('  ──────────────────────────────────────────────────────────');

    var 처방 = {
      'AI분석실패'    : 'retryFailedFiles() 로 한 번에 되살릴 수 있음 ✅',
      '이미지준비실패' : '파일이 깨짐 — 사진을 다시 받아야 함',
      '기록실패'      : 'AI 는 읽었음 — 시트 쪽 문제. 코드를 봐야 함',
      '오류'          : '그 밖의 사고 — 아래 샘플로 원인을 봐야 함',
      '사유표시없음'   : '옛날 방식으로 붙은 딱지 — 하나씩 봐야 함'
    };

    Object.keys(사유별).sort(function (a, b) { return 사유별[b] - 사유별[a]; })
      .forEach(function (사유) {
        var 이름칸 = (사유 + '                ').slice(0, 16);
        var 수칸   = ('     ' + 사유별[사유]).slice(-5);
        Logger.log('  ' + 이름칸 + 수칸 + '장   ' + (처방[사유] || ''));
      });

    // ── ② 언제 올린 것들인가 ─────────────────────────────────
    Logger.log('\n  ── 언제 올린 사진인가 ──  (찍은 날이 아니라 드라이브에 들어온 날)');
    Object.keys(전체월별).sort().forEach(function (ym) {
      Logger.log('     ' + ym + '   ' + 전체월별[ym] + '장');
    });

    // ── ③ 사유별 샘플 이름 ──────────────────────────────────
    Logger.log('\n  ── 어떤 파일들인가 (사유마다 3장씩) ──');
    Object.keys(샘플).forEach(function (사유) {
      Logger.log('     [' + 사유 + ']');
      샘플[사유].forEach(function (n) { Logger.log('        ' + n); });
    });

    // ── ④ 판단 도우미 ───────────────────────────────────────
    var ai = 사유별['AI분석실패'] || 0;
    Logger.log('\n  ── 다음에 할 일 ──');
    if (ai > 0) {
      Logger.log('     ① retryFailedFiles() 를 돌리면 ' + ai + '장이 다시 대기로 돌아갑니다.');
      Logger.log('        그다음 dailyProcess 가 돌 때(또는 test' + branch + '()) 다시 읽습니다.');
      Logger.log('        ⚠️ 이미 시트에 있는 내용은 [중복확인] 딱지만 붙고 안 들어갑니다. 안전합니다.');
    }
    if (총확인요망 - ai > 0) {
      Logger.log('     ② 나머지 ' + (총확인요망 - ai) + '장은 자동으로 안 됩니다. 위 사유를 보고 정해야 합니다.');
    }
  });

  Logger.log('\n\n ※ 읽기만 했습니다. 파일 이름도 시트도 안 건드렸습니다.');
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  🕳️ 구멍날진단() — 매출이 빈 날, 그날 사진은 드라이브에 있나
//
//  2026-09-06 추가.
//
//  왜 만들었나
//    원당 6월·8월에 열흘씩 매출이 비었다. 대략 8천만원어치다.
//    확인요망진단() 을 돌려보니 그 달에 막힌 사진은 열 장도 안 됐다.
//    즉 「사진이 막혀서」가 아니다. 그러면 뭔가.
//
//    다행히 파일 이름에 찍은 날짜가 들어 있다.
//        [웹앱][마감정산서] 20260601_215941_....jpg
//                          └── 6월 1일
//    이걸로 「그날 사진이 있기는 한가」를 셀 수 있다.
//
//  답은 넷 중 하나로 갈린다
//    사진없음      안 올리셨거나 다른 폴더로 갔다 → 종이에서 다시 구해야 함
//    [완료]       처리했다는데 시트엔 없다 → 조용히 사라진 것. 딱지 떼면 살아남
//    [중복확인]    이미 들어갔다고 판정했는데 시트엔 없다 → 판정 버그
//    대기·확인요망  아직 처리 안 됨 → dailyProcess 가 읽으면 들어감
//
//  ⚠️ 읽기만 합니다. 파일 이름도 시트도 안 건드립니다.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function 구멍날진단() {
  var 오늘 = new Date();

  Object.keys(BRANCH_CONFIG).forEach(function (branch) {
    Logger.log('\n\n ════════════ [' + branch + '] ════════════');

    // ── ① 매출이 있는 날 (날짜진단과 같은 방식) ──────────────
    var ss = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId);
    var sh = ss.getSheetByName('지출및매출로그');
    if (!sh || sh.getLastRow() < 2) { Logger.log('  기록 없음'); return; }

    var 있는날 = {};
    var v = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
    v.forEach(function (r) {
      if (매출분류_.indexOf(String(r[1]).trim()) < 0) return;
      var d = toDate_(r[0]);
      if (!d) return;
      있는날[Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd')] = true;
    });

    // ── ② 드라이브 사진을 「찍은 날」로 묶기 ──────────────────
    //     파일 이름 안의 20260601 같은 여덟 자리를 찾는다.
    var 날짜별 = {};        // 'yyyy-MM-dd' → { 완료:0, 중복확인:0, 확인요망:0, 대기:0, 마감정산서:0 }
    var 날짜없음 = 0, 사진총 = 0;

    var folder = DriveApp.getFolderById(BRANCH_CONFIG[branch].folderId);
    var files  = folder.getFiles();

    while (files.hasNext()) {
      var f    = files.next();
      var name = f.getName().trim();
      사진총++;

      var m = name.match(/(20\d{2})(\d{2})(\d{2})[_\-\.]/);
      if (!m) { 날짜없음++; continue; }
      var key = m[1] + '-' + m[2] + '-' + m[3];

      if (!날짜별[key]) 날짜별[key] = { 완료:0, 중복확인:0, 확인요망:0, 대기:0, 마감정산서:0 };
      var g = 날짜별[key];

      if      (name.indexOf('[완료]')     === 0) g.완료++;
      else if (name.indexOf('[중복확인]')  === 0) g.중복확인++;
      else if (name.indexOf('[확인요망]')  === 0) g.확인요망++;
      else                                        g.대기++;

      if (name.indexOf('마감정산서') >= 0) g.마감정산서++;
    }

    Logger.log('  드라이브 사진 ' + 사진총 + '장 (이름에서 날짜를 못 읽은 것 ' + 날짜없음 + '장)');

    // ── ③ 구멍 난 날마다 사진이 있나 ────────────────────────
    var 휴무 = 휴무요일_[branch];
    var 요약 = { 사진없음:0, 완료:0, 중복확인:0, 미처리:0 };
    var 구멍수 = 0;

    Logger.log('\n  빈 날짜    그날 사진      판단');
    Logger.log('  ─────────────────────────────────────────────────────────────');

    for (var mo = 1; mo <= 12; mo++) {
      var 첫날 = new Date(2026, mo - 1, 1);
      if (첫날 > 오늘) break;
      var 마지막 = new Date(2026, mo, 0).getDate();
      var 월출력함 = false;

      for (var d = 1; d <= 마지막; d++) {
        var day = new Date(2026, mo - 1, d);
        if (day > 오늘) break;
        if (쉬는날_(branch, day)) continue;

        var key = Utilities.formatDate(day, TIMEZONE, 'yyyy-MM-dd');
        if (있는날[key]) continue;          // 매출 있음 → 구멍 아님

        구멍수++;
        var g = 날짜별[key];

        var 사진설명, 판단;
        if (!g) {
          사진설명 = '없음';
          판단 = '❌ 사진이 아예 없음 — 종이에서 다시 구해야 함';
          요약.사진없음++;
        } else {
          var parts = [];
          if (g.완료)     parts.push('완료 ' + g.완료);
          if (g.중복확인)  parts.push('중복확인 ' + g.중복확인);
          if (g.확인요망)  parts.push('확인요망 ' + g.확인요망);
          if (g.대기)     parts.push('대기 ' + g.대기);
          사진설명 = parts.join(' · ');

          if (g.마감정산서 === 0) {
            판단 = '⚠️ 사진은 있는데 마감정산서가 없음 (지출 영수증뿐)';
            요약.사진없음++;
          } else if (g.완료 > 0) {
            판단 = '🔴 [완료]인데 시트에 없음 — 조용히 사라진 것. 되살릴 수 있음';
            요약.완료++;
          } else if (g.중복확인 > 0) {
            판단 = '🟠 [중복확인]인데 시트에 없음 — 판정 버그. 되살릴 수 있음';
            요약.중복확인++;
          } else {
            판단 = '🟡 아직 처리 안 됨 — dailyProcess 가 읽으면 들어감';
            요약.미처리++;
          }
        }

        if (!월출력함) { Logger.log('  ── ' + mo + '월 ──'); 월출력함 = true; }
        Logger.log('  ' + key.slice(5) + '     ' +
                   (사진설명 + '                    ').slice(0, 22) + 판단);
      }
    }

    // ── ④ 요약 ──────────────────────────────────────────────
    Logger.log('\n  ──────────────────────────────────────────────');
    Logger.log('  매출이 빈 날 ' + 구멍수 + '일');
    Logger.log('    ❌ 사진 자체가 없음            ' + 요약.사진없음 + '일   되찾을 수 없음');
    Logger.log('    🔴 [완료]인데 시트에 없음      ' + 요약.완료 + '일   되살릴 수 있음');
    Logger.log('    🟠 [중복확인]인데 시트에 없음   ' + 요약.중복확인 + '일   되살릴 수 있음');
    Logger.log('    🟡 아직 처리 안 됨            ' + 요약.미처리 + '일   그냥 두면 들어감');

    var 살릴수있는날 = 요약.완료 + 요약.중복확인 + 요약.미처리;
    if (살릴수있는날 > 0) {
      Logger.log('\n  → ' + 살릴수있는날 + '일치를 되찾을 수 있습니다.');
    }
    if (요약.사진없음 > 0) {
      Logger.log('  → ' + 요약.사진없음 + '일치는 사진이 없습니다. 종이 영수증이나 포스에서 찾아야 합니다.');
    }
  });

  Logger.log('\n\n ⚠️ 원당 4월은 한 달치가 4/30 하루에 몰려 들어간 것입니다.');
  Logger.log('    위에서 4월 날짜가 잔뜩 나와도 재처리하지 마세요. 매출이 두 배가 됩니다.');
  Logger.log(' ※ 읽기만 했습니다. 파일 이름도 시트도 안 건드렸습니다.');
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  📛 이름형식진단() — 파일 이름이 몇 가지 모양으로 되어 있나
//
//  2026-09-06 추가.
//
//  왜 만들었나
//    구멍날진단() 이 원당 894장 중 472장의 날짜를 못 읽었다.
//    절반이 넘는다. 그래서 「사진이 아예 없음 52일」이라는 결론을
//    믿을 수 없다. 그 사진들이 못 읽은 472장 안에 있을지 모른다.
//
//    이름이 어떤 모양인지 알아야 정규식을 고칠 수 있다.
//
//  ⚠️ 읽기만 합니다.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function 이름형식진단() {
  Object.keys(BRANCH_CONFIG).forEach(function (branch) {
    Logger.log('\n\n ════════════ [' + branch + '] ════════════');

    var folder = DriveApp.getFolderById(BRANCH_CONFIG[branch].folderId);
    var files  = folder.getFiles();

    var 못읽음 = [], 읽음 = 0, 총 = 0;
    var 여덟자리있음 = 0;      // 20260601 은 있는데 뒤에 _ 가 없는 경우
    var 숫자아예없음 = 0;

    while (files.hasNext()) {
      var name = files.next().getName().trim();
      총++;

      if (name.match(/(20\d{2})(\d{2})(\d{2})[_\-\.]/)) { 읽음++; continue; }

      if (name.match(/20\d{6}/))      여덟자리있음++;
      else if (!name.match(/\d{4}/))  숫자아예없음++;

      if (못읽음.length < 25) 못읽음.push(name);
    }

    Logger.log('  전체 ' + 총 + '장 · 날짜 읽음 ' + 읽음 + '장 · 못 읽음 ' + (총 - 읽음) + '장');
    Logger.log('    그중 20260601 같은 여덟 자리는 들어 있는 것  ' + 여덟자리있음 + '장  ← 정규식만 고치면 됨');
    Logger.log('    숫자다운 게 아예 없는 것                    ' + 숫자아예없음 + '장');

    Logger.log('\n  ── 못 읽은 이름 (앞에서 25장) ──');
    못읽음.forEach(function (n) { Logger.log('     ' + n); });
  });

  Logger.log('\n\n ※ 읽기만 했습니다.');
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  💰 매출복원 — 포스 달력 숫자로 빈 날을 메운다  (원당점 전용)
//
//  2026-09-06 추가. 사장님이 포스 앱 달력 화면을 캡처해 주셔서 만들었습니다.
//
//  ── 왜 사진 재처리가 아니라 이 방법인가 ────────────────────
//    빈 날이 52일이다. 사진을 다시 읽히면 AI가 또 실패하고,
//    중복 판정을 또 거치고, 이번 사달이 난 경로를 한 번 더 밟는다.
//    매출의 원본은 포스다. 사진은 그걸 옮겨 적은 것일 뿐이다.
//    원본이 있는데 사본을 다시 읽힐 이유가 없다.
//
//  ── 숫자의 출처 ──────────────────────────────────────────
//    포스 앱 → 포스 → 포스 결제수단 → 달력 보기 (⊞ 버튼)
//    달력에 날짜마다 세 줄이 뜬다:  파랑=카드 · 하늘=현금 · 회색=기타
//    사장님 지시: 「기타는 카드매출에 포함해서 보면 됨」
//
//  ── 만원 단위 반올림 ──────────────────────────────────────
//    달력은 「320만」처럼 만원 단위로만 보인다. 정확한 원 단위는
//    날짜를 눌러야 나오는데 52일을 다 누를 수는 없다.
//    검산해보니 6월·7월이 오차 20만원 안쪽이었다. 충분하다.
//
//  ⚠️ 4월은 여기 없습니다. 4월은 한 달치가 4/30 하루에 뭉쳐 있어서
//     기존 줄을 걷어내는 작업이 먼저입니다. 사월정리_ 함수를 따로 씁니다.
//  ⚠️ 2월 16·17일은 캡처를 아직 못 받아 빠져 있습니다.
//  ⚠️ 배달매출은 포스에 안 잡힙니다. 여기 숫자에는 배달이 없습니다.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 날짜 → [카드, 현금, 기타]   단위: 원
var 포스달력_원당_ = {
  // ── 5월 (빠진 날 6일) ──
  '2026-05-01': [3200000,  250000,  60000],
  '2026-05-02': [3390000,  110000,  50000],
  '2026-05-03': [2820000,  110000,      0],
  '2026-05-06': [1820000,  330000,      0],
  '2026-05-07': [2340000,   50000,      0],
  '2026-05-16': [3980000,  210000,  50000],

  // ── 6월 (빠진 날 10일) ──
  '2026-06-01': [2120000,    2000,      0],   // 현금이 2,000원. 만원 단위가 아님
  '2026-06-02': [2980000,       0,      0],
  '2026-06-03': [2150000,       0,      0],
  '2026-06-04': [1430000,   80000,      0],
  '2026-06-05': [2190000,       0,      0],
  '2026-06-06': [3700000,  100000,      0],
  '2026-06-07': [3040000,  230000,      0],
  '2026-06-08': [1160000,  210000,      0],
  '2026-06-13': [3290000,  240000,  50000],
  '2026-06-14': [1790000,       0,      0],

  // ── 7월 (빠진 날 4일) ──
  '2026-07-01': [1350000,       0,      0],
  '2026-07-02': [2190000,  150000,      0],
  // 2026-07-20 은 포스에 매출이 0원입니다. 넣지 않습니다.
  //   ⚠️ 그런데 드라이브에는 그날 사진이 11장 [완료]로 있습니다.
  //      휴무였는지, 포스 마감을 안 했는지 확인이 필요합니다.
  '2026-07-23': [1440000,       0,      0],

  // ── 8월 (빠진 날 10일) ──
  '2026-08-03': [2150000,       0,      0],
  '2026-08-15': [3710000,       0,      0],
  '2026-08-16': [4270000,    5000, 260000],   // 현금이 5,000원
  '2026-08-25': [1960000,       0,      0],
  '2026-08-26': [1350000,       0,      0],
  '2026-08-27': [1020000,   60000,      0],
  '2026-08-28': [2740000,  240000, 320000],
  '2026-08-29': [3420000,   80000, 420000],
  '2026-08-30': [2180000,  260000,      0],
  '2026-08-31': [1830000,  200000, 100000]
};

var 복원표식_ = '[포스복원]';


// ── 미리보기 ─────────────────────────────────────────────────
function 매출복원_미리보기() { 매출복원_(true); }

// ── 실제 기입 ────────────────────────────────────────────────
function 매출복원_적용()     { 매출복원_(false); }


function 매출복원_(dryRun) {
  var branch = '원당점';
  var ss = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId);
  var sh = ss.getSheetByName('지출및매출로그');
  if (!sh) { Logger.log('❌ 지출및매출로그 시트가 없습니다'); return; }

  // ── 이미 들어가 있는 날짜+분류 모으기 (이중 계상 방지) ──
  var 있음 = {};
  if (sh.getLastRow() > 1) {
    var v = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
    v.forEach(function (r) {
      var cat = String(r[1]).trim();
      if (매출분류_.indexOf(cat) < 0) return;
      var d = toDate_(r[0]);
      if (!d) return;
      있음[Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd') + '|' + cat] = (Number(r[3]) || 0);
    });
  }

  var 넣을줄 = [], 건너뛴것 = [];
  var 합계 = 0;
  var 월별 = {};

  Object.keys(포스달력_원당_).sort().forEach(function (ymd) {
    var a = 포스달력_원당_[ymd];
    var 카드 = a[0] + a[2];      // 기타는 카드에 합칩니다 (사장님 지시)
    var 현금 = a[1];

    [['카드매출', 카드], ['현금매출', 현금]].forEach(function (pair) {
      var cat = pair[0], amt = pair[1];
      if (amt <= 0) return;

      var key = ymd + '|' + cat;
      if (있음[key] !== undefined) {
        건너뛴것.push(ymd + ' ' + cat + '  이미 ' + 있음[key].toLocaleString() + '원 있음');
        return;
      }

      넣을줄.push([ymd, cat, 복원표식_ + ' 포스 달력', amt, branch, 복원표식_,
                   Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss'), '']);
      합계 += amt;
      var ym = ymd.slice(0, 7);
      월별[ym] = (월별[ym] || 0) + amt;
    });
  });

  // ── 보여주기 ────────────────────────────────────────────
  Logger.log('\n ════════ 포스 달력으로 빈 날 메우기 [' + branch + '] ════════\n');

  Object.keys(월별).sort().forEach(function (ym) {
    Logger.log('  ' + ym + '   ' + 월별[ym].toLocaleString() + '원');
  });
  Logger.log('  ──────────────────────────────');
  Logger.log('  합계      ' + 합계.toLocaleString() + '원   (' + 넣을줄.length + '줄)');

  if (건너뛴것.length) {
    Logger.log('\n  ── 이미 있어서 건너뛴 것 ' + 건너뛴것.length + '건 ──');
    건너뛴것.slice(0, 20).forEach(function (s) { Logger.log('     ' + s); });
    if (건너뛴것.length > 20) Logger.log('     … 그 외 ' + (건너뛴것.length - 20) + '건');
  }

  Logger.log('\n  ── 넣을 줄 (앞에서 12줄) ──');
  넣을줄.slice(0, 12).forEach(function (r) {
    Logger.log('     ' + r[0] + '  ' + r[1] + '  ' + Number(r[3]).toLocaleString() + '원');
  });
  if (넣을줄.length > 12) Logger.log('     … 그 외 ' + (넣을줄.length - 12) + '줄');

  if (dryRun) {
    Logger.log('\n  ※ 미리보기입니다. 아무것도 안 넣었습니다.');
    Logger.log('  ※ 실제로 넣으려면 매출복원_적용() 을 실행하세요.');
    return;
  }

  if (!넣을줄.length) { Logger.log('\n  넣을 것이 없습니다. 이미 다 들어가 있습니다.'); return; }

  // ── 실제 기입 ───────────────────────────────────────────
  sh.getRange(sh.getLastRow() + 1, 1, 넣을줄.length, SHEET_HEADERS.length).setValues(넣을줄);

  Logger.log('\n  ✅ ' + 넣을줄.length + '줄 · ' + 합계.toLocaleString() + '원을 넣었습니다.');
  Logger.log('  항목명에 「' + 복원표식_ + '」 이 붙어 있어 나중에 찾아 지울 수 있습니다.');
  Logger.log('\n  다음: 날짜진단() 을 돌려 구멍이 메워졌는지 보세요.');
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ↩️ 매출복원_되돌리기() — [포스복원] 딱지가 붙은 줄을 전부 지운다
//
//  잘못 넣었을 때 쓰는 안전장치입니다. 다른 줄은 절대 안 건드립니다.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function 매출복원_되돌리기() {
  var branch = '원당점';
  var sh = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId).getSheetByName('지출및매출로그');
  if (!sh || sh.getLastRow() < 2) { Logger.log('기록 없음'); return; }

  var v = sh.getRange(2, 1, sh.getLastRow() - 1, SHEET_HEADERS.length).getValues();
  var 지울행 = [], 합 = 0;

  for (var i = 0; i < v.length; i++) {
    if (String(v[i][5]).indexOf(복원표식_) === 0) {
      지울행.push(i + 2);
      합 += Number(v[i][3]) || 0;
    }
  }

  if (!지울행.length) { Logger.log('[포스복원] 줄이 없습니다.'); return; }

  // 아래에서부터 지워야 행 번호가 안 밀린다
  지울행.reverse().forEach(function (r) { sh.deleteRow(r); });

  Logger.log('✅ [포스복원] ' + 지울행.length + '줄 · ' + 합.toLocaleString() + '원을 지웠습니다.');
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  🎌 특별휴무 — 명절처럼 정기 휴무가 아닌 날
//
//  2026-09-07 추가.
//
//  왜 필요한가
//    원당은 연중무휴로 계산한다. 그래서 명절에 쉰 날도 「매출이 빈 날」로
//    잡혀서, 진단을 돌릴 때마다 있지도 않은 구멍을 알렸다.
//    2월 16·17일을 넉 달 동안 구멍으로 알고 있었다.
//
//  ⚠️ 쉬는 날이 생기면 여기에 꼭 적어주세요.
//     안 적으면 진단이 계속 그날을 「돈이 새는 날」로 알립니다.
//
//  명절은 전날·당일 이틀을 쉽니다 (사장님 확인, 2026-09-07)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
var 특별휴무_ = {
  '백석점': [
    '2026-02-16',   // 설날 전날 (2/17 설날은 화요일 = 정기휴무라 안 적어도 됨)
    '2026-09-24',   // 추석 전날
    '2026-09-25'    // 추석
  ],
  '원당점': [
    '2026-02-16',   // 설날 전날
    '2026-02-17',   // 설날
    '2026-07-20',   // 임시 휴무 (사장님 확인)
    '2026-09-24',   // 추석 전날
    '2026-09-25'    // 추석
  ]
};

// 그날 쉬었나 — 정기휴무 + 특별휴무를 함께 본다
function 쉬는날_(branch, day) {
  var 요일휴무 = 휴무요일_[branch];
  if (요일휴무 !== null && day.getDay() === 요일휴무) return true;
  var key = Utilities.formatDate(day, TIMEZONE, 'yyyy-MM-dd');
  return (특별휴무_[branch] || []).indexOf(key) >= 0;
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  📅 사월정리 — 4/30 하루에 뭉친 한 달치를 날짜별로 편다  (원당점)
//
//  2026-09-07 추가.
//
//  지금 상태
//    4월 매출 6,486만원이 사실상 4/30 하루에 몰려 있습니다.
//    (있는 날 4일 / 영업일 30일 — 1·2·3·30일에만 기록)
//    그때 처리에 문제가 있어 한 달치를 몰아 적으신 것으로 보입니다.
//
//  하는 일
//    ① 4월 카드매출·현금매출 줄을 전부 지웁니다
//    ② 포스 달력대로 4/1~4/30 을 새로 넣습니다
//
//  ⚠️ 배달매출은 건드리지 않습니다. 포스에 배달이 안 잡히기 때문입니다.
//     지우면 되살릴 방법이 없습니다.
//
//  검산
//    포스 달력 합계   70,130,000원
//    포스 월 총액     70,349,000원     차이 219,000원 (0.3%, 만원 단위 반올림)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 일 → [카드, 현금, 기타]   기타는 카드에 합칩니다
var 포스4월_원당_ = {
   1: [1120000, 110000,      0],   2: [2260000,      0,      0],
   3: [3180000,      0,      0],   4: [2270000, 120000,      0],
   5: [2920000, 160000,      0],   6: [1400000, 150000,  80000],
   7: [1920000,      0,      0],   8: [1400000,      0,  50000],
   9: [1420000, 130000,      0],  10: [2560000,      0,      0],
  11: [3410000, 200000,  50000],  12: [1970000,  90000,      0],
  13: [2250000,      0,      0],  14: [1650000,      0,      0],
  15: [2060000, 100000,      0],  16: [1080000,      0,      0],
  17: [2670000,  90000,      0],  18: [3090000,      0,      0],
  19: [3390000,  70000,      0],  20: [2370000,      0,      0],
  21: [1560000, 100000,      0],  22: [2180000,  40000,      0],
  23: [1810000,      0,      0],  24: [2660000,      0,      0],
  25: [3540000,      0, 150000],  26: [2740000,  50000,      0],
  27: [2120000,      0,      0],  28: [2010000, 220000,      0],
  29: [2070000,  60000,      0],  30: [2840000, 120000,  70000]
};

var 사월표식_ = '[포스복원4월]';


function 사월정리_미리보기() { 사월정리_(true); }
function 사월정리_적용()     { 사월정리_(false); }

function 사월정리_(dryRun) {
  var branch = '원당점';
  var sh = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId).getSheetByName('지출및매출로그');
  if (!sh || sh.getLastRow() < 2) { Logger.log('❌ 기록이 없습니다'); return; }

  var v = sh.getRange(2, 1, sh.getLastRow() - 1, SHEET_HEADERS.length).getValues();

  // ── ① 지울 것 찾기 ─────────────────────────────────────
  var 지울행 = [], 지운금액 = 0, 분류별 = {}, 보존 = {};

  for (var i = 0; i < v.length; i++) {
    var d = toDate_(v[i][0]);
    if (!d) continue;
    if (d.getFullYear() !== 2026 || d.getMonth() !== 3) continue;   // 4월만

    var cat = String(v[i][1]).trim();
    var amt = Number(v[i][3]) || 0;

    if (cat === '카드매출' || cat === '현금매출') {
      지울행.push({ row: i + 2, ymd: Utilities.formatDate(d, TIMEZONE, 'MM-dd'), cat: cat, amt: amt });
      지운금액 += amt;
      분류별[cat] = (분류별[cat] || 0) + amt;
    } else if (매출분류_.indexOf(cat) >= 0) {
      보존[cat] = (보존[cat] || 0) + amt;   // 배달매출 등은 그대로 둡니다
    }
  }

  // ── ② 넣을 것 만들기 ───────────────────────────────────
  var 넣을줄 = [], 넣을금액 = 0;
  var now = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss');

  Object.keys(포스4월_원당_).sort(function (a, b) { return a - b; }).forEach(function (day) {
    var a = 포스4월_원당_[day];
    var ymd = '2026-04-' + String(day).padStart(2, '0');
    [['카드매출', a[0] + a[2]], ['현금매출', a[1]]].forEach(function (p) {
      if (p[1] <= 0) return;
      넣을줄.push([ymd, p[0], 사월표식_ + ' 포스 달력', p[1], branch, 사월표식_, now, '']);
      넣을금액 += p[1];
    });
  });

  // ── ③ 보여주기 ─────────────────────────────────────────
  Logger.log('\n ════════ 원당 4월 정리 ════════\n');
  Logger.log('  지울 것   ' + 지울행.length + '줄 · ' + 지운금액.toLocaleString() + '원');
  Object.keys(분류별).forEach(function (c) {
    Logger.log('     ' + c + '  ' + 분류별[c].toLocaleString() + '원');
  });

  if (Object.keys(보존).length) {
    Logger.log('\n  그대로 두는 것 (포스에 안 잡히는 매출)');
    Object.keys(보존).forEach(function (c) {
      Logger.log('     ' + c + '  ' + 보존[c].toLocaleString() + '원');
    });
  }

  Logger.log('\n  ── 지울 줄 (앞에서 10줄) ──');
  지울행.slice(0, 10).forEach(function (r) {
    Logger.log('     ' + r.ymd + '  ' + r.cat + '  ' + r.amt.toLocaleString() + '원');
  });
  if (지울행.length > 10) Logger.log('     … 그 외 ' + (지울행.length - 10) + '줄');

  Logger.log('\n  넣을 것   ' + 넣을줄.length + '줄 · ' + 넣을금액.toLocaleString() + '원');
  Logger.log('     4월 1일부터 30일까지 포스 달력 그대로');

  Logger.log('\n  ──────────────────────────────');
  Logger.log('  결과      ' + 지운금액.toLocaleString() + '원  →  ' + 넣을금액.toLocaleString() + '원');
  Logger.log('  차이      ' + (넣을금액 - 지운금액).toLocaleString() + '원');
  Logger.log('  ※ 포스 월 총액은 70,349,000원입니다 (만원 단위 반올림으로 21만원쯤 차이 납니다)');

  if (dryRun) {
    Logger.log('\n  ※ 미리보기입니다. 아무것도 안 바꿨습니다.');
    Logger.log('  ※ 실제로 하려면 사월정리_적용() 을 실행하세요.');
    return;
  }

  // ── ④ 실행 ─────────────────────────────────────────────
  // 아래에서부터 지워야 행 번호가 안 밀린다
  지울행.map(function (r) { return r.row; }).sort(function (a, b) { return b - a; })
        .forEach(function (row) { sh.deleteRow(row); });

  sh.getRange(sh.getLastRow() + 1, 1, 넣을줄.length, SHEET_HEADERS.length).setValues(넣을줄);

  Logger.log('\n  ✅ ' + 지울행.length + '줄을 지우고 ' + 넣을줄.length + '줄을 넣었습니다.');
  Logger.log('  항목명에 「' + 사월표식_ + '」 이 붙어 있습니다.');
  Logger.log('\n  다음: 날짜진단() 으로 4월이 30/30 이 되었는지 보세요.');
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  👷 인건비진단() — 인건비가 어느 달에 얼마로 들어가 있나
//
//  2026-09-07 추가. 「8월 인건비를 못 잡고 있다」는 확인 요청 때문입니다.
//
//  인건비는 syncLaborCosts 가 매달 1일 날짜로 한 줄씩 넣습니다.
//  표식은  [자동]인건비_지점_2026-08  형태입니다.
//
//  ⚠️ 읽기만 합니다.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function 인건비진단() {
  Object.keys(BRANCH_CONFIG).forEach(function (branch) {
    Logger.log('\n\n ════════════ [' + branch + '] ════════════');

    var sh = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId).getSheetByName('지출및매출로그');
    if (!sh || sh.getLastRow() < 2) { Logger.log('  기록 없음'); return; }

    var v = sh.getRange(2, 1, sh.getLastRow() - 1, SHEET_HEADERS.length).getValues();
    var 월별 = {};    // 'yyyy-MM' → { 금액, 표식, 줄수 }

    v.forEach(function (r) {
      var cat = String(r[1]).trim();
      if (cat !== '인건비' && cat !== '알바급여' && cat !== '직원급여') return;
      var d = toDate_(r[0]);
      if (!d) return;
      var ym = Utilities.formatDate(d, TIMEZONE, 'yyyy-MM');
      if (!월별[ym]) 월별[ym] = { 금액: 0, 줄수: 0, 분류: {}, 표식: [] };
      월별[ym].금액 += Number(r[3]) || 0;
      월별[ym].줄수++;
      월별[ym].분류[cat] = (월별[ym].분류[cat] || 0) + (Number(r[3]) || 0);
      var mark = String(r[5] || '').trim();
      if (mark && 월별[ym].표식.indexOf(mark) < 0 && 월별[ym].표식.length < 3) 월별[ym].표식.push(mark);
    });

    var 달 = Object.keys(월별).sort();
    if (!달.length) { Logger.log('  ❌ 인건비 기록이 하나도 없습니다'); return; }

    Logger.log('\n  월        금액              줄수   내역');
    Logger.log('  ────────────────────────────────────────────────────────');

    // 1월부터 이번 달까지 빠진 달도 보여준다
    var 오늘 = new Date();
    for (var m = 1; m <= oel_(오늘); m++) {
      var ym = '2026-' + String(m).padStart(2, '0');
      var g = 월별[ym];
      if (!g) {
        Logger.log('  ' + ym + '   ❌ 없음');
        continue;
      }
      var 내역 = Object.keys(g.분류).map(function (c) {
        return c + ' ' + Math.round(g.분류[c] / 10000) + '만';
      }).join(' · ');
      Logger.log('  ' + ym + '   ' + (g.금액.toLocaleString() + '원          ').slice(0, 15) +
                 '  ' + g.줄수 + '줄   ' + 내역);
    }

    Logger.log('\n  ── 표식 (어떻게 들어갔는지) ──');
    달.forEach(function (ym) {
      Logger.log('     ' + ym + '  ' + (월별[ym].표식.join(' / ') || '(표식 없음 — 손으로 넣은 것)'));
    });
  });

  Logger.log('\n\n ※ 읽기만 했습니다.');
  Logger.log(' ※ 「❌ 없음」인 달은 알바계산기에서 그 달 지급완료를 안 눌렀거나,');
  Logger.log('    인건비_전체동기화_적용() 을 안 돌린 것입니다.');
}

// 이번 달 번호 (2026년 기준)
function oel_(d) { return d.getFullYear() > 2026 ? 12 : d.getMonth() + 1; }


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  🧾 인건비시트진단() — 손익계산서 「시트」에 급여가 얼마로 적혀 있나
//
//  2026-09-07 추가.
//
//  왜 또 만드나
//    인건비진단() 은 「지출및매출로그」만 봤다. 그래서 1~4월이 「없음」으로 나왔다.
//    ⚠️ 그런데 앱이 생기기 전에는 손으로 시트에 적으셨다. (사장님 확인)
//       로그에 없는 게 정상이고, 시트에는 값이 있어야 한다.
//       그걸 확인 안 하고 「인건비가 통째로 없다」고 보고한 것은 내 잘못이다.
//
//  이 함수는 시트의 「알바급여」·「직원급여」 행을 직접 읽는다.
//  같은 자리에 수식이 들어 있는지(=로그를 읽는지) 값이 박혀 있는지(=수기)도 구분한다.
//
//  읽는 법
//     수기      손으로 적은 값. 앱 이전 달이면 정상
//     로그참조   수식이 로그를 읽는 것. 앱 이후 달이면 정상
//     0원 · 빈칸 ⚠️ 진짜 구멍
//
//  ⚠️ 읽기만 합니다.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function 인건비시트진단() {
  Object.keys(BRANCH_CONFIG).forEach(function (branch) {
    Logger.log('\n\n ════════════ [' + branch + '] ════════════');

    var ss = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId);

    Logger.log('\n  월      알바급여                    직원급여');
    Logger.log('  ──────────────────────────────────────────────────────────────');

    var 합 = { 알바: 0, 직원: 0 };
    var 빈달 = [];

    for (var m = 1; m <= 12; m++) {
      var sh = ss.getSheetByName('26년 ' + m + '월 손익계산서');
      if (!sh) continue;

      var 칸 = [];
      PAYROLL_RULES.forEach(function (rule) {
        var row = findLabelRow_(sh, rule.label);
        if (row < 0) { 칸.push('(행 없음)'); return; }

        var cell    = sh.getRange(row, 3);          // C열
        var 수식    = cell.getFormula();
        var 표시    = cell.getDisplayValue();
        var 값      = Number(String(표시).replace(/[^0-9.-]/g, '')) || 0;

        var 방식 = 수식 ? (수식.indexOf('지출및매출로그') >= 0 || 수식.indexOf('SUMIFS') >= 0
                          ? '로그참조' : '수식')
                       : '수기';

        if (rule.label === '알바급여') 합.알바 += 값; else 합.직원 += 값;
        if (값 === 0) 빈달.push(m + '월 ' + rule.label);

        칸.push((값 ? 값.toLocaleString() + '원' : '⚠️ 0원') + ' (' + 방식 + ')');
      });

      Logger.log('  ' + ('  ' + m + '월').slice(-4) + '   ' +
                 ((칸[0] || '') + '                        ').slice(0, 26) + '  ' + (칸[1] || ''));
    }

    Logger.log('\n  ──────────────────────────────');
    Logger.log('  올해 알바급여 합계   ' + 합.알바.toLocaleString() + '원');
    Logger.log('  올해 직원급여 합계   ' + 합.직원.toLocaleString() + '원');

    if (빈달.length) {
      Logger.log('\n  ⚠️ 0원인 칸  ' + 빈달.length + '개');
      Logger.log('     ' + 빈달.join(' · '));
      Logger.log('     (백석은 직원이 없으므로 「직원급여 0원」이 정상입니다)');
    } else {
      Logger.log('\n  ✅ 0원인 칸이 없습니다');
    }
  });

  Logger.log('\n\n ── 읽는 법 ──');
  Logger.log('   수기      손으로 적은 값. 앱 쓰기 전(1~4월)이면 정상입니다');
  Logger.log('   로그참조   수식이 지출및매출로그를 읽습니다. 앱 이후 달의 정상 모습입니다');
  Logger.log('   ⚠️ 0원    진짜 구멍입니다');
  Logger.log('\n ※ 읽기만 했습니다.');
}
