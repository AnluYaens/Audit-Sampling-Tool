// Validación del formulario de Sign Up
document.addEventListener("DOMContentLoaded", function () {
  // Sign Up Form
  const signupForm = document.getElementById("signup-form");
  if (signupForm) {
    signupForm.addEventListener("submit", function (e) {
      e.preventDefault();

      // Limpiar errores previos
      clearErrors();

      // Obtener valores
      const name = document.getElementById("name").value.trim();
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;
      const confirmPassword = document.getElementById("confirm-password").value;
      const terms = document.getElementById("terms").checked;

      let isValid = true;

      // Validar nombre
      if (name.length < 2) {
        showError("name", "El nombre debe tener al menos 2 caracteres");
        isValid = false;
      }

      // Validar email
      if (!isValidEmail(email)) {
        showError("email", "Por favor ingresa un email válido");
        isValid = false;
      }

      // Validar contraseña
      if (password.length < 8) {
        showError("password", "La contraseña debe tener al menos 8 caracteres");
        isValid = false;
      }

      // Validar confirmación de contraseña
      if (password !== confirmPassword) {
        showError("confirm-password", "Las contraseñas no coinciden");
        isValid = false;
      }

      // Validar términos
      if (!terms) {
        alert("Debes aceptar los términos y condiciones");
        isValid = false;
      }

      if (isValid) {
        // Aquí iría la lógica para enviar los datos al servidor
        showSuccess("¡Cuenta creada exitosamente!");
        setTimeout(() => {
          window.location.href = "login.html";
        }, 2000);
      }
    });
  }

  // Login Form
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", function (e) {
      e.preventDefault();

      // Limpiar errores previos
      clearErrors();

      // Obtener valores
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;

      let isValid = true;

      // Validar email
      if (!isValidEmail(email)) {
        showError("email", "Por favor ingresa un email válido");
        isValid = false;
      }

      // Validar contraseña
      if (password.length < 1) {
        showError("password", "Por favor ingresa tu contraseña");
        isValid = false;
      }

      if (isValid) {
        // Aquí iría la lógica para autenticar al usuario
        showSuccess("¡Iniciando sesión...");
        setTimeout(() => {
          window.location.href = "index.html";
        }, 1500);
      }
    });
  }

  // Función para validar email
  function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  // Función para mostrar errores
  function showError(fieldId, message) {
    const field = document.getElementById(fieldId);
    const formGroup = field.closest(".form-group");
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

  // Función para limpiar errores
  function clearErrors() {
    const errorGroups = document.querySelectorAll(".form-group.error");
    errorGroups.forEach((group) => {
      group.classList.remove("error");
      const errorMsg = group.querySelector(".error-message");
      if (errorMsg) {
        errorMsg.style.display = "none";
      }
    });
  }

  // Función para mostrar mensaje de éxito
  function showSuccess(message) {
    let successDiv = document.querySelector(".success-message");
    if (!successDiv) {
      successDiv = document.createElement("div");
      successDiv.className = "success-message";
      const formCard = document.querySelector(".form-card");
      formCard.insertBefore(successDiv, formCard.firstChild);
    }
    successDiv.textContent = message;
    successDiv.style.display = "block";
  }

  // Limpiar errores al escribir
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

  // Animación de los botones sociales
  const socialButtons = document.querySelectorAll(".btn-social");
  socialButtons.forEach((button) => {
    button.addEventListener("click", function () {
      const provider = this.textContent.trim();
      alert(`Autenticación con ${provider} no implementada aún`);
    });
  });
});
