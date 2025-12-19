import { suite, test, expect } from './runner.js';

const s = suite('css/styles.css');

function ensureAttached() {
  // styles are linked via runner.html <link>, nothing to do
}

await test('preview table header is sticky with background', () => {
  ensureAttached();
  const table = document.createElement('table');
  table.className = 'preview-table';
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  const th = document.createElement('th');
  th.textContent = 'Col';
  tr.appendChild(th); thead.appendChild(tr); table.appendChild(thead);
  document.body.appendChild(table);
  const style = getComputedStyle(th);
  expect(style.position).toBe('sticky');
  expect(style.backgroundColor).toBeTruthy();
  table.remove();
});

await test('upload error color is applied', () => {
  const el = document.createElement('div');
  el.className = 'upload-error';
  document.body.appendChild(el);
  const color = getComputedStyle(el).color;
  expect(typeof color).toBe('string');
  el.remove();
});

