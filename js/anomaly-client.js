const DEFAULT_API_BASE = "http://127.0.0.1:5000/api";
const isSameOriginApi = Boolean(
  window.location?.origin?.match(/(127\.0\.0\.1|localhost):5000$/)
);
const API_BASE_URL =
  window.APP_API_BASE_URL ||
  (isSameOriginApi ? `${window.location.origin}/api` : DEFAULT_API_BASE);

// Storage wrapper to handle tracking prevention
function getToken() {
  try {
    return localStorage.getItem("anomalyze:user:token");
  } catch {
    return sessionStorage.getItem("anomalyze:user:token");
  }
}

async function request(path, { method = "GET", body, headers = {} } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        ...headers,
        Authorization: `Bearer ${getToken() || ""}`,
      },
      body,
    });
  } catch (error) {
    throw new Error(error?.message || "Could not reach the anomaly API.");
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    /* ignore parse errors for empty responses */
  }

  if (!response.ok) {
    if (response.status === 401) {
      // Session expired or invalid. Force logout to sync frontend state.
      if (
        window.AnomalyzeAuth &&
        typeof window.AnomalyzeAuth.logout === "function"
      ) {
        window.AnomalyzeAuth.logout();
        throw new Error("Session expired. Redirecting to login...");
      }
    }
    const message =
      data?.error || `Anomaly API failed with status ${response.status}.`;
    throw new Error(message);
  }
  return data;
}

export async function fetchAnomalyMeta() {
  return request("/anomaly/meta");
}

export async function scoreTransactions(transactions) {
  if (!Array.isArray(transactions) || !transactions.length) {
    throw new Error("Provide at least one transaction to score.");
  }
  return request("/anomaly/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactions }),
  });
}
