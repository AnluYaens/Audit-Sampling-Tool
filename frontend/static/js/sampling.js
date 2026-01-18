// js/sampling.js
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Convert matrix [header, ...rows] into an array of objects.
 */
export function matrixToObjects(matrix) {
  const header = matrix[0] || [];
  return matrix.slice(1).map((r) => {
    const o = {};
    header.forEach((h, i) => (o[h || `col${i + 1}`] = r[i] ?? ""));
    return o;
  });
}

/**
 * Reproducible random sampling (Fisher-Yates + seed).
 */
export function sampleRandomFromMatrix(matrix, size = 50, seed = 42) {
  const data = matrixToObjects(matrix);
  const rnd = mulberry32(seed);
  for (let i = data.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [data[i], data[j]] = [data[j], data[i]];
  }
  return data.slice(0, Math.min(size, data.length));
}
