// background.js — MV3 Service Worker (v2.1)
// Handles BULK_DOWNLOAD messages from content script.
// Receives pre-built export/download URLs (never raw Drive viewer URLs).
// Routes downloads through chrome.downloads API with staggered delays.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "BULK_DOWNLOAD") {
    handleBulkDownload(message.files, message.format || "original", sendResponse);
    return true; // Keep channel open for async response
  }

  if (message.type === "PING") {
    sendResponse({ status: "ok" });
    return false;
  }
});

/**
 * Sequentially triggers chrome.downloads for each file.
 * Uses staggered delays to avoid browser throttling.
 *
 * Each `file` object has:
 *   url      — A direct download or Google export URL (never a viewer URL).
 *   filename — Sanitized filename with appropriate extension (may be empty string).
 */
async function handleBulkDownload(files, format, sendResponse) {
  const results  = [];
  const DELAY_MS = 400; // ms between download triggers — slightly more to avoid throttling

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    try {
      const downloadId = await triggerDownload(file.url, file.filename);
      results.push({ success: true, filename: file.filename, downloadId });
    } catch (err) {
      results.push({ success: false, filename: file.filename, error: err.message });
    }

    if (i < files.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  sendResponse({ results });
}

/**
 * Wraps chrome.downloads.download in a Promise.
 *
 * URL routing:
 *  - Direct Drive binary:      https://drive.google.com/uc?export=download&id=...
 *  - Google Docs → PDF:        https://docs.google.com/document/d/.../export?format=pdf
 *  - Google Docs → DOCX:       https://docs.google.com/document/d/.../export?format=docx
 *  - Google Slides → PDF:      https://docs.google.com/presentation/d/.../export/pdf
 *  - Google Slides → PPTX:     https://docs.google.com/presentation/d/.../export/pptx
 *  - Google Sheets → PDF:      https://docs.google.com/spreadsheets/d/.../export?format=pdf
 *  - Google Sheets → XLSX:     https://docs.google.com/spreadsheets/d/.../export?format=xlsx
 *
 * All URL construction happens in content.js (buildDownloadUrl).
 * background.js simply passes the URL to chrome.downloads.
 */
function triggerDownload(url, filename) {
  return new Promise((resolve, reject) => {
    const options = {
      url,
      conflictAction: "uniquify",
    };

    if (filename && filename.trim() !== "") {
      options.filename = sanitizeFilename(filename);
    }

    chrome.downloads.download(options, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(downloadId);
      }
    });
  });
}

/**
 * Strips characters illegal in filenames across OS platforms.
 * Replaces spaces with underscores and limits total length.
 * BUG FIX: Added null/undefined guard; preserve file extension during sanitize.
 */
function sanitizeFilename(name) {
  if (!name || typeof name !== "string") return "";

  // Split extension so we don't mangle it
  const dotIdx = name.lastIndexOf(".");
  const base   = dotIdx > 0 ? name.slice(0, dotIdx) : name;
  const ext    = dotIdx > 0 ? name.slice(dotIdx)    : "";

  const cleanBase = base
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "_")
    .replace(/__+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .substring(0, 190);               // leave room for extension

  return cleanBase + ext;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
