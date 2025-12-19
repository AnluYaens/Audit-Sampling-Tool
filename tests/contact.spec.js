import { suite, test, expect } from './runner.js';

const s = suite('contact.js');

function mountContact() {
  const root = document.createElement('div');
  root.innerHTML = `
    <form id="contact-form">
      <input id="contact-name" required />
      <input id="contact-email" type="email" required />
      <textarea id="contact-message" required></textarea>
      <button type="submit">Send</button>
    </form>
    <div id="contact-error" style="display:none"></div>
    <div id="contact-success" style="display:none"></div>
  `;
  document.body.appendChild(root);
  return root;
}

async function loadScript() {
  await import('../js/contact.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

await test('contact: valid submit shows success and resets form', async () => {
  const root = mountContact();
  await loadScript();
  // Populate values programmatically so reset() clears them to empty
  document.getElementById('contact-name').value = 'Ada';
  document.getElementById('contact-email').value = 'ada@example.com';
  document.getElementById('contact-message').value = 'Hello!';
  document.getElementById('contact-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const success = document.getElementById('contact-success');
  expect(success.style.display).toBe('block');
  // After reset, values should be empty
  expect(document.getElementById('contact-name').value).toBe('');
  expect(document.getElementById('contact-email').value).toBe('');
  expect(document.getElementById('contact-message').value).toBe('');
  root.remove();
});

await test('contact: invalid submit triggers reportValidity and no success', async () => {
  const root = mountContact();
  // Make invalid (leave required email empty)
  await loadScript();
  document.getElementById('contact-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const success = document.getElementById('contact-success');
  expect(success.style.display).toBe('none');
  root.remove();
});
