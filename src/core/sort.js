/* Natural ordering for chapter keys and section numbers.
   Numbers compare numerically ("7-2" < "7-10"), text case-insensitively. */

export function naturalKey(v) {
  return String(v == null ? "" : v).split(/(\d+)/).filter((x) => x !== "")
    .map((t) => (/^\d+$/.test(t) ? t.padStart(12, "0") : t.toLowerCase()));
}

export function naturalCmp(a, b) {
  const A = naturalKey(a), B = naturalKey(b), n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const x = A[i] === undefined ? "" : A[i], y = B[i] === undefined ? "" : B[i];
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}
