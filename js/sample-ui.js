import { sampleRandomFromMatrix } from "./sampling.js";
import {
  loadUploadPayload,
  deleteUploadPayload,
} from "./storage.js";
import { scoreTransactions, fetchAnomalyMeta } from "./anomaly-client.js";

// Keep sampling/rendering on the client so sensitive audit data never leaves the browser.
// Seeded randomness keeps selections reproducible for audit traceability.
const META_SEPARATOR = "\u0007";
const SAMPLE_EXPIRY_MS = 10 * 60 * 1000;
const DEFAULT_EXPORT_NAME = "sample.csv";
const NUMERIC_SANITIZE_RE = /[^\d.-]/g;
const DEFAULT_ROWS_PER_PAGE = 100;
const ANOMALY_SCORE_KEY = "Anomaly score";
const ANOMALY_FLAG_KEY = "Anomaly flag";
const ANOMALY_REASON_KEY = "Anomaly reason";

let reasonModal = null;
let reasonModalTitle = null;
let reasonModalBody = null;

let lastSample = [];
let chart;
let currentPage = 1;
let rowsPerPage = DEFAULT_ROWS_PER_PAGE;
let lastSeed = 42;
let anomalyThreshold = null;

const $ = (selector) => document.querySelector(selector);

/**
 * Build a table model without touching the DOM so it can be tested in isolation.
 *
 * @param {Array<Record<string, string>>} rows - Sample rows.
 * @returns {{headers: string[], body: string[][]}} Table structure.
 */
export function buildSampleTableModel(rows) {
  const headers = Object.keys(rows[0] || {});
  const body = rows.map((row) => headers.map((key) => row[key] ?? ""));
  return { headers, body };
}

/**
 * Render the sample rows into the preview table.
 *
 * @param {HTMLTableElement|null} tableEl - Target table element.
 * @param {Array<Record<string, string>>} rows - Sample rows.
 */
export function renderSampleTable(tableEl, rows) {
  if (!tableEl) return;
  tableEl.innerHTML = "";
  if (!rows.length) return;

  const { headers, body } = buildSampleTableModel(rows);
  const thead = document.createElement("thead");
  const trHead = document.createElement("tr");
  headers.forEach((header) => {
    const th = document.createElement("th");
    th.textContent =
      header === ANOMALY_REASON_KEY ? "Why flagged" : header || "(blank)";
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  const tbody = document.createElement("tbody");
  body.forEach((cells, rowIndex) => {
    const tr = document.createElement("tr");
    if (rows[rowIndex]?.[ANOMALY_FLAG_KEY]) {
      tr.classList.add("is-anomaly-row");
    }
    cells.forEach((value, cellIndex) => {
      const td = document.createElement("td");
      const columnKey = headers[cellIndex];
      if (columnKey === ANOMALY_REASON_KEY) {
        const reasonText = rows[rowIndex]?.[ANOMALY_REASON_KEY];
        if (reasonText) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "reason-btn";
          btn.textContent = "Why?";
          btn.addEventListener("click", () => {
            const summaryParts = [];
            const txnId = rows[rowIndex]?.txn_id;
            const vendor = rows[rowIndex]?.vendor;
            const amount = rows[rowIndex]?.amount;
            if (txnId) summaryParts.push(`Transaction ${txnId}`);
            if (vendor) summaryParts.push(vendor);
            if (amount) summaryParts.push(`Amount ${amount}`);
            const title =
              summaryParts.join(" • ") || "Why this may be unusual";
            openReasonModal(title, reasonText);
          });
          td.appendChild(btn);
        } else {
          td.textContent = "";
        }
      } else {
        td.textContent = value;
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  tableEl.appendChild(thead);
  tableEl.appendChild(tbody);
}

/**
 * Convert sample rows to CSV text for downloads.
 *
 * @param {Array<Record<string, string>>} rows - Sample rows.
 * @returns {string} CSV payload (quoted via JSON.stringify).
 */
export function serializeSampleToCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const headerLine = headers
    .map((header) => JSON.stringify(header ?? ""))
    .join(",");
  const lines = [
    headerLine,
    ...rows.map((row) =>
      headers.map((header) => JSON.stringify(row[header] ?? "")).join(",")
    ),
  ];
  return lines.join("\n");
}

function coerceNumeric(value) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(NUMERIC_SANITIZE_RE, "");
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "-.") {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function findAmountKey(rows) {
  if (!rows.length) return null;
  const normalize = (key) => (key || "").trim().toLowerCase();
  const keys = Object.keys(rows[0] || {});
  const numericKeys = keys.filter((key) =>
    rows.some((row) => coerceNumeric(row[key]) !== null)
  );
  if (!numericKeys.length) return null;
  const exact = numericKeys.find((key) => normalize(key) === "amount");
  if (exact) return exact;
  const fuzzy = numericKeys.find((key) => normalize(key).includes("amount"));
  if (fuzzy) return fuzzy;
  return numericKeys[0];
}

/**
 * Trigger a client-side CSV download.
 *
 * @param {Array<Record<string, string>>} rows - Sample rows.
 * @param {string} [fileName=DEFAULT_EXPORT_NAME] - Download name.
 */
export function downloadSampleCsv(rows, fileName = DEFAULT_EXPORT_NAME) {
  const csv = serializeSampleToCsv(rows);
  if (!csv) return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Render a quick bar chart for amount fields (best-effort).
 *
 * @param {Array<Record<string, string>>} rows - Sample rows.
 * @returns {Promise<void>} Resolves after rendering.
 */
async function renderAmountChart(rows) {
  const canvas = document.getElementById("sample-chart");
  if (!canvas) return;
  const amountKey = findAmountKey(rows);
  if (!amountKey) {
    if (chart) chart.destroy();
    return;
  }
  const amounts = rows
    .map((row) => coerceNumeric(row[amountKey]))
    .filter((value) => value !== null);
  if (!amounts.length) {
    if (chart) chart.destroy();
    return;
  }
  if (!window.Chart) {
    await import("https://cdn.jsdelivr.net/npm/chart.js");
  }
  if (chart) chart.destroy();
  chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: amounts.map((_, idx) => `#${idx + 1}`),
      datasets: [{ label: amountKey || "Amount", data: amounts }],
    },
  });
}

/**
 * Load rows from browser storage so data never leaves the user's machine.
 *
 * @param {string|null} id - Storage key produced during upload.
 * @returns {Promise<{rows: string[][], fileName?: string}|null>} Stored payload.
 */
async function loadSampleSource(id) {
  if (!id) return null;
  try {
    const payload = await loadUploadPayload(id);
    if (!payload || !Array.isArray(payload?.rows)) {
      return null;
    }
    return payload;
  } catch (error) {
    console.error("Failed to load dataset for sampling.", error);
    return null;
  }
}

export async function initSamplePage() {
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  const source = await loadSampleSource(id);
  if (!source) {
    const meta = $("#file-meta");
    if (meta) meta.textContent = "No sample data found. Upload a CSV first.";
    return;
  }

  const fileMetaEl = $("#file-meta");
  if (fileMetaEl) {
    fileMetaEl.textContent = `File: ${
      source.fileName || "Untitled"
    } ${META_SEPARATOR} Rows: ${source.rows.length - 1}`;
  }

  const sizeEl = $("#sample-size");
  const seedEl = $("#sample-seed");
  const tableEl = $("#sample-table");
  const sampleMetaEl = $("#sample-meta");
  const paginationInfoEl = $("#sample-page-info");
  const paginationPrevBtn = $("#sample-page-prev");
  const paginationNextBtn = $("#sample-page-next");
  const rowsPerPageEl = $("#sample-rows-per-page");
  const detectBtn = $("#btn-detect");
  const anomalyStatusEl = $("#anomaly-status");

  const setAnomalyStatus = (message) => {
    if (anomalyStatusEl) {
      anomalyStatusEl.textContent = message || "";
    }
  };

  const refreshAnomalyMeta = async () => {
    if (!detectBtn) return;
    detectBtn.disabled = true;
    setAnomalyStatus("Checking anomaly model availability...");
    try {
      const meta = await fetchAnomalyMeta();
      if (meta?.available) {
        anomalyThreshold = typeof meta.threshold === "number" ? meta.threshold : null;
        detectBtn.disabled = false;
        if (meta?.trainedAt) {
          const trained = new Date(meta.trainedAt).toLocaleString();
          setAnomalyStatus(`Model ready - Trained ${trained}`);
        } else {
          setAnomalyStatus("Model ready for anomaly scoring.");
        }
      } else {
        setAnomalyStatus(
          meta?.message || "Train the model to enable anomaly detection."
        );
      }
    } catch (error) {
      setAnomalyStatus(error?.message || "Anomaly service unreachable.");
    }
  };

  void refreshAnomalyMeta();

  const clampRowsPerPage = (value) => {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    return DEFAULT_ROWS_PER_PAGE;
  };

  rowsPerPage = clampRowsPerPage(rowsPerPageEl?.value ?? DEFAULT_ROWS_PER_PAGE);
  if (rowsPerPageEl) {
    rowsPerPageEl.value = String(rowsPerPage);
  }

  const getTotalPages = () => {
    if (!rowsPerPage) return 1;
    const total = lastSample.length;
    return Math.max(1, Math.ceil(Math.max(total, 1) / rowsPerPage));
  };

  const updateMetaAndPagination = () => {
    const totalPages = getTotalPages();
    currentPage = Math.min(Math.max(currentPage, 1), totalPages);
    if (paginationInfoEl) {
      paginationInfoEl.textContent = `Page ${totalPages ? currentPage : 1} of ${totalPages}`;
    }
    if (paginationPrevBtn) {
      paginationPrevBtn.disabled = currentPage <= 1;
    }
    if (paginationNextBtn) {
      paginationNextBtn.disabled = currentPage >= totalPages || !lastSample.length;
    }
    if (sampleMetaEl) {
      sampleMetaEl.textContent = `Sample: ${lastSample.length} ${META_SEPARATOR} Seed: ${lastSeed} ${META_SEPARATOR} Rows/page: ${rowsPerPage} ${META_SEPARATOR} Page: ${currentPage}/${totalPages}`;
    }
    return totalPages;
  };

  const renderPaginatedSample = () => {
    const totalPages = updateMetaAndPagination();
    const start = (currentPage - 1) * rowsPerPage;
    const pageRows = lastSample.slice(start, start + rowsPerPage);
    renderSampleTable(tableEl, pageRows);
    return totalPages;
  };

  const compareByDate = (a, b) => {
    const aTime = Date.parse(a?.date ?? "");
    const bTime = Date.parse(b?.date ?? "");
    if (!Number.isNaN(aTime) && !Number.isNaN(bTime) && aTime !== bTime) {
      return aTime - bTime;
    }
    // Fallback keeps ordering deterministic when dates tie or are invalid.
    return String(a?.date ?? "").localeCompare(String(b?.date ?? ""));
  };

  const regenerate = () => {
    const size = Number(sizeEl?.value || 50);
    const seed = Number(seedEl?.value || 42);
    lastSeed = seed;
    // Seeded sampler keeps pulls reproducible for audit re-testing.
    lastSample = sampleRandomFromMatrix(source.rows, size, seed);
    lastSample.sort(compareByDate);
    currentPage = 1;
    renderPaginatedSample();
    void renderAmountChart(lastSample);
  };

  $("#btn-generate")?.addEventListener("click", regenerate);
  $("#btn-export")?.addEventListener("click", () =>
    downloadSampleCsv(lastSample)
  );

  detectBtn?.addEventListener("click", async () => {
    if (!lastSample.length) {
      setAnomalyStatus("Generate a sample before running anomaly detection.");
      return;
    }
    if (detectBtn) detectBtn.disabled = true;
    setAnomalyStatus("Scoring sample...");
    try {
      const response = await scoreTransactions(lastSample);
      anomalyThreshold =
        typeof response?.threshold === "number"
          ? response.threshold
          : anomalyThreshold;
      const scoreMap = new Map(
        (response?.results || []).map((result) => [result.index, result])
      );
      let flaggedCount = 0;
      lastSample = lastSample.map((row, idx) => {
        const next = { ...row };
        const info = scoreMap.get(idx);
        if (info) {
          next[ANOMALY_SCORE_KEY] =
            typeof info.score === "number" ? info.score.toFixed(3) : "";
          const isFlagged = Boolean(info.isAnomaly);
          next[ANOMALY_FLAG_KEY] = isFlagged ? "⚠️" : "";
          next[ANOMALY_REASON_KEY] =
            isFlagged && info.reason ? info.reason : isFlagged ? "Flagged as unusual by the model." : "";
          if (isFlagged) flaggedCount += 1;
        } else {
          next[ANOMALY_SCORE_KEY] = "";
          next[ANOMALY_FLAG_KEY] = "";
          next[ANOMALY_REASON_KEY] = "";
        }
        return next;
      });
      currentPage = 1;
      renderPaginatedSample();
      const thresholdText =
        typeof anomalyThreshold === "number"
          ? anomalyThreshold.toFixed(3)
          : "n/a";
      setAnomalyStatus(
        `Scored ${scoreMap.size} rows - Threshold ${thresholdText} - Flags ${flaggedCount}`
      );
    } catch (error) {
      setAnomalyStatus(error?.message || "Anomaly scoring failed.");
    } finally {
      if (detectBtn) detectBtn.disabled = false;
    }
  });

  paginationPrevBtn?.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage -= 1;
      renderPaginatedSample();
    }
  });

  paginationNextBtn?.addEventListener("click", () => {
    const totalPages = getTotalPages();
    if (currentPage < totalPages) {
      currentPage += 1;
      renderPaginatedSample();
    }
  });

  rowsPerPageEl?.addEventListener("change", (event) => {
    rowsPerPage = clampRowsPerPage(event?.target?.value);
    currentPage = 1;
    renderPaginatedSample();
  });

  regenerate();

setTimeout(() => {
  void deleteUploadPayload(id);
}, SAMPLE_EXPIRY_MS);
}

function ensureReasonModal() {
  if (reasonModal) return;
  reasonModal = document.getElementById("reason-modal");
  reasonModalTitle = document.getElementById("reason-modal-title");
  reasonModalBody = document.getElementById("reason-modal-body");
  if (reasonModal) {
    const closers = reasonModal.querySelectorAll("[data-reason-close]");
    closers.forEach((el) =>
      el.addEventListener("click", () => closeReasonModal())
    );
  }
}

function openReasonModal(title, bodyText) {
  ensureReasonModal();
  if (!reasonModal) return;
  if (reasonModalTitle) {
    reasonModalTitle.textContent = title || "Why this may be unusual";
  }
  if (reasonModalBody) {
    reasonModalBody.textContent =
      bodyText || "Model flagged this entry as unusual.";
  }
  reasonModal.hidden = false;
  document.addEventListener("keydown", handleReasonModalEscape);
}

function closeReasonModal() {
  if (!reasonModal) return;
  reasonModal.hidden = true;
  document.removeEventListener("keydown", handleReasonModalEscape);
}

function handleReasonModalEscape(event) {
  if (event.key === "Escape") {
    closeReasonModal();
  }
}

