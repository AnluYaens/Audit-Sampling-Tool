import { saveUploadPayload } from "./storage.js";

/**
 * CSV Upload & Preview utilities for audit workflows.
 *
 * Purpose: Let auditors quickly validate file structure before deeper work
 * (sampling, anomaly detection). We parse locally, preview a safe subset,
 * and provide gentle hints so fixes happen early.
 *
 * Design choices:
 * - Simple, deterministic parsing: no dependency drift, same behavior in QA/Prod.
 * - Delimiter detection checks outside quotes to reflect real-world data.
 * - DOM preview is capped to keep the UI responsive on large files.
 */

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const PREVIEW_ROW_CAP = 200;
const META_SEPARATOR = "\u0007";
const UPLOAD_PROGRESS_MIN_VISIBLE_MS = 4200;
const UPLOAD_PROGRESS_ENTRANCE_MS = 1200;

let uploadProgressTrack = null;
let uploadProgressTimer = null;
let uploadProgressVisibleAt = 0;

function getUploadProgressTrack() {
  if (uploadProgressTrack) return uploadProgressTrack;
  uploadProgressTrack = document.getElementById("upload-progress");
  return uploadProgressTrack;
}

function animateProgressBar() {
  const track = getUploadProgressTrack();
  if (!track) return;
  const bar = track.querySelector("span");
  if (!bar) return;
  bar.style.transition = "none";
  bar.style.width = "0%";
  // Force layout so the width reset takes effect before animating.
  void bar.offsetWidth;
  bar.style.transition = "width 3s cubic-bezier(0.4, 0, 0.2, 1)";
  bar.style.width = "100%";
}

function showUploadProgress() {
  const track = getUploadProgressTrack();
  if (!track) return;
  track.classList.add("is-active");
  track.setAttribute("aria-hidden", "false");
  animateProgressBar();
  uploadProgressVisibleAt = Date.now();
  clearTimeout(uploadProgressTimer);
}

function hideUploadProgress(immediate = false) {
  const track = getUploadProgressTrack();
  if (!track || !track.classList.contains("is-active")) {
    track.setAttribute("aria-hidden", "true");
    return;
  }
  const finish = () => {
    track.classList.remove("is-active");
    const bar = track.querySelector("span");
    if (bar) {
      bar.style.transition = "none";
      bar.style.width = "0%";
    }
    track.setAttribute("aria-hidden", "true");
  };
  if (immediate) {
    finish();
    return;
  }
  const elapsed = Date.now() - uploadProgressVisibleAt;
  const wait = Math.max(UPLOAD_PROGRESS_MIN_VISIBLE_MS - elapsed, 0);
  uploadProgressTimer = window.setTimeout(finish, wait);
}

function waitForUploadProgress(minDuration = UPLOAD_PROGRESS_ENTRANCE_MS) {
  if (!uploadProgressVisibleAt) return Promise.resolve();
  const elapsed = Date.now() - uploadProgressVisibleAt;
  if (elapsed >= minDuration) return Promise.resolve();
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(minDuration - elapsed, 0));
  });
}

/**
 * @typedef {Object} UploadElements
 * @property {HTMLFormElement|null} form
 * @property {HTMLInputElement|null} fileInput
 * @property {HTMLElement|null} statusEl
 * @property {HTMLElement|null} errorEl
 * @property {HTMLTableElement|null} tableEl
 * @property {HTMLElement|null} metaEl
 * @property {boolean} previewDisabled
 */

/**
 * Decide which delimiter likely separates columns in a CSV-like header line.
 *
 * Intent: Auditors receive files from many systems and locales; commas,
 * semicolons, tabs and pipes are all common. We sample the first line and
 * choose the delimiter that appears most frequently outside of quoted text.
 * This favors the dominant structure while avoiding false positives inside
 * quoted fields (e.g., addresses with commas).
 *
 * Trade-offs: We keep candidates small on purpose - simpler, faster, and
 * aligned with typical audit data sources. If you need exotic delimiters,
 * extend the candidates list below.
 *
 * @param {string} line - First non-empty line of the file (usually the header).
 * @returns {","|";"|"\t"|"|"} The most likely delimiter.
 */
function detectDelimiter(line) {
  const candidates = [",", ";", "\t", "|"];
  let best = ",",
    bestCount = -1;
  for (const c of candidates) {
    // Count delimiters only when they are outside of double quotes
    const regex = new RegExp(
      (c === "\t" ? "\\t" : c).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        '(?=(?:[^"]*"[^"]*")*[^"]*$)',
      "g"
    );
    const count = (line.match(regex) || []).length;
    if (count > bestCount) {
      best = c;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Parse CSV/DSV text into a 2D array of rows and columns.
 *
 * Intent: Provide a predictable, library-free parser that handles quoted
 * fields, escaped quotes, and common line endings. This keeps audit tooling
 * deterministic across environments and avoids surprises from browser quirks
 * or library upgrades. We parse into memory because the UI only previews a
 * subset of rows and performs light validation.
 *
 * Notes:
 * - Honors RFC4180-style quoting (double quotes, doubled to escape).
 * - Treats `\r\n` and `\n` as line breaks (CR is ignored when paired).
 * - Caller is responsible for BOM stripping and EOL normalization.
 *
 * @param {string} text - Entire file contents as a string.
 * @param {string} delimiter - Single-character delimiter to split fields on.
 * @returns {string[][]} Parsed rows; `rows[0]` is expected to be the header.
 */
export function parseCSV(text, delimiter) {
  const rows = [];
  let field = "",
    inQuotes = false,
    row = [];
  const d = delimiter === "\t" ? "\t" : delimiter;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } // escaped quote
        else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === d) {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (ch === "\r") {
        /* ignore CR; CRLF handled by \n */
      } else {
        field += ch;
      }
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Render a human-friendly file size for UI messages.
 *
 * Intent: Help auditors quickly judge whether a file is too large for
 * browser-based preview and whether pre-filtering/splitting is warranted.
 *
 * @param {number} bytes - Raw byte count.
 * @returns {string} Size like `12.3 MB`.
 */
function humanSize(bytes) {
  const u = ["B", "KB", "MB", "GB"];
  let k = 0,
    v = bytes;
  while (v >= 1024 && k < u.length - 1) {
    v /= 1024;
    k++;
  }
  return v.toFixed(1) + " " + u[k];
}

/**
 * Remove all children from a table element.
 *
 * Intent: Ensure every preview render starts from a clean slate to avoid
 * mixing rows from different uploads.
 *
 * @param {HTMLTableElement} tableEl - The table element to clear.
 */
function clearTable(tableEl) {
  while (tableEl.firstChild) tableEl.removeChild(tableEl.firstChild);
}

/**
 * Render a lightweight preview table of parsed rows.
 *
 * Intent: Give auditors immediate visual feedback without overloading the DOM.
 * We cap the preview to a reasonable number of body rows and pad missing
 * cells to keep a consistent rectangular shape, which matches export/import
 * expectations for downstream steps.
 *
 * @param {HTMLTableElement} tableEl - Target table to populate.
 * @param {string[][]} rows - Parsed CSV rows; `rows[0]` is the header.
 */
function renderTable(tableEl, rows) {
  clearTable(tableEl);
  if (!rows?.length) return;
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");

  const header = rows[0];
  const trHead = document.createElement("tr");
  header.forEach((h) => {
    const th = document.createElement("th");
    // Show an explicit placeholder for empty header cells to prompt cleanup.
    th.textContent = h || "(blank)";
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  const maxRows = Math.min(rows.length - 1, PREVIEW_ROW_CAP);
  for (let i = 1; i <= maxRows; i++) {
    const tr = document.createElement("tr");
    const r = rows[i] || [];
    r.forEach((c) => {
      const td = document.createElement("td");
      td.textContent = c;
      tr.appendChild(td);
    });
    // Pad short rows so the table remains rectangular (aligns with header).
    for (let k = r.length; k < header.length; k++) {
      const td = document.createElement("td");
      td.textContent = "";
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  tableEl.appendChild(thead);
  tableEl.appendChild(tbody);
}

/**
 * Normalize CSV text by removing BOMs and standardizing line endings.
 *
 * @param {string} text - Raw file text.
 * @returns {string} Normalized text safe for downstream parsing.
 */
function normalizeCsvText(text) {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

/**
 * Build the metadata summary shown above the preview table.
 *
 * @param {string[][]} rows - Parsed CSV rows.
 * @param {string} delimiter - Detected delimiter.
 * @returns {string} Human-friendly summary string.
 */
function summarizeRows(rows, delimiter) {
  const totalRows = Math.max(rows.length - 1, 0);
  const totalCols = rows[0]?.length ?? 0;
  const friendlyDelimiter = delimiter === "\t" ? "Tab" : delimiter;
  return `Rows: ${totalRows} ${META_SEPARATOR} Columns: ${totalCols} ${META_SEPARATOR} Delimiter: ${friendlyDelimiter}`;
}

/**
 * Produce guidance based on header quality.
 *
 * @param {string[][]} rows - Parsed CSV rows.
 * @returns {string} Hint message or empty string if no hints are needed.
 */
function collectHeaderHints(rows) {
  const header = rows[0]?.map((h) => (h || "").trim().toLowerCase()) ?? [];
  const hints = [];
  if (header.length < 2) hints.push(`Only ${header.length} column detected.`);
  if (!header.length || header.every((h) => !h || /^col\d+$/i.test(h))) {
    hints.push(
      "Header row might be missing. Ensure the first row contains column names."
    );
  }
  return hints.length ? "Note: " + hints.join(" ") : "";
}

/**
 * Emit an event so downstream modules (sampling/anomaly) can react.
 *
 * @param {string[][]} rows - Parsed CSV rows.
 * @param {string} delimiter - Detected delimiter.
 * @param {File} file - Original `File` object.
 */
function dispatchCsvParsed(rows, delimiter, file) {
  document.dispatchEvent(
    new CustomEvent("csv:parsed", { detail: { rows, delimiter, file } })
  );
}

/**
 * Persist parsed rows for the sampling view.
 *
 * @param {string[][]} rows - Parsed CSV rows.
 * @param {string} fileName - Original file name for context.
 * @returns {string} Storage key used to retrieve the payload.
 */
async function persistRowsForSampling(rows, fileName) {
  const { id } = await saveUploadPayload(rows, fileName);
  return id;
}

/**
 * Open the sampling view for the stored dataset.
 *
 * @param {string} id - Storage key produced by `persistRowsForSampling`.
 */
function openSampleView(id) {
  const url = `sample.html?id=${encodeURIComponent(id)}`;
  window.location.href = url;
}

/**
 * Resolve frequently accessed DOM nodes up front.
 *
 * @param {Object} ids - Element IDs for the upload widget.
 * @param {string} ids.formId
 * @param {string} ids.inputId
 * @param {string} ids.statusId
 * @param {string} ids.errorId
 * @param {string} ids.tableId
 * @param {string} ids.metaId
 * @returns {UploadElements} Cached DOM references.
 */
function getUploadElements(
  {
    formId,
    inputId,
    statusId,
    errorId,
    tableId,
    metaId,
  },
  { showPreview }
) {
  const tableEl = document.getElementById(tableId);
  const previewWrap = tableEl?.closest(".preview-wrap");
  if (previewWrap && showPreview === false) {
    previewWrap.setAttribute("hidden", "true");
    previewWrap.setAttribute("aria-hidden", "true");
  }
  return {
    form: document.getElementById(formId),
    fileInput: document.getElementById(inputId),
    statusEl: document.getElementById(statusId),
    errorEl: document.getElementById(errorId),
    tableEl,
    metaEl: document.getElementById(metaId),
    previewDisabled: showPreview === false,
  };
}

/**
 * Reset status and error messages before parsing a new file.
 *
 * @param {HTMLElement|null} statusEl - Status element.
 * @param {HTMLElement|null} errorEl - Error element.
 */
function resetMessages(statusEl, errorEl) {
  if (statusEl) statusEl.textContent = "";
  if (errorEl) errorEl.textContent = "";
}

/**
 * Handle a form submission: parse, validate, and preview the CSV.
 *
 * @param {UploadElements} elements - Cached DOM references.
 * @returns {Promise<void>} Resolves when processing completes.
 */
async function processUpload(elements) {
  const {
    fileInput,
    statusEl,
    errorEl,
    tableEl,
    metaEl,
    previewDisabled,
  } = elements;
  resetMessages(statusEl, errorEl);

  const file = fileInput?.files?.[0];
  if (!file) {
    if (errorEl) errorEl.textContent = "Please choose a CSV file first.";
    return;
  }
  if (statusEl && !/\.(csv)$/i.test(file.name) && file.type !== "text/csv") {
    statusEl.textContent = "Attempting to parse (non-standard CSV MIME)...";
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    if (errorEl) {
      errorEl.textContent = `File is large (${humanSize(
        file.size
      )}). Consider splitting it.`;
    }
    return;
  }

  if (statusEl) statusEl.textContent = "Reading file...";
  const clean = normalizeCsvText(await file.text());
  const firstLine = clean.split("\n", 1)[0] || "";
  const delimiter = detectDelimiter(firstLine);
  const rows = parseCSV(clean, delimiter);

  if (!rows.length || (rows.length === 1 && rows[0].length < 2)) {
    if (errorEl) {
      errorEl.textContent =
        "Could not parse the file. Check delimiter (comma, semicolon, tab) and quoting.";
    }
    if (tableEl) clearTable(tableEl);
    if (metaEl) metaEl.textContent = "";
    return;
  }

  if (!previewDisabled && tableEl) renderTable(tableEl, rows);
  else if (tableEl) clearTable(tableEl);
  if (!previewDisabled && metaEl) {
    metaEl.textContent = summarizeRows(rows, delimiter);
  } else if (metaEl) {
    metaEl.textContent = "";
  }
  if (statusEl) {
    statusEl.textContent = `Parsed successfully: ${file.name} (${humanSize(
      file.size
    )}).`;
  }

  const hint = collectHeaderHints(rows);
  if (hint && errorEl) errorEl.textContent = hint;

  dispatchCsvParsed(rows, delimiter, file);

  const fileLabel = file?.name || "your file";
  try {
    showUploadProgress();
    const id = await persistRowsForSampling(rows, fileLabel);
    await waitForUploadProgress();
    openSampleView(id);
    hideUploadProgress();
  } catch (err) {
    console.error("localStorage error (size/quota):", err);
    hideUploadProgress(true);
    if (errorEl) {
      errorEl.textContent =
        "Could not open the sample view (browser storage limit). Try clearing storage or using a smaller file.";
    }
  }
}

/**
 * Wire up the CSV upload form to parse and preview files client-side.
 *
 * Intent: Minimize friction for auditors by validating early, parsing fast,
 * and giving actionable hints (e.g., missing headers). The function is
 * configurable via element IDs so it can be reused across pages or embedded
 * widgets.
 *
 * Security: Parsing happens entirely in the browser; no data is sent to a
 * server at this stage. Size limits protect the UI from freezes due to very
 * large files.
 *
 * @param {Object} [opts]
 * @param {string} [opts.formId="upload-form"] - Form element ID.
 * @param {string} [opts.inputId="csv-file"] - File input ID.
 * @param {string} [opts.statusId="upload-status"] - Status message element ID.
 * @param {string} [opts.errorId="upload-error"] - Error/hint message element ID.
 * @param {string} [opts.tableId="preview-table"] - Preview table element ID.
 * @param {string} [opts.metaId="preview-meta"] - Metadata summary element ID.
 * @param {() => boolean} [opts.requireAuth] - Optional guard; return false to abort.
 * @returns {void}
 */
export function initCsvUpload({
  formId = "upload-form",
  inputId = "csv-file",
  statusId = "upload-status",
  errorId = "upload-error",
  tableId = "preview-table",
  metaId = "preview-meta",
  requireAuth = null,
  showPreview = true,
} = {}) {
  const elements = getUploadElements(
    {
      formId,
      inputId,
      statusId,
      errorId,
      tableId,
      metaId,
    },
    { showPreview }
  );
  const guardUpload = typeof requireAuth === "function" ? requireAuth : null;

  elements.form?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (guardUpload && !guardUpload()) {
      return;
    }
    void processUpload(elements);
  });
}
