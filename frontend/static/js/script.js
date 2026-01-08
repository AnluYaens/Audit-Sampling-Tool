/**
 * Auth UI helpers and form validation for Sign Up and Login.
 *
 * Intent: Provide a lightweight, predictable UX that leans on native HTML5
 * validation, adds clear inline error messaging, and simulates navigation
 * flows without backend dependencies. This keeps onboarding fast for demos
 * and audit pilots while being easy to replace with real endpoints later.
 */
const AUTH_SESSION_KEY = "anomalyze:user";
let openUserMenu = null;
let documentCloseListenerBound = false;

// Storage wrapper to handle tracking prevention blocking localStorage
const storage = {
  getItem(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      console.warn("localStorage blocked, using sessionStorage");
      return sessionStorage.getItem(key);
    }
  },
  setItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      console.warn("localStorage blocked, using sessionStorage");
      sessionStorage.setItem(key, value);
    }
  },
  removeItem(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      console.warn("localStorage blocked, using sessionStorage");
      sessionStorage.removeItem(key);
    }
  },
};

function readStoredUser() {
  try {
    const raw = storage.getItem(AUTH_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistStoredUser(user) {
  if (!user) {
    clearStoredUser();
    return;
  }
  storage.setItem(AUTH_SESSION_KEY, JSON.stringify(user));
  if (user.token) {
    storage.setItem(AUTH_SESSION_KEY + ":token", user.token);
  }
}

function getStoredToken() {
  return storage.getItem(AUTH_SESSION_KEY + ":token");
}

function clearStoredUser() {
  storage.removeItem(AUTH_SESSION_KEY);
  storage.removeItem(AUTH_SESSION_KEY + ":token");
}

const AUTH_GUARD_ANIMATION_MS = 260;
let authGuardModal = null;
let authGuardHideTimer = null;

function ensureAuthGuardModal() {
  if (authGuardModal) return authGuardModal;
  const modal = document.createElement("div");
  modal.className = "auth-guard-modal";
  modal.setAttribute("data-auth-guard-modal", "");
  modal.dataset.state = "hidden";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="auth-guard-modal__backdrop" data-auth-guard-dismiss></div>
    <div class="auth-guard-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="auth-guard-title">
      <button type="button" class="auth-guard-modal__close" data-auth-guard-dismiss aria-label="Close">
        <span aria-hidden="true">&times;</span>
      </button>
      <div class="auth-guard-modal__icon" aria-hidden="true">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
          <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          <rect x="5" y="11" width="14" height="10" rx="2.2" stroke="currentColor" stroke-width="1.6" />
          <circle cx="12" cy="16" r="1.8" fill="currentColor" />
        </svg>
      </div>
      <h2 id="auth-guard-title">Sign in required</h2>
      <p class="auth-guard-modal__body">
        You need an account to <span data-auth-guard-action>continue</span>. Choose how you want to proceed.
      </p>
      <div class="auth-guard-modal__actions">
        <button type="button" class="auth-guard-modal__button auth-guard-modal__button--ghost" data-auth-guard-login>
          Log in
        </button>
        <button type="button" class="auth-guard-modal__button auth-guard-modal__button--primary" data-auth-guard-signup>
          Create account
        </button>
      </div>
    </div>
  `;
  const dismissTargets = modal.querySelectorAll("[data-auth-guard-dismiss]");
  dismissTargets.forEach((btn) =>
    btn.addEventListener("click", () => closeAuthGuardModal())
  );
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeAuthGuardModal();
    }
  });
  const loginBtn = modal.querySelector("[data-auth-guard-login]");
  if (loginBtn) {
    loginBtn.addEventListener("click", () => {
      closeAuthGuardModal(() => {
        window.location.href = "login.html";
      });
    });
  }
  const signupBtn = modal.querySelector("[data-auth-guard-signup]");
  if (signupBtn) {
    signupBtn.addEventListener("click", () => {
      closeAuthGuardModal(() => {
        window.location.href = "signup.html";
      });
    });
  }
  document.body.appendChild(modal);
  authGuardModal = modal;
  return modal;
}

function handleAuthGuardKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    closeAuthGuardModal();
  }
}

function openAuthGuardModal(actionDescription) {
  const modal = ensureAuthGuardModal();
  const actionEl = modal.querySelector("[data-auth-guard-action]");
  if (actionEl) {
    actionEl.textContent = actionDescription || "continue";
  }
  modal.hidden = false;
  // allow layout to settle before animating
  requestAnimationFrame(() => {
    modal.dataset.state = "visible";
  });
  document.addEventListener("keydown", handleAuthGuardKeydown);
}

function closeAuthGuardModal(afterClose) {
  if (!authGuardModal || authGuardModal.hidden) return;
  authGuardModal.dataset.state = "hidden";
  document.removeEventListener("keydown", handleAuthGuardKeydown);
  clearTimeout(authGuardHideTimer);
  authGuardHideTimer = window.setTimeout(() => {
    if (authGuardModal) {
      authGuardModal.hidden = true;
    }
    if (typeof afterClose === "function") {
      afterClose();
    }
  }, AUTH_GUARD_ANIMATION_MS);
}

function isUserLoggedIn() {
  return Boolean(readStoredUser());
}

function ensureUserForAction(actionDescription = "continue") {
  if (isUserLoggedIn()) {
    return true;
  }
  openAuthGuardModal(actionDescription);
  return false;
}

window.AnomalyzeAuth = {
  isAuthenticated: isUserLoggedIn,
  requireLoginForAction: ensureUserForAction,
  logout: () => {
    clearStoredUser();
    updateAuthNavigation(null);
    window.location.href = "login.html";
  },
};
window.requireLoginForAction = ensureUserForAction;

function computeInitials(value) {
  if (!value) return "AA";
  const cleaned = value.trim();
  if (!cleaned) return "AA";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  if (parts.length === 1) {
    const word = parts[0];
    if (word.includes("@")) {
      return word.slice(0, 2).toUpperCase();
    }
    return word.slice(0, 2).toUpperCase();
  }
  return "AA";
}

function closeUserMenu() {
  if (openUserMenu) {
    openUserMenu.hidden = true;
    openUserMenu = null;
  }
}

function bindDocumentCloseListener() {
  if (documentCloseListenerBound) return;
  document.addEventListener("click", (event) => {
    if (!openUserMenu) return;
    if (
      openUserMenu.contains(event.target) ||
      event.target.closest("[data-user-toggle]")
    ) {
      return;
    }
    closeUserMenu();
  });
  documentCloseListenerBound = true;
}

function updateAuthNavigation(user = readStoredUser()) {
  const navs = document.querySelectorAll("[data-auth-nav]");
  if (!navs.length) return;
  navs.forEach((nav) => {
    const menu = nav.querySelector("[data-user-menu]");
    const userSection = nav.querySelector("[data-menu-user]");
    const guestSection = nav.querySelector("[data-menu-guest]");
    const pillLabel = nav.querySelector("[data-user-name]");
    const initialsEl = nav.querySelector("[data-user-initials]");
    const menuName = nav.querySelector("[data-user-menu-name]");
    const emailEl = nav.querySelector("[data-user-menu-email]");

    if (!user) {
      nav.dataset.authState = "guest";
      if (userSection) userSection.hidden = true;
      if (guestSection) guestSection.hidden = false;
      if (pillLabel) pillLabel.textContent = "Profile";
      if (initialsEl) initialsEl.textContent = "PR";
      if (menuName) menuName.textContent = "Profile";
      if (emailEl) emailEl.textContent = "";
      if (menu) menu.hidden = true;
      return;
    }

    if (userSection) userSection.hidden = false;
    if (guestSection) guestSection.hidden = true;
    nav.dataset.authState = "user";

    const displayName = (user.name || "").trim() || user.email || "Profile";
    const initials = computeInitials(displayName);
    const email = user.email || "";

    if (pillLabel) pillLabel.textContent = displayName;
    if (menuName) menuName.textContent = displayName;
    if (emailEl) emailEl.textContent = email;
    if (initialsEl) initialsEl.textContent = initials;
  });
}

function initAuthNavigation() {
  const navs = document.querySelectorAll("[data-auth-nav]");
  if (!navs.length) return;
  navs.forEach((nav) => {
    const menu = nav.querySelector("[data-user-menu]");
    const toggle = nav.querySelector("[data-user-toggle]");
    if (menu && toggle) {
      toggle.addEventListener("click", (event) => {
        event.preventDefault();
        const shouldOpen = menu.hidden;
        closeUserMenu();
        if (shouldOpen) {
          menu.hidden = false;
          openUserMenu = menu;
        }
      });
    }
    const logoutBtn = nav.querySelector("[data-logout-btn]");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", (event) => {
        event.preventDefault();
        clearStoredUser();
        closeUserMenu();
        updateAuthNavigation(null);
        window.location.href = "index.html";
      });
    }
    const settingsBtn = nav.querySelector("[data-settings-btn]");
    if (settingsBtn) {
      settingsBtn.addEventListener("click", (event) => {
        event.preventDefault();
        showToast("Settings will be available soon.", "info");
      });
    }
    const profileBtn = nav.querySelector("[data-profile-btn]");
    if (profileBtn) {
      profileBtn.addEventListener("click", (event) => {
        event.preventDefault();
        showToast("Profile view will arrive in a future update.", "info");
      });
    }
    const loginBtn = nav.querySelector("[data-login-btn]");
    if (loginBtn) {
      loginBtn.addEventListener("click", (event) => {
        event.preventDefault();
        closeUserMenu();
        window.location.href = "login.html";
      });
    }
    const signupBtn = nav.querySelector("[data-signup-btn]");
    if (signupBtn) {
      signupBtn.addEventListener("click", (event) => {
        event.preventDefault();
        closeUserMenu();
        window.location.href = "signup.html";
      });
    }
  });
  bindDocumentCloseListener();
  updateAuthNavigation();
}

const DEFAULT_API_BASE = "http://127.0.0.1:5000/api";
// Set `window.APP_API_BASE_URL` before this script loads to target a different backend host.
const isSameOriginApi = Boolean(
  window.location?.origin?.match(/(127\.0\.0\.1|localhost):5000$/)
);
const API_BASE_URL =
  window.APP_API_BASE_URL ||
  (isSameOriginApi ? `${window.location.origin}/api` : DEFAULT_API_BASE);

// Sign Up and Login validation
function initAuthListeners() {
  initAuthNavigation();

  // Sign Up Form
  const signupBtn = document.getElementById("signup-submit-btn");
  if (signupBtn) {
    signupBtn.addEventListener("click", async function (e) {
      e.preventDefault();

      // Clear previous errors
      clearErrors();

      // Get values
      const nameInput = document.getElementById("name");
      const emailInput = document.getElementById("email");
      const passwordInput = document.getElementById("password");
      const confirmPasswordInput = document.getElementById("confirm-password");
      const termsInput = document.getElementById("terms");

      const name = nameInput.value.trim();
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      const confirmPassword = confirmPasswordInput.value;
      const terms = termsInput.checked;

      let isValid = true;

      // Manual validation since we removed the form tag
      if (!nameInput.checkValidity()) {
        showError("name", nameInput.validationMessage || "Invalid name");
        isValid = false;
      }
      if (!emailInput.checkValidity()) {
        showError("email", emailInput.validationMessage || "Invalid email");
        isValid = false;
      }
      if (!passwordInput.checkValidity()) {
        showError(
          "password",
          passwordInput.validationMessage || "Invalid password"
        );
        isValid = false;
      }
      if (!confirmPasswordInput.checkValidity()) {
        showError(
          "confirm-password",
          confirmPasswordInput.validationMessage || "Invalid password"
        );
        isValid = false;
      }
      if (!termsInput.checkValidity()) {
        showToast("You must accept the Terms and Conditions", "error");
        isValid = false;
      }

      // Additional custom validation
      if (name.length < 2) {
        showError("name", "Name must be at least 2 characters");
        isValid = false;
      }
      if (password.length < 8) {
        showError("password", "Password must be at least 8 characters");
        isValid = false;
      }
      if (password !== confirmPassword) {
        showError("confirm-password", "Passwords do not match");
        isValid = false;
      }
      if (!terms) {
        showToast("You must accept the Terms and Conditions", "error");
        isValid = false;
      }

      if (isValid) {
        // Disable button to prevent multiple clicks and show progress
        signupBtn.disabled = true;
        const originalText = signupBtn.textContent;
        signupBtn.textContent = "Creating...";

        try {
          await apiPost("/auth/signup", {
            name,
            email,
            password,
            confirmPassword,
          });

          // Show success message
          showToast("Account created! Please log in.", "success");

          // Redirect to login page
          setTimeout(() => {
            window.location.href = "login.html";
          }, 1500);
        } catch (error) {
          console.error("❌ Signup failed:", error);
          showToast(
            error.message || "We couldn't create your account.",
            "error"
          );
          // Re-enable button on error
          signupBtn.disabled = false;
          signupBtn.textContent = originalText;
        }
      }
    });
  }

  // Login Form
  const loginBtn = document.getElementById("login-submit-btn");
  if (loginBtn) {
    loginBtn.addEventListener("click", async function (e) {
      e.preventDefault();
      const form = document.getElementById("login-form");
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      // Clear previous errors to avoid stale state between attempts.
      clearErrors();

      // Get values
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;

      let isValid = true;

      if (isValid) {
        try {
          showToast("Validating your credentials...", "info");
          const result = await apiPost("/auth/login", {
            email,
            password,
          });
          if (result?.user) {
            // Attach token to user object for persistence helper
            if (result.token) result.user.token = result.token;
            persistStoredUser(result.user);
            updateAuthNavigation(result.user);
          } else {
            clearStoredUser();
          }
          showToast("Welcome back! Logging you in...", "success");

          // Use a slightly longer delay to ensure the toast is seen, matching signup flow
          setTimeout(() => {
            window.location.replace("index.html");
          }, 2000);
        } catch (error) {
          showToast(
            error.message || "We couldn't verify your account.",
            "error"
          );
        }
      }
    });
  }

  /**
   * Basic email pattern check.
   *
   * Intent: Use sparingly — the browser's `type="email"` already validates
   * format. Keep this helper for scenarios where fields are plain text or
   * additional checks are required. Not currently invoked.
   *
   * @param {string} email
   * @returns {boolean}
   */
  function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Show a field-level error message and style the group.
   *
   * Intent: Centralizes error rendering so form UX stays consistent across
   * pages. Works with `.form-group` wrappers.
   *
   * @param {string} fieldId - The input's DOM id.
   * @param {string} message - Human-friendly explanation of the issue.
   */
  function showError(fieldId, message) {
    const field = document.getElementById(fieldId);
    if (!field) return;
    const formGroup = field.closest(".form-group");
    if (!formGroup) return;
    formGroup.classList.add("error");

    let errorDiv = formGroup.querySelector(".error-message");
    if (!errorDiv) {
      errorDiv = document.createElement("div");
      errorDiv.className = "error-message";
      formGroup.appendChild(errorDiv);
    }
    errorDiv.textContent = message;
    errorDiv.style.display = "block";
  }

  /**
   * Remove all field error states and hide their messages.
   *
   * Intent: Ensure a fresh attempt doesn't inherit stale errors, reducing
   * confusion for the user.
   */
  function clearErrors() {
    const errorGroups = document.querySelectorAll(".form-group.error");
    errorGroups.forEach((group) => {
      group.classList.remove("error");
      const errorMsg = group.querySelector(".error-message");
      if (errorMsg) {
        errorMsg.style.display = "none";
      }
    });
    // hideBanner(); // No longer needed with Toasts
  }

  /**
   * Display a toast notification using Toastify.
   *
   * @param {string} message
   * @param {string} variant - 'success', 'error', or 'info'
   */
  function showToast(message, variant = "success") {
    const palette = {
      success: "linear-gradient(to right, #00b09b, #96c93d)",
      error: "linear-gradient(to right, #ff5f6d, #ffc371)",
      info: "linear-gradient(to right, #2193b0, #6dd5ed)",
    };

    // Fallback if Toastify is not loaded (e.g. offline dev)
    if (typeof Toastify === "undefined") {
      console.log(`[${variant}] ${message}`);
      if (variant === "error") alert(message);
      return;
    }

    Toastify({
      text: message,
      duration: 3000,
      close: true,
      gravity: "top",
      position: "right",
      stopOnFocus: true,
      style: {
        background: palette[variant] || palette.info,
      },
    }).showToast();
  }

  // function showBanner(...) removed/replaced by showToast
  // function hideBanner(...) removed

  async function apiPost(path, payload) {
    let response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getStoredToken() || ""}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (networkError) {
      throw new Error(
        networkError?.message ||
          "We couldn't reach the server. Is Flask running?"
      );
    }
    let data = {};
    try {
      data = await response.json();
    } catch {
      /* ignore body parsing errors */
    }
    if (!response.ok) {
      const message =
        data?.error || `Request failed with status ${response.status}.`;
      throw new Error(message);
    }
    return data;
  }

  // Clear error state on input
  const inputs = document.querySelectorAll("input");
  inputs.forEach((input) => {
    input.addEventListener("input", function () {
      const formGroup = this.closest(".form-group");
      if (formGroup && formGroup.classList.contains("error")) {
        formGroup.classList.remove("error");
        const errorMsg = formGroup.querySelector(".error-message");
        if (errorMsg) {
          errorMsg.style.display = "none";
        }
      }
    });
  });

  // Social button click animation
  const socialButtons = document.querySelectorAll(".btn-social");
  socialButtons.forEach((button) => {
    button.addEventListener("click", function () {
      const provider = this.textContent.trim();
      showToast(`Authentication with ${provider} not implemented yet`, "info");
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAuthListeners);
} else {
  initAuthListeners();
}
