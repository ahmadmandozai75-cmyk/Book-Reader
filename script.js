/* =========================================================
   Ahmad Mandozai's Book Reader — script.js
   100% offline: uses the local pdf.js build (./lib) for PDF
   parsing and the browser's built-in Web Speech API for
   text-to-speech. No network requests are made anywhere.
   ========================================================= */

(function () {
  "use strict";

  /* ---------- point pdf.js at the local worker file ---------- */
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "./lib/pdf.worker.min.js";
  }

  /* ---------- element references ---------- */
  const pasteArea = document.getElementById("pasteArea");
  const loadPastedText = document.getElementById("loadPastedText");
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  const fileStatus = document.getElementById("fileStatus");

  const langSelect = document.getElementById("langSelect");
  const voiceSelect = document.getElementById("voiceSelect");
  const voiceStatus = document.getElementById("voiceStatus");
  const rateRange = document.getElementById("rateRange");
  const rateValue = document.getElementById("rateValue");
  const fontSizeRange = document.getElementById("fontSizeRange");
  const fontSizeValue = document.getElementById("fontSizeValue");

  const bookPage = document.getElementById("bookPage");
  const placeholderText = document.getElementById("placeholderText");
  const bookContent = document.getElementById("bookContent");
  const wordCountEl = document.getElementById("wordCount");
  const readTimeEl = document.getElementById("readTime");
  const pageIndicatorEl = document.getElementById("pageIndicator");
  const bookmarkBtn = document.getElementById("bookmarkBtn");
  const exportBtn = document.getElementById("exportBtn");

  const playBtn = document.getElementById("playBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const stopBtn = document.getElementById("stopBtn");
  const progressFill = document.getElementById("progressFill");
  const progressPct = document.getElementById("progressPct");
  const darkModeToggle = document.getElementById("darkModeToggle");

  /* ---------- app state ---------- */
  const STORAGE_KEY = "ambr_last_book_v1"; // Ahmad Mandozai Book Reader
  let sentences = [];        // array of { text, startWord, endWord }
  let words = [];            // array of { el, sentenceIndex }
  let currentSentence = 0;   // index into `sentences` currently queued/spoken
  let isPlaying = false;
  let isPaused = false;
  let voices = [];
  let estimatedFallbackTimer = null;

  /* =========================================================
     1. LANGUAGE DETECTION + RTL HANDLING
     ========================================================= */

  // Characters that appear in Pashto but essentially never in Persian.
  const PASHTO_ONLY = /[ښړډټڼځږۍئ]/;
  const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

  function detectLanguage(text) {
    const sample = text.slice(0, 800);
    if (!ARABIC_SCRIPT.test(sample)) return "en";
    return PASHTO_ONLY.test(sample) ? "ps" : "fa";
  }

  function applyDirection(langCode) {
    const rtl = langCode === "ps" || langCode === "fa";
    bookPage.dir = rtl ? "rtl" : "ltr";
    bookPage.lang = langCode;
  }

  /* =========================================================
     2. TEXT -> BOOK RENDERING (sentence + word spans)
     ========================================================= */

  // Splits on sentence-ending punctuation for Latin & Arabic-script text
  // (۔ and ؟ are used in Pashto/Persian/Urdu-influenced writing).
  const SENTENCE_SPLIT_RE = /([^.!?؟۔]+[.!?؟۔]+|\S[^.!?؟۔]*$)/g;

  function splitSentences(text) {
    const matches = text.match(SENTENCE_SPLIT_RE);
    if (!matches) return text.trim() ? [text.trim()] : [];
    return matches.map((s) => s.trim()).filter(Boolean);
  }

  function renderBook(text) {
    bookContent.innerHTML = "";
    sentences = [];
    words = [];

    const rawSentences = splitSentences(text);
    let wordCounter = 0;

    rawSentences.forEach((sentenceText, sIndex) => {
      const sentenceSpan = document.createElement("span");
      sentenceSpan.className = "sentence";
      sentenceSpan.dataset.index = String(sIndex);

      // Split into tokens, keeping whitespace so re-joining is exact.
      const tokens = sentenceText.split(/(\s+)/);
      const startWord = wordCounter;

      tokens.forEach((tok) => {
        if (tok === "") return;
        if (/^\s+$/.test(tok)) {
          sentenceSpan.appendChild(document.createTextNode(tok));
          return;
        }
        const wordSpan = document.createElement("span");
        wordSpan.className = "word";
        wordSpan.dataset.index = String(wordCounter);
        wordSpan.dataset.sentence = String(sIndex);
        wordSpan.textContent = tok;
        sentenceSpan.appendChild(wordSpan);
        words.push({ el: wordSpan, sentenceIndex: sIndex });
        wordCounter++;
      });

      sentenceSpan.appendChild(document.createTextNode(" "));
      bookContent.appendChild(sentenceSpan);

      sentences.push({
        text: sentenceText,
        startWord,
        endWord: wordCounter - 1,
      });
    });

    placeholderText.hidden = true;
    bookContent.hidden = false;
    updateStats(text);
    resetPlaybackUI();
  }

  function updateStats(text) {
    const wc = (text.match(/\S+/g) || []).length;
    wordCountEl.textContent = `${wc} word${wc === 1 ? "" : "s"}`;
    const minutes = Math.max(1, Math.round(wc / 180));
    readTimeEl.textContent = `${minutes} min read`;
    pageIndicatorEl.textContent = "Page 1";
  }

  /* =========================================================
     3. INPUT: paste / upload / drag-drop
     ========================================================= */

  let fullText = "";
  let currentLang = "en";

  function loadText(text, { restoreLang } = {}) {
    fullText = text;
    currentLang = restoreLang || detectLanguage(text);
    langSelect.value = currentLang;
    applyDirection(currentLang);
    renderBook(text);
    populateVoiceList(); // re-filter voices for the (possibly new) language
  }

  loadPastedText.addEventListener("click", () => {
    const text = pasteArea.value.trim();
    if (!text) return;
    loadText(text);
    saveProgress(0);
  });

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") fileInput.click();
  });
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) handleFile(fileInput.files[0]);
  });

  function handleFile(file) {
    const name = file.name.toLowerCase();
    fileStatus.textContent = `Loading "${file.name}"…`;

    if (name.endsWith(".txt")) {
      const reader = new FileReader();
      reader.onload = () => {
        loadText(reader.result);
        fileStatus.textContent = `Loaded "${file.name}".`;
        saveProgress(0);
      };
      reader.onerror = () => {
        fileStatus.textContent = "Could not read that text file.";
      };
      reader.readAsText(file);
    } else if (name.endsWith(".pdf")) {
      if (!window.pdfjsLib) {
        fileStatus.textContent =
          "PDF engine not found. Make sure lib/pdf.min.js and lib/pdf.worker.min.js are present.";
        return;
      }
      const reader = new FileReader();
      reader.onload = () => extractPdfText(reader.result, file.name);
      reader.onerror = () => {
        fileStatus.textContent = "Could not read that PDF file.";
      };
      reader.readAsArrayBuffer(file);
    } else {
      fileStatus.textContent = "Please upload a .txt or .pdf file.";
    }
  }

  async function extractPdfText(arrayBuffer, name) {
    try {
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let text = "";
      for (let p = 1; p <= pdf.numPages; p++) {
        fileStatus.textContent = `Reading page ${p} of ${pdf.numPages}…`;
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const pageText = content.items.map((it) => it.str).join(" ");
        text += pageText + "\n\n";
      }
      if (!text.trim()) {
        fileStatus.textContent =
          "No selectable text found in this PDF (it may be a scanned image).";
        return;
      }
      loadText(text.trim());
      fileStatus.textContent = `Loaded "${name}" (${pdf.numPages} page${pdf.numPages === 1 ? "" : "s"}).`;
      saveProgress(0);
    } catch (err) {
      console.error(err);
      fileStatus.textContent = "Failed to parse PDF: " + err.message;
    }
  }

  langSelect.addEventListener("change", () => {
    currentLang = langSelect.value;
    applyDirection(currentLang);
    populateVoiceList();
  });

  /* =========================================================
     4. VOICES
     ========================================================= */

  function populateVoiceList() {
    if (!("speechSynthesis" in window)) {
      voiceStatus.textContent = "Speech synthesis is not supported in this browser.";
      return;
    }
    voices = speechSynthesis.getVoices();
    const prefixMap = { en: "en", ps: "ps", fa: "fa" };
    const wantedPrefix = prefixMap[currentLang] || "en";

    let matches = voices.filter((v) => v.lang.toLowerCase().startsWith(wantedPrefix));

    voiceSelect.innerHTML = "";
    if (matches.length === 0) {
      voiceStatus.textContent =
        currentLang === "en"
          ? "No English voice found on this device."
          : `No installed voice for this language. Falling back to the system default. ` +
            `Install an offline "${currentLang === "ps" ? "Pashto" : "Persian"}" voice pack ` +
            `in your OS/browser settings for native narration.`;
      matches = voices.length ? voices : [];
    } else {
      voiceStatus.textContent = `${matches.length} voice${matches.length === 1 ? "" : "s"} available.`;
    }

    if (matches.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "No voices installed";
      voiceSelect.appendChild(opt);
      return;
    }

    matches.forEach((v, i) => {
      const opt = document.createElement("option");
      opt.value = String(voices.indexOf(v));
      opt.textContent = `${v.name} (${v.lang})${v.default ? " — default" : ""}`;
      voiceSelect.appendChild(opt);
    });
  }

  if ("speechSynthesis" in window) {
    speechSynthesis.onvoiceschanged = populateVoiceList;
  }

  /* =========================================================
     5. SPEECH PLAYBACK + REAL-TIME HIGHLIGHTING
     ========================================================= */

  function clearHighlights() {
    document.querySelectorAll(".word.current-word").forEach((el) => el.classList.remove("current-word"));
    document.querySelectorAll(".sentence.current-sentence").forEach((el) => el.classList.remove("current-sentence"));
  }

  function highlightWord(sentenceIndex, wordIndexInSentence) {
    clearHighlights();
    const s = sentences[sentenceIndex];
    if (!s) return;
    const sentenceEl = bookContent.querySelector(`.sentence[data-index="${sentenceIndex}"]`);
    if (sentenceEl) sentenceEl.classList.add("current-sentence");

    const globalIndex = s.startWord + wordIndexInSentence;
    const wordObj = words[globalIndex];
    if (wordObj) {
      wordObj.el.classList.add("current-word");
      wordObj.el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function updateProgressBar() {
    const total = sentences.length || 1;
    const pct = Math.min(100, Math.round((currentSentence / total) * 100));
    progressFill.style.width = pct + "%";
    progressPct.textContent = pct + "%";
  }

  function getSelectedVoice() {
    const idx = voiceSelect.value;
    if (idx === "" || idx == null || !voices[idx]) return null;
    return voices[idx];
  }

  function speakSentence(index) {
    if (index >= sentences.length) {
      stopPlayback(true);
      return;
    }
    currentSentence = index;
    updateProgressBar();
    saveProgress(index);

    const sentenceText = sentences[index].text;
    const utter = new SpeechSynthesisUtterance(sentenceText);
    const voice = getSelectedVoice();
    if (voice) utter.voice = voice;
    utter.rate = parseFloat(rateRange.value);
    utter.lang = voice ? voice.lang : currentLang;

    let gotBoundary = false;
    let fallbackWordTimer = null;

    // Word-level highlighting via the browser's boundary event, when supported.
    utter.onboundary = (event) => {
      if (event.name && event.name !== "word") return;
      gotBoundary = true;
      if (fallbackWordTimer) clearInterval(fallbackWordTimer);
      const charIndex = event.charIndex || 0;
      const wordIdx = charIndexToWordIndex(sentenceText, charIndex);
      highlightWord(index, wordIdx);
    };

    utter.onstart = () => {
      // If the engine never fires a boundary event (some browsers/voices
      // don't support it), fall back to an even, time-estimated highlight
      // so the reading experience still stays roughly in sync.
      setTimeout(() => {
        if (!gotBoundary) startEstimatedHighlight(index, sentenceText, utter.rate);
      }, 350);
    };

    utter.onend = () => {
      if (fallbackWordTimer) clearInterval(fallbackWordTimer);
      if (estimatedFallbackTimer) clearInterval(estimatedFallbackTimer);
      if (isPlaying && !isPaused) speakSentence(index + 1);
    };

    utter.onerror = (e) => {
      console.error("Speech error:", e);
      if (isPlaying && !isPaused) speakSentence(index + 1);
    };

    speechSynthesis.speak(utter);
  }

  // Time-based fallback: evenly distribute the sentence's words across
  // its estimated speaking duration.
  function startEstimatedHighlight(sentenceIndex, sentenceText, rate) {
    const wordList = sentenceText.split(/\s+/).filter(Boolean);
    if (!wordList.length) return;
    const msPerWord = 350 / Math.max(rate, 0.1);
    let i = 0;
    highlightWord(sentenceIndex, 0);
    estimatedFallbackTimer = setInterval(() => {
      i++;
      if (i >= wordList.length) {
        clearInterval(estimatedFallbackTimer);
        return;
      }
      highlightWord(sentenceIndex, i);
    }, msPerWord);
  }

  function charIndexToWordIndex(sentenceText, charIndex) {
    // Text before charIndex contains exactly the words that precede the
    // word currently being spoken, so its word count is that word's index.
    const upTo = sentenceText.slice(0, charIndex);
    return upTo.split(/\s+/).filter(Boolean).length;
  }

  function startPlayback(fromSentence) {
    if (!("speechSynthesis" in window)) {
      alert("Speech synthesis is not supported in this browser.");
      return;
    }
    if (!sentences.length) return;
    speechSynthesis.cancel();
    isPlaying = true;
    isPaused = false;
    playBtn.textContent = "▶ Playing…";
    playBtn.disabled = true;
    pauseBtn.disabled = false;
    stopBtn.disabled = false;
    speakSentence(fromSentence != null ? fromSentence : currentSentence);
  }

  function stopPlayback(finished) {
    speechSynthesis.cancel();
    if (estimatedFallbackTimer) clearInterval(estimatedFallbackTimer);
    isPlaying = false;
    isPaused = false;
    clearHighlights();
    resetPlaybackUI();
    if (finished) {
      currentSentence = 0;
      progressFill.style.width = "100%";
      progressPct.textContent = "100%";
    }
  }

  function resetPlaybackUI() {
    playBtn.textContent = "▶ Play";
    playBtn.disabled = false;
    pauseBtn.textContent = "⏸ Pause";
    pauseBtn.disabled = true;
    stopBtn.disabled = true;
  }

  playBtn.addEventListener("click", () => startPlayback(currentSentence));

  pauseBtn.addEventListener("click", () => {
    if (!isPlaying) return;
    if (!isPaused) {
      speechSynthesis.pause();
      isPaused = true;
      pauseBtn.textContent = "▶ Resume";
    } else {
      speechSynthesis.resume();
      isPaused = false;
      pauseBtn.textContent = "⏸ Pause";
    }
  });

  stopBtn.addEventListener("click", () => stopPlayback(false));

  rateRange.addEventListener("input", () => {
    rateValue.textContent = parseFloat(rateRange.value).toFixed(1) + "x";
  });

  /* =========================================================
     6. FONT SIZE + DARK MODE
     ========================================================= */

  fontSizeRange.addEventListener("input", () => {
    const size = fontSizeRange.value + "px";
    bookPage.style.fontSize = size;
    fontSizeValue.textContent = size;
  });

  darkModeToggle.addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    document.documentElement.setAttribute("data-theme", isDark ? "light" : "dark");
    localStorage.setItem("ambr_theme", isDark ? "light" : "dark");
  });

  (function restoreTheme() {
    const saved = localStorage.getItem("ambr_theme");
    if (saved === "dark") document.documentElement.setAttribute("data-theme", "dark");
  })();

  /* =========================================================
     7. PROGRESS PERSISTENCE (localStorage) + RESUME
     ========================================================= */

  function saveProgress(sentenceIndex) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          text: fullText,
          lang: currentLang,
          sentenceIndex,
          fontSize: fontSizeRange.value,
          savedAt: Date.now(),
        })
      );
    } catch (e) {
      /* storage full or unavailable — non-fatal */
    }
  }

  bookmarkBtn.addEventListener("click", () => {
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch (e) {
      saved = null;
    }
    if (!saved || !saved.text) {
      alert("No saved reading position yet. Load some text and start reading first.");
      return;
    }
    loadText(saved.text, { restoreLang: saved.lang });
    currentSentence = saved.sentenceIndex || 0;
    fontSizeRange.value = saved.fontSize || 20;
    bookPage.style.fontSize = fontSizeRange.value + "px";
    fontSizeValue.textContent = fontSizeRange.value + "px";
    if (sentences[currentSentence]) {
      highlightWord(currentSentence, 0);
      updateProgressBar();
    }
  });

  /* =========================================================
     8. EXPORT
     ========================================================= */

  exportBtn.addEventListener("click", () => {
    if (!fullText) {
      alert("Nothing to export yet.");
      return;
    }
    const blob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "book-reader-export.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  /* =========================================================
     9. KEYBOARD SHORTCUTS
     ========================================================= */

  document.addEventListener("keydown", (e) => {
    if (e.target === pasteArea) return; // don't hijack typing
    if (e.code === "Space") {
      e.preventDefault();
      if (!isPlaying) {
        startPlayback(currentSentence);
      } else {
        pauseBtn.click();
      }
    }
  });

  /* ---------- initial voice population ---------- */
  populateVoiceList();
})();
