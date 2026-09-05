
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
        if (휴무 !== null && day.getDay() === 휴무) continue;   // 정기 휴무
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
