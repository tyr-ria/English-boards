(function (global) {
  'use strict';

  // Вставте сюди URL веб-додатку Google Apps Script (.../exec), якщо хочете,
  // щоб результати з GitHub Pages автоматично летіли у вашу Google Таблицю з будь-якого пристрою.
  var DEFAULT_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzDVLFp9KOiGWTWl-miczbS48JWwkPp9AB0tOVkaBOijm10hHyghKnU9sFeNcyvtH1k/exec";

  var STORAGE_KEY = "esl_hub_results_v1";
  var QUEUE_KEY = "esl_hub_pending_queue_v1";
  var WEBHOOK_KEY = "esl_gsheet_webhook_url";
  var CHANNEL_NAME = "esl_hub_live_results";

  var MAX_LOCAL_ROUNDS = 500;
  var MAX_LOCAL_ATTEMPTS = 2000;
  var MAX_QUEUE_ITEMS = 1000;

  var LESSON_CATALOG = {
    "present-simple-fnaf.html": { title: "FNAF Night 1: Present Simple", grammar: "Present Simple • A1–A2" },
    "present-continuous-fnaf.html": { title: "FNAF Night 2: Present Continuous", grammar: "Present Continuous • A2" },
    "past-simple-fnaf.html": { title: "FNAF Night 3: Past Simple", grammar: "Past Simple • A2–B1" },
    "past-continuous-fnaf.html": { title: "FNAF Night 4: Past Continuous", grammar: "Past Continuous • B1" },
    "future-simple-fnaf.html": { title: "FNAF Night 5: Future Simple", grammar: "Future Simple • A2" },
    "future-continuous-fnaf.html": { title: "FNAF Night 6: Future Continuous", grammar: "Future Continuous • A2–B1" },
    "minecraft_present_simple_quest.html": { title: "Minecraft: Present Simple", grammar: "Present Simple • A1" },
    "minecraft_present_continuous_quest.html": { title: "Minecraft: Present Continuous", grammar: "Present Continuous • A1" },
    "minecraft_present_simple_vs_continuous_quest.html": { title: "Minecraft: Present Simple vs Continuous", grammar: "Present Simple vs Continuous • A0–A1" },
    "minecraft_english_quest_past_simple.html": { title: "Minecraft: Past Simple", grammar: "Past Simple • A1–A2" },
    "minecraft_english_quest_past_continuous.html": { title: "Minecraft: Past Continuous", grammar: "Past Continuous • A2" },
    "minecraft_english_quest_future_expedition.html": { title: "Minecraft: Future Expedition", grammar: "Future Simple (will/won't) • A1–A2" },
    "petshop_consultant_hub.html": { title: "Happy PetShop Consultant", grammar: "Pets Vocabulary & Phonics • A0" },
    "zookeeper_adventure.html": { title: "Zookeeper Adventure", grammar: "Wild Animals & Numbers 1–6 • A0" },
    "mr_marcels_art_studio.html": { title: "Mr. Marcel's Art Studio", grammar: "Colors & Listening • A0" }
  };

  var IGNORED_DEFAULT_NAMES = {
    "": true,
    "night guard": true,
    "night guard #1987": true,
    "junior night guard": true,
    "jeremy f.": true,
    "master builder": true,
    "steve": true,
    "harvest hero": true,
    "nature explorer": true,
    "animal ranger": true,
    "future explorer": true,
    "super artist": true,
    "patron": true,
    "consultant": true
  };

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function formatTimestamp(ms) {
    var d = new Date(ms || Date.now());
    return (
      d.getFullYear() + "-" +
      pad2(d.getMonth() + 1) + "-" +
      pad2(d.getDate()) + " " +
      pad2(d.getHours()) + ":" +
      pad2(d.getMinutes()) + ":" +
      pad2(d.getSeconds())
    );
  }

  function formatShortLabel(ms) {
    var d = new Date(ms || Date.now());
    return pad2(d.getDate()) + "." + pad2(d.getMonth() + 1) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  function randomCode(len) {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var out = "";
    for (var i = 0; i < len; i++) {
      out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
  }

  function cleanText(val) {
    if (val === undefined || val === null) return "";
    return String(val).replace(/\s+/g, " ").trim();
  }

  function getLessonInfo() {
    var path = (global.location && global.location.pathname) ? global.location.pathname : "";
    var file = path.split("/").pop() || "";
    try {
      file = decodeURIComponent(file);
    } catch (_) {}
    if (LESSON_CATALOG[file]) {
      return {
        file: file,
        title: LESSON_CATALOG[file].title,
        grammar: LESSON_CATALOG[file].grammar
      };
    }
    return {
      file: file || "unknown.html",
      title: cleanText(global.document && global.document.title) || file || "ESL Lesson",
      grammar: "ESL Practice"
    };
  }

  var URL_STUDENT_KEY = "esl_url_student_v1";

  function normalizeStudentTag(raw) {
    return cleanText(raw)
      .replace(/^[-_.\s]+|[-_.\s]+$/g, "")
      .replace(/[^a-zA-Z0-9а-яА-ЯіїєґІЇЄҐ_-]/g, "")
      .toLowerCase();
  }

  function resolveUrlStudentTag(lessonFile) {
    var found = "";
    var hadUrlMarker = false;

    try {
      var search = global.location ? (global.location.search || "") : "";
      if (search && search.length > 1) {
        var rawQuery = search.slice(1);
        if (rawQuery.indexOf("=") !== -1) {
          var params = new URLSearchParams(search);
          var qVal = params.get("student") || params.get("name") || params.get("u") || "";
          if (qVal) {
            found = normalizeStudentTag(qVal);
            hadUrlMarker = true;
          }
        } else {
          found = normalizeStudentTag(decodeURIComponent(rawQuery));
          if (found) hadUrlMarker = true;
        }
      }
    } catch (_) {}

    if (!found) {
      try {
        var hash = global.location ? (global.location.hash || "") : "";
        if (hash && hash.length > 1) {
          var rawHash = hash.slice(1);
          if (rawHash.indexOf("=") === -1) {
            found = normalizeStudentTag(decodeURIComponent(rawHash));
            if (found) hadUrlMarker = true;
          }
        }
      } catch (_) {}
    }

    if (found) {
      try {
        if (global.sessionStorage) {
          global.sessionStorage.setItem(URL_STUDENT_KEY, JSON.stringify({
            tag: found,
            file: lessonFile,
            ts: Date.now()
          }));
        }
      } catch (_) {}

      if (hadUrlMarker && global.history && typeof global.history.replaceState === "function") {
        try {
          global.history.replaceState(null, "", global.location.pathname);
        } catch (_) {}
      }
      return found;
    }

    try {
      var rawStored = global.sessionStorage ? global.sessionStorage.getItem(URL_STUDENT_KEY) : null;
      if (rawStored) {
        var parsed = JSON.parse(rawStored);
        if (parsed && parsed.tag && parsed.file === lessonFile) {
          return normalizeStudentTag(parsed.tag);
        }
      }
    } catch (_) {}

    return "";
  }

  function safeStorageGet(key) {
    try {
      return global.localStorage ? global.localStorage.getItem(key) : null;
    } catch (_) {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      if (global.localStorage) {
        global.localStorage.setItem(key, value);
      }
    } catch (_) {}
  }

  function getWebhookUrl() {
    var saved = cleanText(safeStorageGet(WEBHOOK_KEY));
    if (saved) return saved;
    return cleanText(DEFAULT_WEBHOOK_URL);
  }

  var nowMs = Date.now();
  var sessionCode = randomCode(4);
  var sessionId = "s_" + nowMs.toString(36) + "_" + sessionCode.toLowerCase();
  var lessonInfo = getLessonInfo();
  var studentTag = resolveUrlStudentTag(lessonInfo.file);
  var studentName = studentTag || ("Сесія " + formatShortLabel(nowMs) + " (#" + sessionCode + ")");
  var lastSubmittedCertName = "";
  var activeRound = null;
  var certDebounceTimer = null;
  var channel = null;

  try {
    if (typeof global.BroadcastChannel === "function") {
      channel = new global.BroadcastChannel(CHANNEL_NAME);
    }
  } catch (_) {
    channel = null;
  }

  function readLocalStore() {
    try {
      var raw = safeStorageGet(STORAGE_KEY);
      if (!raw) return { rounds: [], attempts: [] };
      var parsed = JSON.parse(raw);
      return {
        rounds: Array.isArray(parsed.rounds) ? parsed.rounds : [],
        attempts: Array.isArray(parsed.attempts) ? parsed.attempts : []
      };
    } catch (_) {
      return { rounds: [], attempts: [] };
    }
  }

  function writeLocalStore(store) {
    try {
      if (store.rounds.length > MAX_LOCAL_ROUNDS) {
        store.rounds = store.rounds.slice(store.rounds.length - MAX_LOCAL_ROUNDS);
      }
      if (store.attempts.length > MAX_LOCAL_ATTEMPTS) {
        store.attempts = store.attempts.slice(store.attempts.length - MAX_LOCAL_ATTEMPTS);
      }
      safeStorageSet(STORAGE_KEY, JSON.stringify(store));
    } catch (_) {}
  }

  function pushQueue(payload) {
    try {
      var raw = safeStorageGet(QUEUE_KEY);
      var queue = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(queue)) queue = [];
      queue.push(payload);
      if (queue.length > MAX_QUEUE_ITEMS) {
        queue = queue.slice(queue.length - MAX_QUEUE_ITEMS);
      }
      safeStorageSet(QUEUE_KEY, JSON.stringify(queue));
    } catch (_) {}
  }

  function postToWebhook(payload) {
    var url = getWebhookUrl();
    if (!url) {
      pushQueue(payload);
      return;
    }
    try {
      if (typeof global.fetch === "function") {
        global.fetch(url, {
          method: "POST",
          mode: "no-cors",
          keepalive: true,
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(payload)
        }).catch(function () {
          pushQueue(payload);
        });
      } else {
        pushQueue(payload);
      }
    } catch (_) {
      pushQueue(payload);
    }
  }

  function broadcastEvent(type, payload) {
    try {
      if (channel) {
        channel.postMessage({ type: type, payload: payload });
      }
    } catch (_) {}
  }

  function saveEventLocally(payload) {
    var store = readLocalStore();
    if (payload.event === "attempt") {
      store.attempts.push(payload);
    } else if (payload.event === "round_end") {
      store.rounds.push(payload);
    } else if (payload.event === "certificate") {
      for (var i = 0; i < store.rounds.length; i++) {
        if (store.rounds[i].sessionId === payload.sessionId) {
          store.rounds[i].studentName = payload.studentName;
        }
      }
      for (var j = 0; j < store.attempts.length; j++) {
        if (store.attempts[j].sessionId === payload.sessionId) {
          store.attempts[j].studentName = payload.studentName;
        }
      }
    }
    writeLocalStore(store);

    try {
      var rawQ = safeStorageGet(QUEUE_KEY);
      if (rawQ && payload.event === "certificate") {
        var queue = JSON.parse(rawQ);
        if (Array.isArray(queue)) {
          for (var k = 0; k < queue.length; k++) {
            if (queue[k] && queue[k].sessionId === payload.sessionId) {
              queue[k].studentName = payload.studentName;
            }
          }
          safeStorageSet(QUEUE_KEY, JSON.stringify(queue));
        }
      }
    } catch (_) {}

    broadcastEvent(payload.event, payload);
  }

  function emitPayload(payload) {
    saveEventLocally(payload);
    postToWebhook(payload);
  }

  function flushIncompleteRound(reasonStatus) {
    if (!activeRound || activeRound.completed) return;
    if (activeRound.solvedCount === 0 && activeRound.wrongCount === 0) return;
    endRound({
      gameId: activeRound.gameId,
      gameName: activeRound.gameName,
      status: reasonStatus || "Перервано (не завершено)"
    });
  }

  function startRound(opts) {
    try {
      opts = opts || {};
      var gameId = cleanText(opts.gameId || "game");
      var gameName = cleanText(opts.gameName || gameId);
      var totalQuestions = Number(opts.totalQuestions) || 0;

      if (activeRound && !activeRound.completed && (activeRound.solvedCount > 0 || activeRound.wrongCount > 0)) {
        flushIncompleteRound("Перервано (перехід)");
      }

      var started = Date.now();
      activeRound = {
        roundId: "r_" + started.toString(36) + "_" + randomCode(3).toLowerCase(),
        gameId: gameId,
        gameName: gameName,
        totalQuestions: totalQuestions,
        startedAt: started,
        firstTryCorrect: 0,
        solvedCount: 0,
        wrongCount: 0,
        mistakes: [],
        lastQKey: null,
        qAttempts: 0,
        qStartedAt: started,
        completed: false
      };
    } catch (_) {}
  }

  function recordAttempt(opts) {
    try {
      opts = opts || {};
      var gameId = cleanText(opts.gameId || (activeRound ? activeRound.gameId : "game"));
      var gameName = cleanText(opts.gameName || (activeRound && activeRound.gameId === gameId ? activeRound.gameName : gameId));

      if (!activeRound || activeRound.completed || activeRound.gameId !== gameId) {
        startRound({
          gameId: gameId,
          gameName: gameName,
          totalQuestions: Number(opts.totalQuestions) || 0
        });
      }

      var now = Date.now();
      var question = cleanText(opts.question || "");
      var qKey = gameId + "::" + cleanText(opts.questionKey !== undefined ? opts.questionKey : question);
      if (qKey !== activeRound.lastQKey) {
        activeRound.lastQKey = qKey;
        activeRound.qAttempts = 0;
        activeRound.qStartedAt = now;
      }

      activeRound.qAttempts += 1;
      var attemptNum = activeRound.qAttempts;
      var timeSec = Math.max(0, Math.round((now - activeRound.qStartedAt) / 100) / 10);
      var isCorrect = Boolean(opts.isCorrect);
      var studentAnswer = cleanText(opts.studentAnswer);
      var correctAnswer = cleanText(opts.correctAnswer);
      var explanation = cleanText(opts.explanation || "");
      var resultLabel = "";

      if (!isCorrect) {
        activeRound.wrongCount += 1;
        resultLabel = "❌ Помилка";
        activeRound.mistakes.push({
          question: question,
          studentAnswer: studentAnswer,
          correctAnswer: correctAnswer,
          explanation: explanation
        });
      } else {
        var firstTry = attemptNum === 1;
        activeRound.solvedCount += 1;
        if (firstTry) {
          activeRound.firstTryCorrect += 1;
          resultLabel = "✅ Правильно (1-ша спроба)";
        } else {
          resultLabel = "⚠️ Правильно (після помилки)";
        }
        activeRound.lastQKey = null;
      }

      var payload = {
        event: "attempt",
        eventId: "att_" + now.toString(36) + "_" + randomCode(4).toLowerCase(),
        sessionId: sessionId,
        roundId: activeRound.roundId,
        timestamp: formatTimestamp(now),
        createdAtMs: now,
        studentTag: studentTag,
        studentName: studentName,
        lessonFile: lessonInfo.file,
        lessonTitle: lessonInfo.title,
        grammar: lessonInfo.grammar,
        gameId: activeRound.gameId,
        gameName: activeRound.gameName,
        question: question,
        studentAnswer: studentAnswer,
        correctAnswer: correctAnswer,
        isCorrect: isCorrect,
        resultLabel: resultLabel,
        attemptNum: attemptNum,
        explanation: explanation,
        timeSec: timeSec
      };

      emitPayload(payload);
    } catch (_) {}
  }

  function buildMistakesSummary(mistakes) {
    if (!mistakes || mistakes.length === 0) return "Без помилок ✨";
    var parts = [];
    for (var i = 0; i < mistakes.length; i++) {
      var m = mistakes[i];
      var snippet = (i + 1) + ") " + (m.question || "Завдання");
      if (m.studentAnswer || m.correctAnswer) {
        snippet += " [обрано: «" + (m.studentAnswer || "—") + "», треба: «" + (m.correctAnswer || "—") + "»]";
      }
      parts.push(snippet);
    }
    return parts.join("; ");
  }

  function endRound(opts) {
    try {
      opts = opts || {};
      var now = Date.now();
      var gameId = cleanText(opts.gameId || (activeRound ? activeRound.gameId : "game"));
      var gameName = cleanText(opts.gameName || (activeRound && activeRound.gameName ? activeRound.gameName : gameId));

      if (!activeRound || activeRound.completed) {
        activeRound = {
          roundId: "r_" + now.toString(36) + "_" + randomCode(3).toLowerCase(),
          gameId: gameId,
          gameName: gameName,
          totalQuestions: Number(opts.totalQuestions) || 0,
          startedAt: now,
          firstTryCorrect: 0,
          solvedCount: 0,
          wrongCount: 0,
          mistakes: [],
          lastQKey: null,
          qAttempts: 0,
          qStartedAt: now,
          completed: false
        };
      }

      var total = Number(opts.totalQuestions) || activeRound.totalQuestions || activeRound.solvedCount || 1;
      var firstTry = (opts.scoreFirstTry !== undefined && opts.scoreFirstTry !== null)
        ? Number(opts.scoreFirstTry)
        : activeRound.firstTryCorrect;
      if (isNaN(firstTry) || firstTry < 0) firstTry = 0;
      if (firstTry > total) firstTry = total;

      var accuracy = total > 0 ? Math.min(100, Math.round((firstTry / total) * 100)) : 100;
      var durationSec = Math.max(1, Math.round((now - activeRound.startedAt) / 1000));
      var mistakesSummary = buildMistakesSummary(activeRound.mistakes);
      var status = cleanText(opts.status || "Завершено раунд");

      activeRound.completed = true;

      var payload = {
        event: "round_end",
        eventId: "rnd_" + activeRound.roundId,
        sessionId: sessionId,
        roundId: activeRound.roundId,
        timestamp: formatTimestamp(now),
        createdAtMs: now,
        studentTag: studentTag,
        studentName: studentName,
        lessonFile: lessonInfo.file,
        lessonTitle: lessonInfo.title,
        grammar: lessonInfo.grammar,
        gameId: gameId,
        gameName: gameName,
        status: status,
        firstTryCorrect: firstTry,
        totalQuestions: total,
        accuracy: accuracy,
        wrongCount: activeRound.wrongCount,
        durationSec: durationSec,
        mistakesSummary: mistakesSummary,
        mistakes: activeRound.mistakes.slice(0, 50)
      };

      emitPayload(payload);
    } catch (_) {}
  }

  function updateStudentNameFromCert(rawVal) {
    try {
      var cleaned = cleanText(rawVal);
      if (!cleaned) return;
      if (IGNORED_DEFAULT_NAMES[cleaned.toLowerCase()]) return;
      if (cleaned === lastSubmittedCertName) return;

      lastSubmittedCertName = cleaned;
      var displayName = studentTag ? (studentTag + " (" + cleaned + ")") : cleaned;
      studentName = displayName;

      var now = Date.now();
      emitPayload({
        event: "certificate",
        eventId: "cert_" + sessionId + "_" + now.toString(36),
        sessionId: sessionId,
        timestamp: formatTimestamp(now),
        createdAtMs: now,
        studentTag: studentTag,
        studentName: displayName,
        lessonFile: lessonInfo.file,
        lessonTitle: lessonInfo.title,
        grammar: lessonInfo.grammar
      });
    } catch (_) {}
  }

  function readElementValue(el) {
    if (!el) return "";
    if (typeof el.value === "string") return el.value;
    return el.textContent || "";
  }

  function bindCertificateElement(el) {
    if (!el || el.dataset.eslCertBound === "1") return;
    el.dataset.eslCertBound = "1";

    var handleDebounced = function () {
      if (certDebounceTimer) global.clearTimeout(certDebounceTimer);
      certDebounceTimer = global.setTimeout(function () {
        updateStudentNameFromCert(readElementValue(el));
      }, 700);
    };

    var handleImmediate = function () {
      if (certDebounceTimer) {
        global.clearTimeout(certDebounceTimer);
        certDebounceTimer = null;
      }
      updateStudentNameFromCert(readElementValue(el));
    };

    el.addEventListener("input", handleDebounced);
    el.addEventListener("change", handleImmediate);
    el.addEventListener("blur", handleImmediate);
  }

  function scanAndBindCertificateInputs() {
    try {
      if (!global.document) return;
      var selectors = [
        "#student-name-input",
        "#student-name",
        "#final-name-input",
        "#cert-name",
        "#cert-student-name",
        "#view-certificate input[type='text']",
        "#prize-view input[type='text']",
        "#certificate-view input[type='text']",
        "#certificate-screen input[type='text']",
        "#screen-certificate input[type='text']"
      ];
      var nodes = global.document.querySelectorAll(selectors.join(","));
      for (var i = 0; i < nodes.length; i++) {
        bindCertificateElement(nodes[i]);
      }
    } catch (_) {}
  }

  function flushAllCertificatesNow() {
    try {
      if (!global.document) return;
      var bound = global.document.querySelectorAll("[data-esl-cert-bound='1']");
      for (var i = 0; i < bound.length; i++) {
        updateStudentNameFromCert(readElementValue(bound[i]));
      }
    } catch (_) {}
  }

  function init() {
    scanAndBindCertificateInputs();
    if (global.document && global.document.readyState === "loading") {
      global.document.addEventListener("DOMContentLoaded", scanAndBindCertificateInputs);
    }
    global.addEventListener("beforeprint", function () {
      scanAndBindCertificateInputs();
      flushAllCertificatesNow();
    });
    global.addEventListener("pagehide", function () {
      flushAllCertificatesNow();
      flushIncompleteRound("Перервано (закрито сторінку)");
    });
  }

  init();

  global.__ESL_TRACKER__ = {
    startRound: startRound,
    recordAttempt: recordAttempt,
    endRound: endRound,
    setStudentName: updateStudentNameFromCert,
    flushIncompleteRound: flushIncompleteRound,
    getSessionId: function () { return sessionId; }
  };
})(window);
