import { suite, test, expect } from './runner.js';

const s = suite('script.js (auth forms)');

// Build minimal signup/login DOM that matches expected selectors
function mountSignup() {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="form-card">
      <form id="signup-form">
        <div class="form-group"><label>Name</label><input id="name" value=""/></div>
        <div class="form-group"><label>Email</label><input id="email" type="email" value="test@example.com"/></div>
        <div class="form-group"><label>Password</label><input id="password" type="password" value=""/></div>
        <div class="form-group"><label>Confirm</label><input id="confirm-password" type="password" value=""/></div>
        <div class="form-group"><label><input id="terms" type="checkbox"/> Terms</label></div>
        <button type="submit">Create</button>
      </form>
    </div>`;
  document.body.appendChild(root);
  return root;
}

function mountLogin() {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="form-card">
      <form id="login-form">
        <div class="form-group"><label>Email</label><input id="email" type="email" value="user@example.com"/></div>
        <div class="form-group"><label>Password</label><input id="password" type="password" value="secretpass"/></div>
        <button type="submit">Login</button>
      </form>
      <button class="btn-social">Google</button>
    </div>`;
  document.body.appendChild(root);
  return root;
}

// Load the script under test and trigger DOMContentLoaded so it binds listeners
async function loadScript() {
  await import('../js/script.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

// Mock alert and location to keep tests deterministic
const origAlert = window.alert;
const origLocation = window.location;
window.alert = (...args) => { window.__lastAlert = args.join(' '); };
// Use a proxy for location to intercept href assignment
Object.defineProperty(window, 'location', { value: { href: '' }, writable: true });

await test('signup: validates name and password length, terms required', async () => {
  const root = mountSignup();
  await loadScript();

  // Too-short name and password, no terms
  document.getElementById('name').value = 'A';
  document.getElementById('password').value = 'short';
  document.getElementById('confirm-password').value = 'short';
  document.getElementById('terms').checked = false;

  document.getElementById('signup-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

  // Errors should be shown
  expect(document.querySelectorAll('.form-group.error').length).toBeGreaterThan(0);
  expect(window.__lastAlert || '').toContain('Terms');

  root.remove();
});

await test('signup: success path redirects to login.html', async () => {
  const root = mountSignup();
  await loadScript();

  document.getElementById('name').value = 'Alice';
  document.getElementById('password').value = 'password123';
  document.getElementById('confirm-password').value = 'password123';
  document.getElementById('terms').checked = true;

  document.getElementById('signup-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

  // Wait for async redirect timer (simulate)
  await new Promise(r => setTimeout(r, 2100));
  expect(window.location.href).toContain('login.html');

  root.remove();
});

await test('login: success path redirects to index.html', async () => {
  const root = mountLogin();
  await loadScript();
  document.getElementById('login-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 1600));
  expect(window.location.href).toContain('index.html');
  root.remove();
});

// Restore globals if needed
window.alert = origAlert;
window.location = origLocation;

