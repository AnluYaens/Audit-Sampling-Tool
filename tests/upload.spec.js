import { suite, test, expect } from './runner.js';
import { parseCSV, initCsvUpload } from '../js/upload.js';

const s = suite('upload.js');

// parseCSV unit tests
await test('parseCSV: simple rows', () => {
  const rows = parseCSV('a,b,c\n1,2,3\n', ',');
  expect(rows.length).toBe(2);
  expect(rows[0]).toEqual(['a','b','c']);
  expect(rows[1]).toEqual(['1','2','3']);
});

await test('parseCSV: quoted delimiter and escaped quotes', () => {
  const text = 'a,"b,c","He said ""Hi"""\n1,2,3';
  const rows = parseCSV(text, ',');
  expect(rows[0][1]).toBe('b,c');
  expect(rows[0][2]).toBe('He said "Hi"');
});

await test('parseCSV: embedded newline in quoted field', () => {
  const text = 'h1,h2\n"line1\nline2",x';
  const rows = parseCSV(text, ',');
  expect(rows.length).toBe(2);
  expect(rows[1][0]).toBe('line1\nline2');
});

await test('parseCSV: trailing delimiter yields empty field', () => {
  const text = 'a,b,\n';
  const rows = parseCSV(text, ',');
  expect(rows[0]).toEqual(['a','b','']);
});

await test('parseCSV: no final newline still yields last row', () => {
  const text = 'a,b,c';
  const rows = parseCSV(text, ',');
  expect(rows.length).toBe(1);
  expect(rows[0]).toEqual(['a','b','c']);
});

// initCsvUpload integration: build minimal DOM and simulate file upload
function createUploadDOM() {
  const root = document.createElement('div');
  root.innerHTML = `
    <form id="upload-form">
      <input id="csv-file" type="file" />
      <button type="submit">Upload</button>
    </form>
    <div id="upload-status"></div>
    <div id="upload-error"></div>
    <table id="preview-table" class="preview-table"></table>
    <div id="preview-meta"></div>
  `;
  document.body.appendChild(root);
  return root;
}

async function makeFile(name, type, text) {
  return new File([text], name, { type });
}

function setInputFiles(input, files) {
  // Some browsers disallow direct assignment; define a getter instead.
  Object.defineProperty(input, 'files', { configurable: true, get: () => files });
}

function waitFor(predicate, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function tick() {
      try {
        if (predicate()) return resolve();
      } catch (_) { /* ignore transient DOM */ }
      if (Date.now() - start > timeout) return reject(new Error('waitFor timeout'));
      setTimeout(tick, 20);
    })();
  });
}

await test('initCsvUpload: parses CSV and renders preview/meta', async () => {
  const root = createUploadDOM();
  initCsvUpload();

  const file = await makeFile('sample.csv', 'text/csv', 'a,b\n1,2\n');
  const input = document.getElementById('csv-file');

  // Simulate selecting a file
  const dt = new DataTransfer();
  dt.items.add(file);
  setInputFiles(input, dt.files);

  // Submit form
  document.getElementById('upload-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  // Wait for preview/meta to update
  await waitFor(() => document.getElementById('preview-meta').textContent.includes('Rows:'));

  const meta = document.getElementById('preview-meta').textContent;
  expect(meta.includes('Rows: 1')).toBe(true);
  const table = document.getElementById('preview-table');
  expect(table.querySelectorAll('thead th').length).toBe(2);
  expect(table.querySelectorAll('tbody tr').length).toBe(1);

  root.remove();
});
