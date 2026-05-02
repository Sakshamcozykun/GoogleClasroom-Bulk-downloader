// background.js — MV3 Service Worker (v2.3 — Header Fix)
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

async function handleBulkDownload(files, format, sendResponse) {
  const results  = [];
  const DELAY_MS = 400;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    try {
      // Pre-flight HEAD check to catch 403/404 before handing to chrome.downloads.
      // This gives us the actual HTTP status instead of a generic "Failed" message.
      let preflightError = null;
      try {
        const probe = await fetch(file.url, { method: "HEAD", credentials: "include" });
        if (!probe.ok) {
          preflightError = `HTTP ${probe.status} ${probe.statusText} — ${file.url}`;
        }
      } catch (fetchErr) {
        // Network error on preflight — still attempt the download, may work
        console.warn("[CBD] Preflight failed (non-fatal):", fetchErr.message);
      }

      if (preflightError) {
        results.push({ success: false, filename: file.filename, error: preflightError });
      } else {
        const downloadId = await triggerDownload(file.url, file.filename);
        results.push({ success: true, filename: file.filename, downloadId });
      }
    } catch (err) {
      results.push({ success: false, filename: file.filename, error: err.message });
    }

    if (i < files.length - 1) await sleep(DELAY_MS);
  }

  sendResponse({ results });
}

function triggerDownload(url, filename) {
  return new Promise((resolve, reject) => {
    // FIX: Removed the illegal "Sec-Fetch-Site" header. Chrome downloads 
    // will now handle cookies natively, and the authuser URL parameter 
    // from content.js will route it to the correct Google account.
    const options = {
      url,
      conflictAction: "uniquify"
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

function sanitizeFilename(name) {
  if (!name || typeof name !== "string") return "";

  const dotIdx = name.lastIndexOf(".");
  const base   = dotIdx > 0 ? name.slice(0, dotIdx) : name;
  const ext    = dotIdx > 0 ? name.slice(dotIdx)    : "";

  const cleanBase = base
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "_")
    .replace(/__+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .substring(0, 190);

  return cleanBase + ext;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
