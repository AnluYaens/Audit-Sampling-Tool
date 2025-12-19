// Minimal test harness for in-browser execution
const resultsEl = document.getElementById('results');

const state = {
  total: 0,
  passed: 0,
  failed: 0,
};

// Live-updating summary element
const summaryEl = document.createElement('div');
summaryEl.style.marginTop = '16px';
resultsEl.appendChild(summaryEl);

function updateSummary() {
  summaryEl.textContent = `Total: ${state.total}  Passed: ${state.passed}  Failed: ${state.failed}`;
}

function log(message, cls) {
  const div = document.createElement('div');
  if (cls) div.className = cls;
  div.textContent = message;
  resultsEl.appendChild(div);
}

export function suite(name) {
  const wrap = document.createElement('div');
  wrap.className = 'test-suite';
  const h2 = document.createElement('h2');
  h2.textContent = name;
  wrap.appendChild(h2);
  resultsEl.appendChild(wrap);
  return {
    log: (msg, cls) => {
      const d = document.createElement('div');
      if (cls) d.className = cls;
      d.textContent = msg;
      wrap.appendChild(d);
    },
  };
}

export async function test(name, fn) {
  state.total++;
  try {
    await fn();
    state.passed++;
    log('✓ ' + name, 'test-pass');
  } catch (err) {
    state.failed++;
    log('✗ ' + name, 'test-fail');
    const pre = document.createElement('pre');
    pre.textContent = String(err && err.stack || err);
    resultsEl.appendChild(pre);
  }
  updateSummary();
}

export function expect(received) {
  return {
    toBe(expected) {
      if (received !== expected) throw new Error(`Expected ${received} to be ${expected}`);
    },
    toEqual(expected) {
      const r = JSON.stringify(received);
      const e = JSON.stringify(expected);
      if (r !== e) throw new Error(`Expected ${r} to equal ${e}`);
    },
    toBeTruthy() {
      if (!received) throw new Error(`Expected value to be truthy, got ${received}`);
    },
    toContain(substr) {
      if (typeof received !== 'string' || !received.includes(substr)) {
        throw new Error(`Expected string to contain ${substr}. Got: ${received}`);
      }
    },
    toBeGreaterThan(n) {
      if (!(received > n)) throw new Error(`Expected ${received} > ${n}`);
    }
  };
}

// Expose summary when window settles
// Initialize summary for zero state
updateSummary();
