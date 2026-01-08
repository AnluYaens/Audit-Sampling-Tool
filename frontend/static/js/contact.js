/**
 * Contact form handling and user feedback.
 *
 * Intent: Keep the interaction entirely client-side for speed and privacy
 * during early audits and demos. The code relies on the browser's built-in
 * validity API, adds friendly success/error messaging, and leaves a clear
 * seam where a real backend integration can be added.
 */

document.addEventListener("DOMContentLoaded", function () {
  const contactForm = document.getElementById("contact-form");
  const errorBox = document.getElementById("contact-error");
  const successBox = document.getElementById("contact-success");

  /**
   * Show a prominent error for the contact workflow.
   *
   * Intent: Single place to style and control visibility of errors so the
   * UX stays consistent if markup changes.
   *
   * @param {string} msg - Human-readable error message.
   */
  function showError(msg) {
    if (!errorBox) return;
    errorBox.textContent = msg;
    errorBox.style.display = "block";
  }

  /**
   * Clear any visible success/error messages.
   *
   * Intent: Give users a clean slate for each submission attempt and avoid
   * mixing states across interactions.
   */
  function clearMessages() {
    if (errorBox) {
      errorBox.textContent = "";
      errorBox.style.display = "none";
    }
    if (successBox) {
      successBox.textContent = "";
      successBox.style.display = "none";
    }
  }

  /**
   * Show a success confirmation to the user.
   *
   * Intent: Reinforce that the message was captured, even though no
   * network call happens in this demo.
   *
   * @param {string} msg - Confirmation text.
   */
  function showSuccess(msg) {
    if (!successBox) return;
    successBox.textContent = msg;
    successBox.style.display = "block";
  }

  if (contactForm) {
    contactForm.addEventListener("submit", function (e) {
      e.preventDefault();
      clearMessages();

      const form = e.currentTarget;
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      // Get form values
      const name = document.getElementById("contact-name").value.trim();
      const email = document.getElementById("contact-email").value.trim();
      const message = document.getElementById("contact-message").value.trim();

      // Success message: immediate positive feedback.
      showSuccess(
        `Thank you for contacting us, ${name}! We'll get back to you at ${email} soon.`
      );

      // Reset form
      contactForm.reset();

      // Integration seam: send `{ name, email, message }` to your backend
      // (fetch/axios) and surface server-side validation errors via showError.
    });
  }
});
