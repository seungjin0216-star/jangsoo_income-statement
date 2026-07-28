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
const GEMINI_API_KEY = "AIzaSyALfPbDBZpPTO9xncZorKh0dTWoApKkDrg";
const GEMINI_MODEL   = "gemini-2.5-flash";

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


// ============================================================
// 📡 웹앱 수신 (앱 → GAS → 드라이브 저장)  ← 핵심!
// ============================================================

function doPost(e) {
  try {
    var data    = JSON.parse(e.postData.contents);
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
    "- '매출 합계', '총 합계', '합계' 등 합산 행\n" +
    "- 위 5가지 분류 외 모든 항목\n" +
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
    "거래 날짜(YYYY-MM-DD)와 공급가액 또는 합계 금액을 추출하여 순수 JSON 배열만 응답하세요:\n" +
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

  SpreadsheetApp.flush();
  Logger.log('✅ [' + branchName + '] ' + newName + ' 생성 완료');
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
