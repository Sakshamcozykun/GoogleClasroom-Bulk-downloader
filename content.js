// content.js — Google Classroom Bulk Downloader (v2.5)
//
// New in v2.5: 
//  • SPA Caching Fix: Added `isElementVisible` checks. The extension now 
//    strictly ignores hidden DOM elements from cached/previous pages when 
//    navigating between student submissions. 
//  • Snappier URL observer integrated directly into the main DOM loop.
//
// New in v2.4:
//  • Manual light / dark theme toggle (sun/moon) in the panel header
//  • Confirmed free movement on both X and Y axes

(function () {
  "use strict";

  const TOOLBAR_ID           = "cbd-toolbar";
  const CHECKBOX_CLASS       = "cbd-checkbox";
  const OBSERVER_DEBOUNCE_MS = 700;
  const THEME_KEY            = "cbd-theme"; // "light" | "dark"

  // ── Drive / Docs URL regexes ───────────────────────────────────
  const DRIVE_FILE_VIEW_RE = /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/;
  const DRIVE_ID_PARAM_RE  = /[?&]id=([a-zA-Z0-9_-]+)/;
  const DRIVE_UC_RE        = /drive\.google\.com\/uc[?]/;
  const DOCS_RE            = /docs\.google\.com\/(document|spreadsheets|presentation|forms)\/d\/([a-zA-Z0-9_-]+)/;

  const EXCLUDE_HREF_RE = [
    /accounts\.google\.com/,
    /support\.google\.com/,
    /policies\.google\.com/,
    /drive\.google\.com\/#/,
    /drive\.google\.com\/drive\/folders/,
    /docs\.google\.com\/?$/,
    /classroom\.google\.com\/(u\/\d+\/?)?$/,
  ];

  const EXCLUDE_ANCESTOR = [
    "header", "nav",
    '[role="navigation"]',
    '[role="banner"]',
    '[role="menubar"]',
    '[aria-label="Main menu"]',
    '[aria-label="User menu"]',
    ".gb_Na",
  ];

  const FILE_TYPE_SUFFIXES = [
    "Microsoft PowerPoint","Microsoft Word","Microsoft Excel",
    "PDF","Google Slides","Google Docs","Google Sheets","Google Forms",
    "Image","Video","Audio","ZIP","Text","Folder",
  ];

  const FORMAT_OPTIONS = [
    { value: "original", label: "Original" },
    { value: "pdf",      label: "PDF"      },
    { value: "docx",     label: "DOCX"     },
    { value: "pptx",     label: "PPTX"     },
  ];

  const VALID_FORMATS = {
    doc:   ["pdf", "docx"],
    sheet: ["pdf", "xlsx"],
    slide: ["pdf", "pptx"],
    form:  ["pdf"],
    drive: [],
  };

  const ORIGINAL_EXT = {
    doc:   ".docx",
    sheet: ".xlsx",
    slide: ".pptx",
    form:  ".pdf",
    drive: "",
  };

  // ── State ───────────────────────────────────────────────────────
  let mutationObserver = null;
  let debounceTimer    = null;
  let isDownloading    = false;
  let selectedFormat   = "original";
  let dragActive       = false;
  let dragOffsetX      = 0, dragOffsetY = 0;
  let panelLeft        = null, panelTop = null;
  let currentTheme     = null; // "light" | "dark" (resolved at init)
  let lastUrl          = location.href; // Track URL for SPA resets

  let _onMouseMove = null;
  let _onMouseUp   = null;

  // ══════════════════════════════════════════════════════════════
  //  THEME
  // ══════════════════════════════════════════════════════════════

  function detectSystemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark" : "light";
  }

  function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute("data-cbd-theme", theme);
    const btn = document.getElementById("cbd-theme-btn");
    if (btn) {
      btn.textContent = theme === "dark" ? "☀" : "☾";
      btn.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    }
  }

  function loadThemePref(cb) {
    try {
      chrome.storage.local.get([THEME_KEY], (res) => {
        const stored = res && res[THEME_KEY];
        cb(stored === "light" || stored === "dark" ? stored : detectSystemTheme());
      });
    } catch (_) {
      cb(detectSystemTheme());
    }
  }

  function saveThemePref(theme) {
    try { chrome.storage.local.set({ [THEME_KEY]: theme }); } catch (_) {}
  }

  function toggleTheme() {
    const next = currentTheme === "dark" ? "light" : "dark";
    applyTheme(next);
    saveThemePref(next);
  }

  // ══════════════════════════════════════════════════════════════
  //  INIT & VISIBILITY HELPERS
  // ══════════════════════════════════════════════════════════════

  function init() {
    runInjection();
    observeDOM();
  }

  function scheduleInit(baseDelay) {
    setTimeout(() => {
      init();
      setTimeout(runInjection, baseDelay + 1200);
      setTimeout(runInjection, baseDelay + 2800);
    }, baseDelay);
  }

  loadThemePref((t) => applyTheme(t));

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => scheduleInit(500));
  } else {
    scheduleInit(500);
  }

  // FIX: Helper to ignore cached, hidden pages in the SPA
  function isElementVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // ══════════════════════════════════════════════════════════════
  //  DOM OBSERVATION (Integrated URL tracking)
  // ══════════════════════════════════════════════════════════════

  function observeDOM() {
    if (mutationObserver) mutationObserver.disconnect();
    mutationObserver = new MutationObserver(() => {
      
      // FIX: Catch SPA URL changes instantly and wipe the slate clean
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        cleanup();
        scheduleInit(200); // Restart injection snappily
        return;
      }

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runInjection, OBSERVER_DEBOUNCE_MS);
    });
    
    mutationObserver.observe(document.body, {
      childList:  true,
      subtree:    true,
      attributes: true,
      attributeFilter: ["class", "data-item-id"],
    });
  }

  function runInjection() {
    const cards = findAttachmentCards();

    if (cards.length === 0) {
      const existing = document.getElementById(TOOLBAR_ID);
      if (existing) existing.style.display = "none";
      return;
    }

    injectCheckboxes(cards);
    injectOrUpdateToolbar();

    const toolbar = document.getElementById(TOOLBAR_ID);
    if (toolbar) toolbar.style.display = "";
  }

  // ══════════════════════════════════════════════════════════════
  //  ATTACHMENT DETECTION
  // ══════════════════════════════════════════════════════════════

  function findAttachmentCards() {
    const cards  = [];
    const seenId = new Set();

    const allAnchors = Array.from(document.querySelectorAll(
      'a[href*="drive.google.com"], a[href*="docs.google.com"]'
    ));

    for (const anchor of allAnchors) {
      // FIX: Ensure we only look at links visible on the *current* page
      if (!isElementVisible(anchor)) continue;

      const url = anchor.href;
      if (!url) continue;
      if (!isDownloadableLink(url)) continue;
      if (isExcludedHref(url)) continue;
      if (isInsideExcludedAncestor(anchor)) continue;

      const fileId = extractFileId(url);
      if (!fileId) continue;
      if (seenId.has(fileId)) continue;
      seenId.add(fileId);

      const card = getCardContainer(anchor);
      if (!card) continue;

      cards.push({ anchor, card, url, fileId });
    }

    return cards;
  }

  function isDownloadableLink(url) {
    return (
      url.includes("drive.google.com/file/d/")          ||
      url.includes("drive.google.com/open")             ||
      url.includes("drive.google.com/uc")               ||
      url.includes("docs.google.com/document/d/")       ||
      url.includes("docs.google.com/spreadsheets/d/")   ||
      url.includes("docs.google.com/presentation/d/")   ||
      url.includes("docs.google.com/forms/d/")
    );
  }

  function isExcludedHref(url) {
    return EXCLUDE_HREF_RE.some((re) => re.test(url));
  }

  function isInsideExcludedAncestor(el) {
    for (const sel of EXCLUDE_ANCESTOR) {
      try { if (el.closest(sel)) return true; } catch (_) {}
    }
    return false;
  }

  function getCardContainer(anchor) {
    const candidates = [
      anchor.closest('[class*="uDqtEb"]'),
      anchor.closest('[class*="aJGgoc"]'),
      anchor.closest('[class*="YVvGBb"]'),
      anchor.closest('[class*="vwNuXb"]'),
      anchor.closest('[class*="MRmBne"]'),
      anchor.closest('[class*="yO6bme"]'),
      anchor.closest('[class*="vv5LJb"]'),
      anchor.closest("li"),
      anchor.closest('[role="listitem"]'),
      anchor.closest('[class*="card"]'),
      anchor.closest('[class*="attachment"]'),
      anchor.closest('[class*="material"]'),
      anchor.closest("div[data-item-id]"),
      anchor.parentElement,
    ];
    for (const el of candidates) {
      if (el && el !== document.body && el !== document.documentElement) return el;
    }
    return null;
  }

  // ══════════════════════════════════════════════════════════════
  //  CHECKBOX INJECTION
  // ══════════════════════════════════════════════════════════════

  function injectCheckboxes(attachmentCards) {
    attachmentCards.forEach(({ card, url, fileId, anchor }) => {
      if (card.dataset.cbdInjected) return;
      card.dataset.cbdInjected = "true";

      const computed = getComputedStyle(card);
      if (computed.position === "static") card.style.position = "relative";

      const wrapper       = document.createElement("label");
      wrapper.className   = "cbd-checkbox-label";
      wrapper.title       = "Select for download";

      const checkbox               = document.createElement("input");
      checkbox.type                = "checkbox";
      checkbox.className           = CHECKBOX_CLASS;
      checkbox.dataset.url         = url;
      checkbox.dataset.fileId      = fileId;
      checkbox.dataset.docType     = getDocType(url);
      checkbox.dataset.filename    = deriveFilename(anchor, url);

      checkbox.addEventListener("click",  (e) => e.stopPropagation());
      checkbox.addEventListener("change", updateToolbarState);

      const checkmark     = document.createElement("span");
      checkmark.className = "cbd-checkmark";

      wrapper.appendChild(checkbox);
      wrapper.appendChild(checkmark);
      card.appendChild(wrapper);
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  FILE ID EXTRACTION
  // ══════════════════════════════════════════════════════════════

  function extractFileId(url) {
    if (!url) return null;
    let m = url.match(DRIVE_FILE_VIEW_RE);
    if (m) return m[1];
    m = url.match(DOCS_RE);
    if (m) return m[2];
    m = url.match(DRIVE_ID_PARAM_RE);
    if (m) return m[1];
    if (DRIVE_UC_RE.test(url)) {
      m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (m) return m[1];
    }
    return null;
  }

  function getDocType(url) {
    if (!url) return "drive";
    if (url.includes("docs.google.com/document"))     return "doc";
    if (url.includes("docs.google.com/spreadsheets")) return "sheet";
    if (url.includes("docs.google.com/presentation")) return "slide";
    if (url.includes("docs.google.com/forms"))        return "form";
    return "drive";
  }

  // ══════════════════════════════════════════════════════════════
  //  EXPORT URL BUILDER
  // ══════════════════════════════════════════════════════════════

  function buildDownloadUrl(fileId, docType, format) {
    if (docType === "drive") {
      return `https://drive.google.com/uc?export=download&id=${fileId}`;
    }

    const appPath = {
      doc:   "document",
      sheet: "spreadsheets",
      slide: "presentation",
      form:  "forms",
    }[docType];

    let exportFormat = format;

    if (format === "original") {
      exportFormat = { doc: "docx", sheet: "xlsx", slide: "pptx", form: "pdf" }[docType];
    } else {
      const valid = VALID_FORMATS[docType] || [];
      if (!valid.includes(format)) {
        exportFormat = "pdf";
      }
    }

    const base = `https://docs.google.com/${appPath}/d/${fileId}`;

    if (docType === "slide") {
      return `${base}/export/${exportFormat}`;
    }
    return `${base}/export?format=${exportFormat}`;
  }

  function buildFilename(rawName, docType, format) {
    if (!rawName) return "";

    if (docType === "drive") {
      return rawName.trim();
    }

    const base = rawName.replace(/\.[a-zA-Z0-9]{1,5}$/, "").trim();
    if (!base) return "";

    let ext;
    if (format === "original") {
      ext = ORIGINAL_EXT[docType] || "";
    } else {
      const valid = VALID_FORMATS[docType] || [];
      const resolvedFormat = valid.includes(format) ? format : "pdf";
      ext = ({
        pdf:  ".pdf",
        docx: ".docx",
        pptx: ".pptx",
        xlsx: ".xlsx",
      })[resolvedFormat] || "";
    }

    return base + ext;
  }

  // ══════════════════════════════════════════════════════════════
  //  TOOLBAR
  // ══════════════════════════════════════════════════════════════

  function injectOrUpdateToolbar() {
    let toolbar = document.getElementById(TOOLBAR_ID);
    if (!toolbar) {
      toolbar = buildToolbar();
      document.body.appendChild(toolbar);
      // Re-apply theme so the new button picks up the icon/title
      if (currentTheme) applyTheme(currentTheme);
    }
    updateToolbarState();
  }

  function buildToolbar() {
    const toolbar = document.createElement("div");
    toolbar.id = TOOLBAR_ID;

    const fmtOptions = FORMAT_OPTIONS
      .map((f) => `<option value="${f.value}"${f.value === selectedFormat ? " selected" : ""}>${f.label}</option>`)
      .join("");

    toolbar.innerHTML = `
      <div class="cbd-drag-handle" id="cbd-drag-handle">
        <span class="cbd-drag-dots" aria-hidden="true">⠿</span>
        <span class="cbd-panel-title">Bulk Download</span>
        <button class="cbd-icon-btn" id="cbd-theme-btn" title="Toggle theme" aria-label="Toggle theme">☾</button>
        <button class="cbd-icon-btn" id="cbd-collapse-btn" title="Collapse" aria-label="Collapse">−</button>
      </div>
      <div class="cbd-panel-body" id="cbd-panel-body">
        <label class="cbd-select-all-label">
          <input type="checkbox" id="cbd-select-all" class="${CHECKBOX_CLASS}" />
          <span class="cbd-checkmark"></span>
          <span class="cbd-label-text">Select All</span>
        </label>
        <span class="cbd-count-badge" id="cbd-count">0 of 0 files</span>
        <div class="cbd-format-row">
          <label class="cbd-format-label" for="cbd-format-select">Format</label>
          <select class="cbd-format-select" id="cbd-format-select">${fmtOptions}</select>
        </div>
        <p class="cbd-format-hint">
          Native Google Docs, Sheets &amp; Slides convert perfectly. Files the teacher uploaded (PDF, PPTX, etc.) keep their original format.
        </p>
        <div class="cbd-btn-row">
          <button class="cbd-btn cbd-btn-secondary" id="cbd-clear-btn">Clear</button>
          <button class="cbd-btn cbd-btn-primary" id="cbd-download-btn" disabled>⬇ Download</button>
        </div>
        <div class="cbd-progress-bar" id="cbd-progress-bar">
          <div class="cbd-progress-fill" id="cbd-progress-fill"></div>
        </div>
        <span class="cbd-status" id="cbd-status"></span>
      </div>
    `;

    toolbar.querySelector("#cbd-collapse-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const body     = toolbar.querySelector("#cbd-panel-body");
      const btn      = toolbar.querySelector("#cbd-collapse-btn");
      const isHidden = body.style.display === "none";
      body.style.display = isHidden ? "" : "none";
      btn.textContent    = isHidden ? "−" : "+";
    });

    toolbar.querySelector("#cbd-theme-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleTheme();
    });
    // Prevent drag from starting on the theme/collapse buttons
    toolbar.querySelector("#cbd-theme-btn").addEventListener("mousedown", (e) => e.stopPropagation());

    toolbar.querySelector("#cbd-select-all").addEventListener("change", (e) =>
      toggleSelectAll(e.target.checked)
    );
    toolbar.querySelector("#cbd-download-btn").addEventListener("click", startDownload);
    toolbar.querySelector("#cbd-clear-btn").addEventListener("click", clearSelection);
    toolbar.querySelector("#cbd-format-select").addEventListener("change", (e) => {
      selectedFormat = e.target.value;
    });

    attachDragHandlers(toolbar);

    if (panelLeft !== null && panelTop !== null) {
      toolbar.style.right = "auto";
      toolbar.style.left  = `${panelLeft}px`;
      toolbar.style.top   = `${panelTop}px`;
    }

    return toolbar;
  }

  // ── Drag (free movement on both X and Y axes) ─────────────────

  function attachDragHandlers(toolbar) {
    const handle = toolbar.querySelector("#cbd-drag-handle");
    if (!handle) return;

    if (_onMouseMove) document.removeEventListener("mousemove", _onMouseMove);
    if (_onMouseUp)   document.removeEventListener("mouseup",   _onMouseUp);

    handle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      // Don't start a drag when clicking on the header buttons
      if (e.target.closest(".cbd-icon-btn")) return;
      e.preventDefault();
      const rect  = toolbar.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      toolbar.style.right  = "auto";
      toolbar.style.bottom = "auto";
      toolbar.style.left   = `${rect.left}px`;
      toolbar.style.top    = `${rect.top}px`;
      dragActive = true;
      toolbar.classList.add("cbd-dragging");
    });

    _onMouseMove = (e) => {
      if (!dragActive) return;
      const t = document.getElementById(TOOLBAR_ID);
      if (!t) return;
      // Free movement on BOTH axes, clamped to viewport
      const l  = Math.max(0, Math.min(e.clientX - dragOffsetX, window.innerWidth  - t.offsetWidth));
      const tp = Math.max(0, Math.min(e.clientY - dragOffsetY, window.innerHeight - t.offsetHeight));
      t.style.left = `${l}px`;
      t.style.top  = `${tp}px`;
      panelLeft = l; panelTop = tp;
    };

    _onMouseUp = () => {
      if (!dragActive) return;
      dragActive = false;
      const t = document.getElementById(TOOLBAR_ID);
      if (t) t.classList.remove("cbd-dragging");
    };

    document.addEventListener("mousemove", _onMouseMove);
    document.addEventListener("mouseup",   _onMouseUp);
  }

  // ══════════════════════════════════════════════════════════════
  //  TOOLBAR STATE
  // ══════════════════════════════════════════════════════════════

  function updateToolbarState() {
    const toolbar = document.getElementById(TOOLBAR_ID);
    if (!toolbar) return;

    const all      = getFileCheckboxes();
    const selected = all.filter((cb) => cb.checked);

    toolbar.querySelector("#cbd-count").textContent =
      `${selected.length} of ${all.length} file${all.length !== 1 ? "s" : ""}`;
    toolbar.querySelector("#cbd-download-btn").disabled =
      selected.length === 0 || isDownloading;

    const sa = toolbar.querySelector("#cbd-select-all");
    if      (selected.length === 0)          { sa.checked = false; sa.indeterminate = false; }
    else if (selected.length === all.length) { sa.checked = true;  sa.indeterminate = false; }
    else                                     { sa.checked = false; sa.indeterminate = true;  }
  }

  function toggleSelectAll(checked) {
    getFileCheckboxes().forEach((cb) => (cb.checked = checked));
    updateToolbarState();
  }

  function clearSelection() {
    getFileCheckboxes().forEach((cb) => (cb.checked = false));
    updateToolbarState();
    setStatus("");
  }

  function getFileCheckboxes() {
    return Array.from(
      document.querySelectorAll(`.${CHECKBOX_CLASS}:not(#cbd-select-all)`)
    // FIX: Ensure we only count checkboxes that belong to visible cards
    ).filter((cb) => isElementVisible(cb)); 
  }

  // ══════════════════════════════════════════════════════════════
  //  DOWNLOAD
  // ══════════════════════════════════════════════════════════════

  async function startDownload() {
    if (isDownloading) return;
    const selected = getFileCheckboxes().filter((cb) => cb.checked);
    if (selected.length === 0) return;

    isDownloading = true;
    updateToolbarState();

    const files = selected.map((cb) => ({
      url:      buildDownloadUrl(cb.dataset.fileId, cb.dataset.docType, selectedFormat),
      filename: buildFilename(cb.dataset.filename || "", cb.dataset.docType, selectedFormat),
    }));

    showProgress(0, files.length);
    setStatus(`Preparing ${files.length} file${files.length !== 1 ? "s" : ""}…`);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "BULK_DOWNLOAD", files, format: selectedFormat,
      });

      if (response?.results) {
        const ok   = response.results.filter((r) =>  r.success).length;
        const fail = response.results.filter((r) => !r.success).length;
        showProgress(files.length, files.length);
        setStatus(
          fail === 0 ? `✅ ${ok} sent to Downloads!` : `⚠️ ${ok} ok, ${fail} failed`,
          fail === 0 ? "success" : "warning"
        );
      } else {
        setStatus("❌ No response from background.", "error");
      }
    } catch (err) {
      setStatus(`❌ ${err.message}`, "error");
    } finally {
      isDownloading = false;
      updateToolbarState();
      setTimeout(hideProgress, 3000);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  FILENAME DERIVATION
  // ══════════════════════════════════════════════════════════════

  function deriveFilename(anchor, url) {
    const aria = anchor.getAttribute("aria-label");
    if (aria) { const c = stripFiletypeSuffix(aria.trim()); if (c) return c; }

    for (const sel of ['[class*="title"]','[class*="name"]','span:first-child','div:first-child']) {
      const el = anchor.querySelector(sel);
      if (!el) continue;
      const t = getOwnText(el).trim();
      if (t.length > 1) { const c = stripFiletypeSuffix(t); if (c) return c; }
    }

    const titleAttr = anchor.getAttribute("title") || anchor.getAttribute("data-tooltip");
    if (titleAttr) { const c = stripFiletypeSuffix(titleAttr.trim()); if (c) return c; }

    for (const n of anchor.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) {
        const t = n.textContent.trim();
        if (t.length > 1 && !isFiletypeSuffix(t)) return t;
      }
    }

    try {
      const parts = new URL(url).pathname.split("/").filter(Boolean);
      const last  = parts[parts.length - 1];
      if (last && last.length > 3 && last !== "view" && last !== "edit")
        return decodeURIComponent(last);
    } catch (_) {}

    return "";
  }

  function getOwnText(el) {
    let t = "";
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) t += n.textContent;
    }
    return t;
  }

  function stripFiletypeSuffix(name) {
    let r = name;
    for (const s of FILE_TYPE_SUFFIXES)
      r = r.replace(new RegExp(`\\s*${escapeRe(s)}\\s*$`, "i"), "").trim();
    return r;
  }

  function isFiletypeSuffix(text) {
    return FILE_TYPE_SUFFIXES.some((s) => s.toLowerCase() === text.toLowerCase());
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // ══════════════════════════════════════════════════════════════
  //  PROGRESS & STATUS
  // ══════════════════════════════════════════════════════════════

  function showProgress(current, total) {
    const bar  = document.getElementById("cbd-progress-bar");
    const fill = document.getElementById("cbd-progress-fill");
    if (!bar || !fill) return;
    bar.style.display = "block";
    fill.style.width  = total > 0 ? `${Math.round((current / total) * 100)}%` : "0%";
  }

  function hideProgress() {
    const el = document.getElementById("cbd-progress-bar");
    if (el) el.style.display = "none";
  }

  function setStatus(msg, type = "") {
    const el = document.getElementById("cbd-status");
    if (!el) return;
    el.textContent = msg;
    el.className   = `cbd-status${type ? ` cbd-status--${type}` : ""}`;
  }

  // ══════════════════════════════════════════════════════════════
  //  CLEANUP
  // ══════════════════════════════════════════════════════════════

  function cleanup() {
    if (mutationObserver) { mutationObserver.disconnect(); mutationObserver = null; }
    clearTimeout(debounceTimer);

    if (_onMouseMove) { document.removeEventListener("mousemove", _onMouseMove); _onMouseMove = null; }
    if (_onMouseUp)   { document.removeEventListener("mouseup",   _onMouseUp);   _onMouseUp   = null; }

    document.getElementById(TOOLBAR_ID)?.remove();
    document.querySelectorAll("[data-cbd-injected]").forEach((el) => {
      delete el.dataset.cbdInjected;
    });
    document.querySelectorAll(".cbd-checkbox-label").forEach((el) => el.remove());
    isDownloading = false;
  }

})();