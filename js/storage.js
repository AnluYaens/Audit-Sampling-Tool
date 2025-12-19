const DB_NAME = "anomalyzeUploads";
const DB_VERSION = 1;
const STORE_NAME = "datasets";

let dbPromise = null;

function supportsIndexedDb() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDatabase() {
  if (!supportsIndexedDb()) {
    return Promise.reject(new Error("IndexedDB not supported in this browser."));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error || new Error("IndexedDB open failed."));
      request.onblocked = () =>
        console.warn("IndexedDB open is blocked. Close other tabs.");
    });
  }
  return dbPromise;
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("IDB transaction aborted."));
    tx.onerror = () => reject(tx.error || new Error("IDB transaction failed."));
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("IDB request failed."));
  });
}

function generateId() {
  return `csv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function persistToLocalStorage(payload) {
  try {
    localStorage.setItem(payload.id, JSON.stringify(payload));
    return { id: payload.id, storage: "localStorage" };
  } catch (error) {
    const fallbackError = new Error(
      "Browser storage limit reached. Try clearing storage or using a smaller file."
    );
    fallbackError.cause = error;
    throw fallbackError;
  }
}

/**
 * Persist a parsed CSV payload for later sampling.
 *
 * @param {string[][]} rows
 * @param {string} fileName
 * @returns {Promise<{id: string, storage: string}>}
 */
export async function saveUploadPayload(rows, fileName) {
  const payload = {
    id: generateId(),
    rows,
    fileName,
    createdAt: Date.now(),
  };
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(payload);
    await transactionDone(tx);
    return { id: payload.id, storage: "indexedDB" };
  } catch (error) {
    console.warn(
      "IndexedDB unavailable; falling back to localStorage for uploads.",
      error
    );
    return persistToLocalStorage(payload);
  }
}

/**
 * Load a previously saved dataset by id.
 *
 * @param {string} id
 * @returns {Promise<{rows: string[][], fileName?: string, createdAt?: number} | null>}
 */
export async function loadUploadPayload(id) {
  if (!id) return null;
  if (supportsIndexedDb()) {
    try {
      const db = await openDatabase();
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(id);
      const record = await requestToPromise(request);
      await transactionDone(tx);
      if (record) return record;
    } catch (error) {
      console.warn("IndexedDB read failed; checking localStorage.", error);
    }
  }
  try {
    const raw = localStorage.getItem(id);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error("Failed to parse localStorage payload.", error);
    return null;
  }
}

/**
 * Remove a stored dataset after use or expiry.
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteUploadPayload(id) {
  if (!id) return;
  if (supportsIndexedDb()) {
    try {
      const db = await openDatabase();
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      await transactionDone(tx);
    } catch (error) {
      console.warn("IndexedDB deletion failed; falling back to localStorage.", error);
    }
  }
  try {
    localStorage.removeItem(id);
  } catch {
    /* ignore */
  }
}
