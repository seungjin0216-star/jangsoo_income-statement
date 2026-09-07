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
        if (휴무 !== null && day.getDay() === 휴무) continue;

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
