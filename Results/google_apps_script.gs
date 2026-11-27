const SPREADSHEET_ID = "12VVY0FAPj_K8z--sDY0PUn5cfERRt6wLHltVndOTx6U";
const TEACHER_READ_TOKEN = "35b96a07a6ce4ba4b93901a656e74ee5";
const TAB_ROUNDS = "Підсумки раундів";
const TAB_ATTEMPTS = "Живий лог відповідей";
const TAB_STATS = "Статистика та слабкі місця";

function sanitizeSheetTabName(rawTag) {
  if (!rawTag) return "";
  const cleaned = String(rawTag)
    .replace(/[:\\/?*\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  if (!cleaned) return "";
  const lower = cleaned.toLowerCase();
  if (
    lower === TAB_ROUNDS.toLowerCase() ||
    lower === TAB_ATTEMPTS.toLowerCase() ||
    lower === TAB_STATS.toLowerCase()
  ) {
    return "";
  }
  return cleaned;
}

function getOrCreateStudentSheet(ss, rawTag) {
  const cleanTag = sanitizeSheetTabName(rawTag);
  if (!cleanTag) return null;

  const targetLower = cleanTag.toLowerCase();
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().toLowerCase() === targetLower) {
      return sheets[i];
    }
  }

  const sh = ss.insertSheet(cleanTag);
  const sep = String(ss.getSpreadsheetLocale() || "").toLowerCase().indexOf("uk") === 0 ? ";" : ",";

  sh.getRange(1, 1, 1, 10)
    .setValues([[
      "Учень (код)",
      "Пройдено раундів",
      "Середня точність (%)",
      "З 1-ї спроби",
      "Всього помилок",
      "Остання активність",
      "", "", "", ""
    ]])
    .setBackground("#0F172A")
    .setFontColor("#FFFFFF")
    .setFontWeight("bold");

  sh.getRange(2, 1, 1, 10)
    .setValues([[
      safeCellText(cleanTag),
      `=COUNTIF(D4:D${sep}"📊 ПІДСУМОК РАУНДУ")`,
      `=IFERROR(ROUND(AVERAGE(H4:H)${sep}1)${sep}0)`,
      `=COUNTIF(G4:G${sep}"*1-ша спроба*")`,
      `=COUNTIF(G4:G${sep}"*Помилка*")`,
      `=IFERROR(INDEX(A4:A${sep}COUNTA(A4:A))${sep}"—")`,
      "", "", "", ""
    ]])
    .setBackground("#F1F5F9")
    .setFontColor("#0F172A")
    .setFontWeight("bold");

  sh.getRange(3, 1, 1, 10)
    .setValues([[
      "Дата і час",
      "Урок / Тема",
      "Міні-гра",
      "Подія",
      "Питання / Підсумок",
      "Відповідь учня",
      "Результат",
      "Точність раунду (%)",
      "Правильна відповідь / Деталі помилок",
      "Пояснення / Правило"
    ]])
    .setBackground("#1E293B")
    .setFontColor("#FFFFFF")
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setWrap(true);

  sh.setFrozenRows(3);

  const widths = [145, 200, 180, 165, 300, 160, 185, 130, 340, 300];
  for (let c = 0; c < widths.length; c++) {
    sh.setColumnWidth(c + 1, widths[c]);
  }

  sh.getRange("E4:F1000").setWrap(true);
  sh.getRange("I4:J1000").setWrap(true);

  const statusRange = sh.getRange("G4:G2000");
  const rules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains("Помилка")
      .setBackground("#FEE2E2")
      .setRanges([statusRange])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains("1-ша спроба")
      .setBackground("#DCFCE7")
      .setRanges([statusRange])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains("після помилки")
      .setBackground("#FEF3C7")
      .setRanges([statusRange])
      .build()
  ];
  sh.setConditionalFormatRules(rules);

  return sh;
}

function safeCellText(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/^[=+\-@]/.test(s)) return "'" + s;
  return s;
}

function getProcessedIdsSet() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty("PROCESSED_EVENT_IDS");
  if (!raw) return { list: [], set: {} };
  try {
    const arr = JSON.parse(raw);
    const set = {};
    if (Array.isArray(arr)) {
      for (let i = 0; i < arr.length; i++) set[arr[i]] = true;
      return { list: arr, set: set };
    }
  } catch (_) {}
  return { list: [], set: {} };
}

function saveProcessedIdsSet(tracker) {
  const trimmed = tracker.list.slice(-400);
  PropertiesService.getScriptProperties().setProperty("PROCESSED_EVENT_IDS", JSON.stringify(trimmed));
}

function markEventSeen(tracker, eventId) {
  if (!eventId) return true;
  if (tracker.set[eventId]) return false;
  tracker.set[eventId] = true;
  tracker.list.push(eventId);
  return true;
}

function formatTs(payload) {
  if (payload && payload.timestamp) return String(payload.timestamp);
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Europe/Kyiv", "yyyy-MM-dd HH:mm:ss");
}

function updateSessionStudentName(ss, sessionId, studentName) {
  if (!sessionId || !studentName) return false;
  const safeName = safeCellText(studentName);
  let foundAny = false;

  const roundsSheet = ss.getSheetByName(TAB_ROUNDS);
  if (roundsSheet && roundsSheet.getLastRow() > 1) {
    const lastRow = roundsSheet.getLastRow();
    const sessions = roundsSheet.getRange(2, 13, lastRow - 1, 1).getValues();
    const names = roundsSheet.getRange(2, 2, lastRow - 1, 1).getValues();
    let changed = false;
    for (let i = 0; i < sessions.length; i++) {
      if (String(sessions[i][0]) === String(sessionId)) {
        names[i][0] = safeName;
        changed = true;
        foundAny = true;
      }
    }
    if (changed) {
      roundsSheet.getRange(2, 2, lastRow - 1, 1).setValues(names);
    }
  }

  const attemptsSheet = ss.getSheetByName(TAB_ATTEMPTS);
  if (attemptsSheet && attemptsSheet.getLastRow() > 1) {
    const lastRow = attemptsSheet.getLastRow();
    const sessions = attemptsSheet.getRange(2, 12, lastRow - 1, 1).getValues();
    const names = attemptsSheet.getRange(2, 2, lastRow - 1, 1).getValues();
    let changed = false;
    for (let i = 0; i < sessions.length; i++) {
      if (String(sessions[i][0]) === String(sessionId)) {
        names[i][0] = safeName;
        changed = true;
        foundAny = true;
      }
    }
    if (changed) {
      attemptsSheet.getRange(2, 2, lastRow - 1, 1).setValues(names);
    }
  }

  return foundAny;
}

function processSinglePayload(ss, payload, tracker) {
  if (!payload || !payload.event) return;
  if (payload.event === "ping") return;

  if (!markEventSeen(tracker, payload.eventId)) {
    return;
  }

  const ts = formatTs(payload);

  if (payload.event === "attempt") {
    const sheet = ss.getSheetByName(TAB_ATTEMPTS);
    if (sheet) {
      sheet.appendRow([
        ts,
        safeCellText(payload.studentName || ""),
        safeCellText(payload.lessonTitle || ""),
        safeCellText(payload.gameName || payload.gameId || ""),
        safeCellText(payload.question || ""),
        safeCellText(payload.studentAnswer || ""),
        safeCellText(payload.correctAnswer || ""),
        safeCellText(payload.resultLabel || (payload.isCorrect ? "✅ Правильно" : "❌ Помилка")),
        Number(payload.attemptNum || 1),
        safeCellText(payload.explanation || ""),
        Number(payload.timeSec || 0),
        safeCellText(payload.sessionId || "")
      ]);
    }
    if (payload.studentTag) {
      const stSheet = getOrCreateStudentSheet(ss, payload.studentTag);
      if (stSheet) {
        stSheet.appendRow([
          ts,
          safeCellText(payload.lessonTitle || ""),
          safeCellText(payload.gameName || payload.gameId || ""),
          "Відповідь #" + Number(payload.attemptNum || 1),
          safeCellText(payload.question || ""),
          safeCellText(payload.studentAnswer || ""),
          safeCellText(payload.resultLabel || (payload.isCorrect ? "✅ Правильно" : "❌ Помилка")),
          "",
          safeCellText(payload.correctAnswer || ""),
          safeCellText(payload.explanation || "")
        ]);
      }
    }
    return;
  }

  if (payload.event === "round_end") {
    const sheet = ss.getSheetByName(TAB_ROUNDS);
    if (sheet) {
      sheet.appendRow([
        ts,
        safeCellText(payload.studentName || ""),
        safeCellText(payload.lessonTitle || ""),
        safeCellText(payload.grammar || ""),
        safeCellText(payload.gameName || payload.gameId || ""),
        safeCellText(payload.status || "Завершено раунд"),
        Number(payload.firstTryCorrect || 0),
        Number(payload.totalQuestions || 0),
        Number(payload.accuracy || 0),
        Number(payload.wrongCount || 0),
        Number(payload.durationSec || 0),
        safeCellText(payload.mistakesSummary || ""),
        safeCellText(payload.sessionId || "")
      ]);
    }
    if (payload.studentTag) {
      const stSheet = getOrCreateStudentSheet(ss, payload.studentTag);
      if (stSheet) {
        const summaryText = "З 1-ї спроби: " + Number(payload.firstTryCorrect || 0) + " / " + Number(payload.totalQuestions || 0) +
          " (помилок: " + Number(payload.wrongCount || 0) + ", час: " + Number(payload.durationSec || 0) + "с)";
        stSheet.appendRow([
          ts,
          safeCellText(payload.lessonTitle || ""),
          safeCellText(payload.gameName || payload.gameId || ""),
          "📊 ПІДСУМОК РАУНДУ",
          safeCellText(summaryText),
          "—",
          safeCellText(payload.status || "Завершено раунд"),
          Number(payload.accuracy || 0),
          safeCellText(payload.mistakesSummary || ""),
          safeCellText(payload.grammar || "")
        ]);
        stSheet.getRange(stSheet.getLastRow(), 1, 1, 10)
          .setBackground("#EFF6FF")
          .setFontWeight("bold");
      }
    }
    return;
  }

  if (payload.event === "certificate") {
    const updated = updateSessionStudentName(ss, payload.sessionId, payload.studentName);
    if (!updated) {
      const roundsSheet = ss.getSheetByName(TAB_ROUNDS);
      if (roundsSheet) {
        roundsSheet.appendRow([
          ts,
          safeCellText(payload.studentName || ""),
          safeCellText(payload.lessonTitle || ""),
          safeCellText(payload.grammar || ""),
          "Сертифікат",
          "Отримано сертифікат",
          0,
          0,
          100,
          0,
          0,
          "Ім'я вказано на фінальному сертифікаті",
          safeCellText(payload.sessionId || "")
        ]);
      }
    }
    if (payload.studentTag) {
      const stSheet = getOrCreateStudentSheet(ss, payload.studentTag);
      if (stSheet) {
        stSheet.getRange(2, 1).setValue(safeCellText(payload.studentName || payload.studentTag));
      }
    }
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "{}";
    const payload = JSON.parse(raw);
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const tracker = getProcessedIdsSet();

    if (payload.event === "batch_sync" && Array.isArray(payload.items)) {
      for (let i = 0; i < payload.items.length; i++) {
        processSinglePayload(ss, payload.items[i], tracker);
      }
      saveProcessedIdsSet(tracker);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, synced: payload.items.length }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (payload.event === "ping") {
      return ContentService.createTextOutput(JSON.stringify({ ok: true, pong: true, sheetTitle: ss.getName() }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    processSinglePayload(ss, payload, tracker);
    saveProcessedIdsSet(tracker);

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  const token = (e && e.parameter && e.parameter.token) ? String(e.parameter.token) : "";
  if (token !== TEACHER_READ_TOKEN) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "Unauthorized" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    if (e.parameter && e.parameter.action === "ping") {
      return ContentService.createTextOutput(JSON.stringify({ ok: true, pong: true, sheetTitle: ss.getName() }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const rounds = [];
    const roundsSheet = ss.getSheetByName(TAB_ROUNDS);
    if (roundsSheet && roundsSheet.getLastRow() > 1) {
      const total = roundsSheet.getLastRow() - 1;
      const take = Math.min(total, 300);
      const startRow = 2 + (total - take);
      const vals = roundsSheet.getRange(startRow, 1, take, 13).getDisplayValues();
      for (let i = 0; i < vals.length; i++) {
        const r = vals[i];
        rounds.push({
          eventId: "gs_r_" + (startRow + i),
          timestamp: r[0],
          studentName: r[1],
          lessonTitle: r[2],
          grammar: r[3],
          gameName: r[4],
          status: r[5],
          firstTryCorrect: Number(r[6]) || 0,
          totalQuestions: Number(r[7]) || 0,
          accuracy: Number(String(r[8]).replace(",", ".")) || 0,
          wrongCount: Number(r[9]) || 0,
          durationSec: Number(r[10]) || 0,
          mistakesSummary: r[11],
          sessionId: r[12]
        });
      }
    }

    const attempts = [];
    const attSheet = ss.getSheetByName(TAB_ATTEMPTS);
    if (attSheet && attSheet.getLastRow() > 1) {
      const total = attSheet.getLastRow() - 1;
      const take = Math.min(total, 600);
      const startRow = 2 + (total - take);
      const vals = attSheet.getRange(startRow, 1, take, 12).getDisplayValues();
      for (let i = 0; i < vals.length; i++) {
        const a = vals[i];
        attempts.push({
          eventId: "gs_a_" + (startRow + i),
          timestamp: a[0],
          studentName: a[1],
          lessonTitle: a[2],
          gameName: a[3],
          question: a[4],
          studentAnswer: a[5],
          correctAnswer: a[6],
          resultLabel: a[7],
          attemptNum: Number(a[8]) || 1,
          explanation: a[9],
          timeSec: Number(String(a[10]).replace(",", ".")) || 0,
          sessionId: a[11],
          isCorrect: String(a[7]).indexOf("Помилка") === -1
        });
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      ok: true,
      spreadsheetUrl: ss.getUrl(),
      rounds: rounds,
      attempts: attempts
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
