// js/upload.js
// Minimal, dependency-free CSV upload + parsing + preview.
// Exposes: parseCSV(text, delimiter) and initCsvUpload(options).

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

function clearTable(tableEl) {
  while (tableEl.firstChild) tableEl.removeChild(tableEl.firstChild);
}

function renderTable(tableEl, rows) {
  clearTable(tableEl);
  if (!rows?.length) return;
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");

  const header = rows[0];
  const trHead = document.createElement("tr");
  header.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h || "(blank)";
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  const maxRows = Math.min(rows.length - 1, 200);
  for (let i = 1; i <= maxRows; i++) {
    const tr = document.createElement("tr");
    const r = rows[i] || [];
    r.forEach((c) => {
      const td = document.createElement("td");
      td.textContent = c;
      tr.appendChild(td);
    });
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

export function initCsvUpload({
  formId = "upload-form",
  inputId = "csv-file",
  statusId = "upload-status",
  errorId = "upload-error",
  tableId = "preview-table",
  metaId = "preview-meta",
} = {}) {
  const form = document.getElementById(formId);
  const fileInput = document.getElementById(inputId);
  const statusEl = document.getElementById(statusId);
  const errorEl = document.getElementById(errorId);
  const tableEl = document.getElementById(tableId);
  const metaEl = document.getElementById(metaId);

  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    errorEl.textContent = "";
    statusEl.textContent = "";

    const file = fileInput?.files?.[0];
    if (!file) {
      errorEl.textContent = "Please choose a CSV file first.";
      return;
    }
    if (!/\.(csv)$/i.test(file.name) && file.type !== "text/csv") {
      statusEl.textContent = "Attempting to parse (non-standard CSV MIME)...";
    }
    if (file.size > 15 * 1024 * 1024) {
      errorEl.textContent = `File is large (${humanSize(
        file.size
      )}). Consider splitting it.`;
      return;
    }

    statusEl.textContent = "Reading file...";
    const text = await file.text();
    const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"); // remove BOM + normalize EOL
    const firstLine = clean.split("\n", 1)[0] || "";
    const delimiter = detectDelimiter(firstLine);
    const rows = parseCSV(clean, delimiter);

    if (!rows.length || (rows.length === 1 && rows[0].length < 2)) {
      errorEl.textContent =
        "Could not parse the file. Check delimiter (comma, semicolon, tab) and quoting.";
      clearTable(tableEl);
      metaEl.textContent = "";
      return;
    }

    renderTable(tableEl, rows);

    const totalRows = rows.length - 1;
    const totalCols = rows[0].length;
    metaEl.textContent = `Rows: ${totalRows} • Columns: ${totalCols} • Delimiter: ${
      delimiter === "\t" ? "Tab" : delimiter
    }`;
    statusEl.textContent = `Parsed successfully: ${file.name} (${humanSize(
      file.size
    )}).`;

    const header = rows[0].map((h) => (h || "").trim().toLowerCase());
    const hints = [];
    if (header.length < 2) hints.push(`Only ${header.length} column detected.`);
    if (!header.length || header.every((h) => !h || /^col\d+$/i.test(h))) {
      hints.push(
        "Header row might be missing. Ensure the first row contains column names."
      );
    }
    if (hints.length) errorEl.textContent = "Note: " + hints.join(" ");

    // TODO: here you can dispatch an event to downstream modules (sampling/anomaly)
    // document.dispatchEvent(new CustomEvent('csv:parsed', { detail: { rows, delimiter, file } }));
  });
}
