/* Clause nesting analysis. Pure functions over the raw body text: they decide,
   per line, the marker label, the remaining text and the nesting depth.
   Depth follows the source: real leading whitespace wins (unit = gcd of the
   positive indents, must be >= 2); only when the paste has no usable
   indentation do we fall back to clause-marker inference. */

const MARKER_RE = /^(\((?:\d+|[A-Za-z]{1,5})\)|[A-Za-z0-9]{1,5}[.)])(?=\s|$)/;

const ROMAN_MAP = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
const ROMAN_TABLE = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
  [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];

export function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { const t = a % b; a = b; b = t; }
  return a;
}

export function indentOf(line) {
  let n = 0;
  for (const ch of line) {
    if (ch === " ") n += 1;
    else if (ch === "\t") n += 4;
    else break;
  }
  return n;
}

export function isRoman(s) {
  return /^[ivxlcdm]+$/i.test(s) && /^(?=[MDCLXVI])M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$/i.test(s);
}

export function romanVal(s) {
  const t = s.toLowerCase();
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const v = ROMAN_MAP[t[i]], next = ROMAN_MAP[t[i + 1]] || 0;
    n += v < next ? -v : v;
  }
  return n;
}

export function romanValToStr(n) {
  let out = "";
  for (const [v, s] of ROMAN_TABLE) { while (n >= v) { out += s; n -= v; } }
  return out;
}

/* The previous marker in the same sequence, used for continuation.
   Ambiguity: single letters that are also Roman numerals (c d i l m v x)
   are treated as plain letters here. Approximate for those cases. */
export function predecessor(s) {
  if (/^\d+$/.test(s)) return String(Number(s) - 1);
  if (/^[a-z]$/.test(s) && s > "a") return String.fromCharCode(s.charCodeAt(0) - 1);
  if (/^[A-Z]$/.test(s) && s > "A") return String.fromCharCode(s.charCodeAt(0) - 1);
  if (s.length > 1 && isRoman(s)) { const v = romanVal(s); return v > 1 ? romanValToStr(v - 1) : null; }
  return null;
}

export function markerDepth(label, stack) {
  const inner = label.replace(/[()]/g, "").replace(/[.)]$/, "");
  const seen = stack.lastIndexOf(inner);            /* exact repeat -> pop back to it */
  if (seen !== -1) { stack.length = seen + 1; return seen + 1; }
  const pred = predecessor(inner);                  /* sequence continuation -> same level */
  if (pred !== null) {
    const pi = stack.lastIndexOf(pred);
    if (pi !== -1) { stack.length = pi + 1; stack[pi] = inner; return pi + 1; }
  }
  stack.push(inner);                                /* first appearance -> one deeper */
  return stack.length;
}

/* Analyze a raw body into render instructions:
   [{ type:"blank" } | { type:"clause", marker, text, depth }]
   The marker is sliced off by its matched length (never string-replaced), so a
   clause marker is printed exactly once and cannot also appear in the body. */
export function analyzeBody(body) {
  const lines = String(body).split("\n");
  const entries = lines.map((l) => ({ text: l.replace(/^\s+/, ""), indent: indentOf(l) }));
  const nonEmpty = entries.filter((e) => e.text);

  let useIndent = false, unit = 0;
  if (nonEmpty.length) {
    const base = Math.min.apply(null, nonEmpty.map((e) => e.indent));
    if (nonEmpty.some((e) => e.indent > base)) {
      let g = 0;
      for (const e of nonEmpty) { const d = e.indent - base; if (d > 0) g = g ? gcd(g, d) : d; }
      if (g >= 2) { useIndent = true; unit = g; }
      entries.forEach((e) => { e.depth0 = e.indent - base; });
    }
  }

  const stack = [];                 /* for marker mode */
  let prevDepth = 0;
  const out = [];

  for (const e of entries) {
    if (!e.text) { out.push({ type: "blank" }); continue; }

    const mm = e.text.match(MARKER_RE);
    let depth;
    if (useIndent) depth = Math.max(0, Math.round(e.depth0 / unit));
    else if (mm) depth = markerDepth(mm[1], stack);
    else depth = prevDepth;
    prevDepth = depth;

    let marker = null, text = e.text;
    if (mm) {
      marker = mm[1];
      text = e.text.slice(mm[1].length).replace(/^\s+/, "");
    }
    out.push({ type: "clause", marker, text, depth });
  }
  return out;
}
