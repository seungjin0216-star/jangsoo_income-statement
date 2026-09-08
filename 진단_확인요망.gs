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


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  💸 지출진단() — 지출 계정이 달마다 빠짐없이 들어갔나
//
//  2026-09-07 추가. 매출을 100% 채우고 나서 만든 것입니다.
//
//  왜 필요한가
//    매출은 「그날 기록이 있나」로 구멍을 셀 수 있었다.
//    지출은 그게 안 된다. 매일 사는 게 아니기 때문이다.
//    대신 「지난달엔 있었는데 이번 달엔 없다」로 찾는다.
//    전기요금이 다섯 달 나오다 한 달 빠지면 그게 구멍이다.
//
//  읽는 법
//     숫자      그 달에 들어간 금액 (만원 단위)
//     ---       그 달에 한 줄도 없음
//     ⚠️        앞뒤 달에는 있는데 그 달만 빠짐  ← 이게 구멍
//
//  ⚠️ 읽기만 합니다.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function 지출진단() {
  var 이번달 = new Date().getMonth() + 1;

  Object.keys(BRANCH_CONFIG).forEach(function (branch) {
    Logger.log('\n\n ════════════ [' + branch + '] ════════════');

    var sh = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId).getSheetByName('지출및매출로그');
    if (!sh || sh.getLastRow() < 2) { Logger.log('  기록 없음'); return; }

    var v = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();

    var 표 = {};        // 분류 → { 1: 금액, 2: 금액, ... }
    var 건수 = {};      // 분류 → { 1: 줄수, ... }

    v.forEach(function (r) {
      var cat = String(r[1]).trim();
      if (!cat) return;
      if (매출분류_.indexOf(cat) >= 0) return;      // 매출은 날짜진단에서 봄

      var d = toDate_(r[0]);
      if (!d || d.getFullYear() !== 2026) return;
      var m = d.getMonth() + 1;

      if (!표[cat]) { 표[cat] = {}; 건수[cat] = {}; }
      표[cat][m]   = (표[cat][m] || 0) + (Number(r[3]) || 0);
      건수[cat][m] = (건수[cat][m] || 0) + 1;
    });

    var 분류들 = Object.keys(표).sort(function (a, b) {
      var sa = 0, sb = 0;
      for (var i = 1; i <= 12; i++) { sa += 표[a][i] || 0; sb += 표[b][i] || 0; }
      return sb - sa;                                // 금액 큰 것부터
    });

    if (!분류들.length) { Logger.log('  지출 기록이 없습니다'); return; }

    // ── 표 ──────────────────────────────────────────────────
    var 머리 = '  분류              ';
    for (var m = 1; m <= 이번달; m++) 머리 += ('  ' + m + '월').slice(-5);
    머리 += '     올해합계';
    Logger.log('\n' + 머리);
    Logger.log('  ' + Array(머리.length - 1).join('─'));

    var 의심 = [];

    분류들.forEach(function (cat) {
      var 줄 = '  ' + (cat + '                  ').slice(0, 18);
      var 합 = 0;

      for (var m = 1; m <= 이번달; m++) {
        var amt = 표[cat][m] || 0;
        합 += amt;
        줄 += (amt ? ('     ' + Math.round(amt / 10000)).slice(-5) : '    -');
      }
      줄 += '   ' + 합.toLocaleString() + '원';
      Logger.log(줄);

      // ── 「앞뒤엔 있는데 가운데만 빔」 찾기 ──
      //    9월은 아직 안 끝났으므로 8월까지만 본다
      var 마지막 = Math.min(이번달 - 1, 8);
      for (var m = 2; m <= 마지막; m++) {
        if (표[cat][m]) continue;
        var 앞있음 = false, 뒤있음 = false;
        for (var k = 1; k < m; k++) if (표[cat][k]) 앞있음 = true;
        for (var k = m + 1; k <= 마지막 + 1; k++) if (표[cat][k]) 뒤있음 = true;
        if (앞있음 && 뒤있음) 의심.push(cat + ' ' + m + '월');
      }
    });

    // ── 요약 ────────────────────────────────────────────────
    if (의심.length) {
      Logger.log('\n  🔴 앞뒤 달에는 있는데 그 달만 빠진 것  ' + 의심.length + '건');
      의심.forEach(function (s) { Logger.log('     ' + s); });
      Logger.log('     → 영수증을 안 올렸거나, 올렸는데 조용히 버려진 것입니다');
    } else {
      Logger.log('\n  ✅ 중간에 빠진 달이 없습니다');
    }

    // ── 한 번만 나온 분류 (오타·중복 계정 의심) ──────────────
    var 한번만 = 분류들.filter(function (cat) {
      var c = 0;
      for (var m = 1; m <= 12; m++) if (건수[cat][m]) c += 건수[cat][m];
      return c === 1;
    });
    if (한번만.length) {
      Logger.log('\n  ⚠️ 올해 딱 한 줄만 있는 분류  ' + 한번만.length + '개');
      Logger.log('     ' + 한번만.join(' · '));
      Logger.log('     → 계정 이름 오타이거나, 다른 계정과 합쳐야 할 것일 수 있습니다');
    }
  });

  Logger.log('\n\n ── 읽는 법 ──');
  Logger.log('   숫자   그 달 금액 (만원 단위)');
  Logger.log('   -      그 달에 한 줄도 없음');
  Logger.log('   🔴     앞뒤 달에는 있는데 그 달만 빠짐 = 구멍일 가능성 높음');
  Logger.log('\n ※ 9월은 아직 안 끝나서 구멍 판정에서 뺐습니다.');
  Logger.log(' ※ 읽기만 했습니다.');
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  🔗 시트계정진단() — 손익계산서 시트가 실제로 읽는 계정은 무엇인가
//
//  2026-09-07 추가.
//
//  왜 필요한가
//    로그에 원당 계정이 65개나 쌓여 있다. AI 가 영수증에 적힌 단어를
//    그대로 계정 이름으로 써버린 탓이다 (매입·구매·쇼핑·약국·편의점…).
//
//    그런데 손익계산서 시트는 정해진 계정만 SUMIFS 로 읽는다.
//    시트가 안 읽는 계정은 로그에만 쌓이고 손익에는 영향이 없다.
//    그 둘을 갈라야 「진짜 1억 손해」인지 「그냥 지저분한 것」인지 알 수 있다.
//
//  사장님 방침 (2026-09-07)
//    「손익계산서에 있는 계정이 전부다. 나머지 짜잘한 것은 가게내부카드로 묶는다」
//
//  ⚠️ 읽기만 합니다.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function 시트계정진단() {
  Object.keys(BRANCH_CONFIG).forEach(function (branch) {
    Logger.log('\n\n ════════════ [' + branch + '] ════════════');

    var ss = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId);

    // 가장 최근에 있는 월 시트를 고른다 (8월 → 7월 → …)
    var sh = null, 시트이름 = '';
    for (var m = 12; m >= 1; m--) {
      var t = ss.getSheetByName('26년 ' + m + '월 손익계산서');
      if (t) { sh = t; 시트이름 = '26년 ' + m + '월 손익계산서'; break; }
    }
    if (!sh) { Logger.log('  월 시트를 못 찾았습니다'); return; }

    Logger.log('  기준 시트: ' + 시트이름 + '\n');

    // ── ① 시트가 읽는 계정 모으기 ───────────────────────────
    //     C열 수식 안의 따옴표 문자열이 곧 분류명이다
    var last = Math.min(sh.getLastRow(), 60);
    var 라벨 = sh.getRange(1, 2, last, 1).getValues();
    var 수식 = sh.getRange(1, 3, last, 1).getFormulas();

    // ⚠️ 2026-09-07 첫 판에서 3개만 잡혔다. 수식이 분류명을 두 가지 방식으로 넘기기 때문이다.
    //      ① SUMIFS(..., "주류원가", ...)   따옴표로 직접   ← 인건비·직원급여만 이 방식
    //      ② SUMIFS(..., $B28, ...)         B열 라벨 참조   ← 대부분 이 방식
    //    ②를 놓쳐서 「카드매출도 시트가 안 읽는다」는 엉뚱한 결과가 나왔다.
    var 시트계정 = {};   // 분류 → 행이름
    for (var i = 0; i < last; i++) {
      var f = String(수식[i][0] || '');
      if (!f) continue;
      if (f.indexOf('지출및매출로그') < 0) continue;   // 로그를 읽는 행만
      var 행이름 = String(라벨[i][0] || '').trim();

      // ② B열을 참조하면 그 행의 라벨이 곧 분류명이다
      if (/\$?B\$?\d+/.test(f) && 행이름) 시트계정[행이름] = 행이름;

      // ① 따옴표로 직접 적힌 것
      var m2 = f.match(/"([^"]{2,20})"/g);
      if (m2) m2.forEach(function (q) {
        var cat = q.replace(/"/g, '').trim();
        if (!cat || /^[A-Z$!:0-9\s,]+$/.test(cat)) return;
        if (cat.indexOf('!') >= 0) return;
        시트계정[cat] = 행이름 || '(이름 없는 행)';
      });
    }

    // ── ② 로그에 쌓인 계정 모으기 ───────────────────────────
    var logSh = ss.getSheetByName('지출및매출로그');
    var 로그계정 = {};
    if (logSh && logSh.getLastRow() > 1) {
      var v = logSh.getRange(2, 1, logSh.getLastRow() - 1, 4).getValues();
      v.forEach(function (r) {
        var cat = String(r[1]).trim();
        if (!cat) return;
        if (!로그계정[cat]) 로그계정[cat] = { 금액: 0, 줄수: 0 };
        로그계정[cat].금액 += Number(r[3]) || 0;
        로그계정[cat].줄수++;
      });
    }

    // ── ③ 대조 ──────────────────────────────────────────────
    Logger.log('  ── 시트가 읽는 계정 ' + Object.keys(시트계정).length + '개 ──');
    Object.keys(시트계정).sort().forEach(function (cat) {
      var g = 로그계정[cat];
      Logger.log('     ' + (cat + '                ').slice(0, 16) +
                 ' → ' + (시트계정[cat] + '              ').slice(0, 14) +
                 (g ? '  로그 ' + g.금액.toLocaleString() + '원' : '  ⚠️ 로그에 한 줄도 없음'));
    });

    var 고아 = Object.keys(로그계정).filter(function (c) { return !시트계정[c]; });
    고아.sort(function (a, b) { return 로그계정[b].금액 - 로그계정[a].금액; });

    var 고아합 = 0;
    고아.forEach(function (c) { 고아합 += 로그계정[c].금액; });

    Logger.log('\n  ── 🔴 로그엔 있는데 시트가 안 읽는 계정 ' + 고아.length + '개 ──');
    Logger.log('     합계 ' + 고아합.toLocaleString() + '원   (손익 어디에도 안 잡히는 돈입니다)');
    Logger.log('');
    고아.forEach(function (c) {
      Logger.log('     ' + (로그계정[c].금액.toLocaleString() + '원          ').slice(0, 14) +
                 (로그계정[c].줄수 + '줄   ').slice(0, 7) + c);
    });

    // ── ④ 줄이 5개 이하인 계정은 내용을 그대로 보여준다 ──
    //     「공과금 1줄」처럼 뭉뚱그려진 것이 실제로 뭔지 알아야 어디로 묶을지 정한다
    var 소수 = 고아.filter(function (c) { return 로그계정[c].줄수 <= 5 && 로그계정[c].금액 >= 50000; });
    if (소수.length && logSh) {
      Logger.log('\n  ── 줄이 적은 계정의 실제 내용 (어디로 묶을지 정하려고) ──');
      var vv = logSh.getRange(2, 1, logSh.getLastRow() - 1, 6).getValues();
      소수.forEach(function (c) {
        Logger.log('     [' + c + ']');
        var 찍음 = 0;
        vv.forEach(function (r) {
          if (String(r[1]).trim() !== c || 찍음 >= 5) return;
          var d = toDate_(r[0]);
          Logger.log('        ' + (d ? Utilities.formatDate(d, TIMEZONE, 'MM-dd') : '??') +
                     '  ' + (Number(r[3]) || 0).toLocaleString() + '원  ' + String(r[2] || '').slice(0, 30));
          찍음++;
        });
      });
    }

    Logger.log('\n  ※ 「매출·마감정산서·마감정산·정산」은 매출이 잘못 들어간 것입니다.');
    Logger.log('     가게내부카드로 묶으면 안 됩니다. 지워야 합니다.');
  });

  Logger.log('\n\n ※ 읽기만 했습니다.');
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  📋 시트계정목록() — 손익계산서 시트의 B열을 그대로 찍는다
//
//  2026-09-07 추가. 시트계정진단() 이 수식을 두 번이나 잘못 읽어서,
//  아예 사람이 눈으로 보게 만든 것입니다.
//
//  사장님 방침 — 「손익계산서에 있는 계정이 전부. 나머지는 가게내부카드」
//  그 「있는 계정」이 바로 여기 나오는 목록입니다.
//
//  ⚠️ 읽기만 합니다.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function 시트계정목록() {
  Object.keys(BRANCH_CONFIG).forEach(function (branch) {
    var ss = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId);

    // 8월 시트를 먼저 본다 (9월은 방금 만들어져 수식이 덜 채워졌을 수 있음)
    var 후보 = ['26년 8월 손익계산서', '26년 7월 손익계산서', '26년 9월 손익계산서'];
    var sh = null, 이름 = '';
    for (var i = 0; i < 후보.length; i++) {
      var t = ss.getSheetByName(후보[i]);
      if (t) { sh = t; 이름 = 후보[i]; break; }
    }
    if (!sh) { Logger.log('[' + branch + '] 월 시트를 못 찾았습니다'); return; }

    Logger.log('\n\n ════════════ [' + branch + '] ' + 이름 + ' ════════════');
    Logger.log('\n  행   B열 (계정 이름)        C열 값           C열 수식');
    Logger.log('  ────────────────────────────────────────────────────────────────────────');

    var last = Math.min(sh.getLastRow(), 60);
    var b  = sh.getRange(1, 2, last, 1).getValues();
    var c  = sh.getRange(1, 3, last, 1).getDisplayValues();
    var cf = sh.getRange(1, 3, last, 1).getFormulas();

    for (var r = 0; r < last; r++) {
      var 이름칸 = String(b[r][0] || '').trim();
      var 값칸   = String(c[r][0] || '').trim();
      var 수식칸 = String(cf[r][0] || '').replace(/\s+/g, ' ');
      if (!이름칸 && !값칸) continue;

      Logger.log('  ' + ('  ' + (r + 1)).slice(-3) + '  ' +
                 (이름칸 + '                    ').slice(0, 20) + ' ' +
                 (값칸 + '              ').slice(0, 14) + '  ' +
                 (수식칸 ? 수식칸.slice(0, 90) : '(수식 없음 — 손으로 적은 값)'));
    }
  });

  Logger.log('\n\n ※ 읽기만 했습니다.');
  Logger.log(' ※ B열에 적힌 이름이 곧 계정입니다. 여기 없는 것은 전부 정리 대상입니다.');
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  🔍 매출중복진단() — 같은 날 매출이 두 번 들어갔나
//
//  2026-09-07 추가.
//
//  왜 필요한가
//    포스 8월 총액은 73,560,000원인데 시트는 82,532,000원이다.
//    897만원이 더 많다. 포스복원으로 넣은 건 빈 날 10일치뿐이고
//    기존 줄은 건드리지 않았으니, 기존 21일치가 부풀려져 있다는 뜻이다.
//
//    같은 날 같은 분류에 줄이 여러 개면 중복일 가능성이 높다.
//    ⚠️ 다만 마감정산서가 카드매출을 두 줄(신용카드+간편결제)로 만드는
//       정상적인 경우도 있으므로, 금액과 항목명을 같이 봐야 한다.
//
//  ⚠️ 읽기만 합니다.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function 매출중복진단() {
  // 포스에서 뽑은 월 총액 (사장님 캡처 기준)
  var 포스월합_ = {
    '원당점': { 1: 68316000, 2: 65062000, 3: 72250000, 4: 70349000,
                5: 77170000, 6: 65206000, 7: 60380000, 8: 73560000 }
  };

  Object.keys(BRANCH_CONFIG).forEach(function (branch) {
    Logger.log('\n\n ════════════ [' + branch + '] ════════════');

    var sh = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId).getSheetByName('지출및매출로그');
    if (!sh || sh.getLastRow() < 2) { Logger.log('  기록 없음'); return; }

    var v = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();

    var 묶음 = {};      // 'yyyy-MM-dd|분류' → [{금액, 항목명, 표식}]
    var 월합 = {};

    v.forEach(function (r) {
      var cat = String(r[1]).trim();
      if (매출분류_.indexOf(cat) < 0) return;
      var d = toDate_(r[0]);
      if (!d || d.getFullYear() !== 2026) return;

      var ymd = Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');
      var key = ymd + '|' + cat;
      if (!묶음[key]) 묶음[key] = [];
      묶음[key].push({ 금액: Number(r[3]) || 0, 항목: String(r[2] || ''), 표식: String(r[5] || '') });

      var m = d.getMonth() + 1;
      월합[m] = (월합[m] || 0) + (Number(r[3]) || 0);
    });

    // ── ① 포스와 월별 대조 ─────────────────────────────────
    var 포스 = 포스월합_[branch];
    if (포스) {
      Logger.log('\n  월    시트          포스          차이');
      Logger.log('  ─────────────────────────────────────────────────');
      for (var m = 1; m <= 8; m++) {
        var s = 월합[m] || 0, p = 포스[m] || 0;
        var diff = s - p;
        Logger.log('  ' + ('  ' + m + '월').slice(-4) + '  ' +
                   (s.toLocaleString() + '          ').slice(0, 13) + ' ' +
                   (p.toLocaleString() + '          ').slice(0, 13) + ' ' +
                   (diff > 0 ? '+' : '') + diff.toLocaleString() +
                   (Math.abs(diff) > 3000000 ? '  🔴' : ''));
      }
      Logger.log('\n  ※ 시트가 조금 많은 것은 배달매출 때문입니다 (포스엔 배달이 안 잡힘)');
      Logger.log('  ※ 🔴 는 배달로 보기엔 너무 큰 차이입니다');
    }

    // ── ② 같은 날 같은 분류에 줄이 여럿 ────────────────────
    var 여럿 = Object.keys(묶음).filter(function (k) { return 묶음[k].length > 1; }).sort();

    Logger.log('\n  ── 같은 날 같은 분류에 줄이 여럿인 것  ' + 여럿.length + '건 ──');
    if (!여럿.length) {
      Logger.log('     없습니다');
    } else {
      var 합 = 0;
      여럿.forEach(function (k) { 
        var arr = 묶음[k];
        var s = 0;
        arr.forEach(function (x) { s += x.금액; });
        합 += s - Math.max.apply(null, arr.map(function (x) { return x.금액; }));
      });
      Logger.log('     가장 큰 줄만 남기면 ' + 합.toLocaleString() + '원이 줄어듭니다\n');

      여럿.slice(0, 40).forEach(function (k) {
        var p = k.split('|');
        Logger.log('     ' + p[0] + '  ' + p[1]);
        묶음[k].forEach(function (x) {
          Logger.log('        ' + (x.금액.toLocaleString() + '원          ').slice(0, 13) +
                     '  ' + x.항목.slice(0, 24) + '   ' + x.표식.slice(0, 18));
        });
      });
      if (여럿.length > 40) Logger.log('     … 그 외 ' + (여럿.length - 40) + '건');
    }
  });

  Logger.log('\n\n ※ 읽기만 했습니다.');
  Logger.log(' ※ 마감정산서가 카드매출을 신용카드·간편결제 두 줄로 만드는 것은 정상입니다.');
  Logger.log('    금액과 항목명을 보고 진짜 중복인지 가려야 합니다.');
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  🧹 매출중복정리 — 두 번 들어간 매출 줄을 지운다
//
//  2026-09-07 추가. 포스 총액과 시트가 안 맞아서 만들었습니다.
//
//  ── 무엇을 지우나 ────────────────────────────────────────
//   1단계  완전히 똑같은 줄
//          날짜·분류·금액·항목명이 모두 같으면 첫 줄만 남기고 지웁니다.
//          예) 08-04 카드매출 731,000원 「신용카드」 가 3줄
//
//   2단계  달이 어긋난 줄
//          「[웹앱][마감정산서] 202606」 이라 적혀 있는데 날짜가 5월인 줄.
//          6월 마감정산서를 5월 날짜로 잘못 읽은 것입니다.
//          그 달 매출은 이미 제대로 들어가 있으므로 지웁니다.
//
//   3단계  0원 줄
//          금액이 0인 매출 줄. 합계에 영향은 없지만 지저분합니다.
//
//  ── 무엇을 안 건드리나 ───────────────────────────────────
//   ⚠️ 신용카드 + 간편결제처럼 금액이 다른 줄은 진짜 두 건입니다. 안 지웁니다.
//   ⚠️ 카드사별로 나뉜 줄(BC·국민·삼성…)도 정상입니다.
//   ⚠️ 지출이 매출로 잘못 분류된 것(과일야채싸게파는집 등)은
//      목록만 보여주고 자동으로 안 고칩니다. 판단이 필요합니다.
//
//  ⚠️ 되돌리기가 없습니다. 지운 줄은 로그에 남기니 필요하면 손으로 복구하세요.
//     그래서 미리보기를 반드시 먼저 보셔야 합니다.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function 매출중복정리_미리보기() { 매출중복정리_(true); }
function 매출중복정리_적용()     { 매출중복정리_(false); }

function 매출중복정리_(dryRun) {
  Object.keys(BRANCH_CONFIG).forEach(function (branch) {
    Logger.log('\n\n ════════════ [' + branch + '] ════════════');

    var sh = SpreadsheetApp.openById(BRANCH_CONFIG[branch].ssId).getSheetByName('지출및매출로그');
    if (!sh || sh.getLastRow() < 2) { Logger.log('  기록 없음'); return; }

    var v = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();

    var 지울것 = [];      // { row, 이유, ymd, cat, amt, 항목 }
    var 본것   = {};      // 'ymd|분류|금액|항목' → 이미 봤음
    var 의심   = [];      // 지출이 매출로 잘못 분류된 것

    for (var i = 0; i < v.length; i++) {
      var cat = String(v[i][1]).trim();
      if (매출분류_.indexOf(cat) < 0) continue;

      var d = toDate_(v[i][0]);
      if (!d) continue;
      var ymd  = Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');
      var amt  = Number(v[i][3]) || 0;
      var 항목 = String(v[i][2] || '').trim();
      var 표식 = String(v[i][5] || '').trim();
      var row  = i + 2;

      // ── 3단계: 0원 ──
      if (amt === 0) {
        지울것.push({ row: row, 이유: '0원', ymd: ymd, cat: cat, amt: amt, 항목: 항목 });
        continue;
      }

      // ── 2단계: 달이 크게 어긋난 줄 ──
      //
      //  ⚠️ 2026-09-07 첫 판이 과했다. 「달이 다르면 무조건」 지우려 해서
      //     5/31 마감정산서를 6/1 새벽에 찍은 것까지 전부 걸렸다.
      //     곱창집은 자정 넘겨 마감하니 월말·월초 경계는 늘 이렇다.
      //     원당 5월에서만 1,823만원이 잘못 잡혔다.
      //
      //  그래서 「표식 달의 앞뒤 3일」까지는 정상으로 본다.
      //     표식 202606 · 날짜 05-31  →  6/1 과 1일 차이   정상
      //     표식 202606 · 날짜 05-13  →  6/1 과 19일 차이  오류
      var mm = 표식.match(/(20\d{2})(\d{2})/);
      if (mm) {
        var 표식연 = Number(mm[1]), 표식월 = Number(mm[2]);
        if (표식월 >= 1 && 표식월 <= 12) {
          var 첫날   = new Date(표식연, 표식월 - 1, 1);
          var 말일   = new Date(표식연, 표식월, 0);
          var 여유   = 3 * 24 * 60 * 60 * 1000;
          var 이날   = new Date(d.getFullYear(), d.getMonth(), d.getDate());

          if (이날.getTime() < 첫날.getTime() - 여유 || 이날.getTime() > 말일.getTime() + 여유) {
            var 며칠 = Math.round(Math.min(
              Math.abs(이날 - 첫날), Math.abs(이날 - 말일)) / (24 * 60 * 60 * 1000));
            지울것.push({ row: row, 이유: '달어긋남(' + mm[1] + '-' + mm[2] + ' 것이 ' + 며칠 + '일 벗어남)',
                         ymd: ymd, cat: cat, amt: amt, 항목: 항목 });
            continue;
          }
        }
      }

      // ── 1단계: 완전히 똑같은 줄 ──
      var key = ymd + '|' + cat + '|' + amt + '|' + 항목;
      if (본것[key]) {
        지울것.push({ row: row, 이유: '똑같은 줄 반복', ymd: ymd, cat: cat, amt: amt, 항목: 항목 });
        continue;
      }
      본것[key] = true;

      // ── 참고: 지출로 보이는 매출 줄 ──
      //    항목명이 분류명과 다르고 업체 이름 같으면 의심
      //   ⚠️ [포스복원] 은 내가 넣은 정상 줄이므로 뺀다
      if (amt < 200000 && 항목 &&
          항목.indexOf('포스복원') < 0 &&
          항목.indexOf('매출') < 0 && 항목.indexOf('카드') < 0 &&
          항목.indexOf('현금') < 0 && 항목.indexOf('결제') < 0) {
        의심.push({ ymd: ymd, cat: cat, amt: amt, 항목: 항목 });
      }
    }

    // ── 보여주기 ────────────────────────────────────────────
    var 이유별 = {}, 총액 = 0;
    지울것.forEach(function (x) {
      이유별[x.이유.split('(')[0]] = (이유별[x.이유.split('(')[0]] || 0) + x.amt;
      총액 += x.amt;
    });

    Logger.log('\n  지울 줄 ' + 지울것.length + '개 · ' + 총액.toLocaleString() + '원\n');
    Object.keys(이유별).forEach(function (r) {
      Logger.log('     ' + (r + '              ').slice(0, 16) + 이유별[r].toLocaleString() + '원');
    });

    if (지울것.length) {
      Logger.log('\n  ── 지울 줄 (앞에서 30개) ──');
      지울것.slice(0, 30).forEach(function (x) {
        Logger.log('     ' + x.ymd + '  ' + (x.cat + '      ').slice(0, 6) +
                   '  ' + (x.amt.toLocaleString() + '원          ').slice(0, 13) +
                   '  ' + (x.항목 + '                  ').slice(0, 20) + '  ' + x.이유);
      });
      if (지울것.length > 30) Logger.log('     … 그 외 ' + (지울것.length - 30) + '개');
    }

    // ── 월별로 얼마가 줄어드나 ──────────────────────────────
    var 월별 = {};
    지울것.forEach(function (x) {
      var m = Number(x.ymd.slice(5, 7));
      월별[m] = (월별[m] || 0) + x.amt;
    });
    if (Object.keys(월별).length) {
      Logger.log('\n  ── 월별로 줄어드는 금액 ──');
      Object.keys(월별).sort(function (a, b) { return a - b; }).forEach(function (m) {
        Logger.log('     ' + m + '월   -' + 월별[m].toLocaleString() + '원');
      });
    }

    // ── 참고 목록 ───────────────────────────────────────────
    if (의심.length) {
      Logger.log('\n  ── ⚠️ 지출인데 매출로 들어간 듯한 줄  ' + 의심.length + '개 ──');
      Logger.log('     (자동으로 안 건드립니다. 눈으로 보고 판단하세요)');
      var 의심합 = 0;
      의심.forEach(function (x) { 의심합 += x.amt; });
      Logger.log('     합계 ' + 의심합.toLocaleString() + '원\n');
      의심.slice(0, 25).forEach(function (x) {
        Logger.log('        ' + x.ymd + '  ' + (x.cat + '      ').slice(0, 6) +
                   '  ' + (x.amt.toLocaleString() + '원        ').slice(0, 11) + '  ' + x.항목.slice(0, 26));
      });
      if (의심.length > 25) Logger.log('        … 그 외 ' + (의심.length - 25) + '개');
    }

    if (dryRun) {
      Logger.log('\n  ※ 미리보기입니다. 아무것도 안 지웠습니다.');
      return;
    }

    if (!지울것.length) { Logger.log('\n  지울 것이 없습니다.'); return; }

    // ── 실제 삭제 ───────────────────────────────────────────
    // ⚠️ 지운 줄을 로그에 남긴다. 되돌릴 때 필요하다.
    Logger.log('\n  ── 지운 줄 전체 기록 (되돌릴 때 쓰세요) ──');
    지울것.forEach(function (x) {
      Logger.log('     ' + x.ymd + '\t' + x.cat + '\t' + x.amt + '\t' + x.항목);
    });

    지울것.map(function (x) { return x.row; })
          .sort(function (a, b) { return b - a; })      // 아래에서부터
          .forEach(function (row) { sh.deleteRow(row); });

    Logger.log('\n  ✅ ' + 지울것.length + '줄 · ' + 총액.toLocaleString() + '원을 지웠습니다.');
  });

  if (dryRun) {
    Logger.log('\n\n ※ 실제로 지우려면 매출중복정리_적용() 을 실행하세요.');
    Logger.log(' ⚠️ 되돌리기 기능이 없습니다. 위 목록을 꼭 확인하세요.');
  } else {
    Logger.log('\n\n 다음: 매출중복진단() 으로 포스와 맞는지 다시 보세요.');
  }
}
