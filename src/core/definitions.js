/* Definition detection and term extraction.

   A "definition unit" is one clause (split on . ; : ! ? and newlines) that
   contains a definitional verb. Every quoted phrase appearing *before* that verb
   in the same clause is a defined term — which is what makes multi-term
   definitions work:

     "Bread" and "enriched bread" mean only the foods commonly known ...

   yields both "Bread" and "enriched bread". A later clause in the same section
   that re-defines a term ("... "bread" or "enriched bread" also means ...")
   becomes its own unit.

   The heuristics stay conservative: they will still miss valid forms and can
   produce false positives. Quotes are only recognised as pairs, and a single
   apostrophe is never treated as an opening quote. */

const VERB_RE = /\b(?:shall\s+mean|means|mean|includes|include|refers\s+to|has\s+the\s+meaning)\b/gi;
const CAPS_RE = /\b([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*){0,3})\s+(?:means|shall mean)\b/g;
const BOUNDARY = /[.;:!?\n]/;

/* “ ” and ‘ ’ close with their own glyph; a straight " closes with ". */
const CLOSER = { '"': '"', "\u201C": "\u201D", "\u201D": "\u201D", "\u2018": "\u2019" };

const MAX_TERM = 80;

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupeTerms(terms) {
  const seen = new Set();
  const out = [];
  for (const raw of terms) {
    const value = String(raw).trim();
    if (!value) continue;
    const k = value.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(value);
  }
  return out;
}

function clauseSpans(text) {
  const spans = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (BOUNDARY.test(text[i])) { spans.push({ start, end: i }); start = i + 1; }
  }
  if (start < text.length) spans.push({ start, end: text.length });
  return spans;
}

function quotedSpans(text) {
  const spans = [];
  for (let i = 0; i < text.length; i++) {
    const closer = CLOSER[text[i]];
    if (!closer) continue;
    const close = text.indexOf(closer, i + 1);
    if (close === -1) break;
    const value = text.slice(i + 1, close);
    if (value && value.length <= MAX_TERM && !value.includes("\n")) {
      spans.push({ start: i, end: close + 1, value: value.trim() });
    }
    i = close;
  }
  return spans;
}

function firstVerbIndex(text) {
  VERB_RE.lastIndex = 0;
  const m = VERB_RE.exec(text);
  return m ? m.index : -1;
}

function capsTerms(text) {
  const out = [];
  let m;
  CAPS_RE.lastIndex = 0;
  while ((m = CAPS_RE.exec(text)) !== null) {
    const t = m[1].trim();
    if (t.length >= 2 && !/^(The|A|An|It|This|That|Such)$/i.test(t)) out.push(t);
  }
  return out;
}

/* Definition units of a body, as spans over that same string:
   [{ start, end, terms: string[] }] */
export function definitionUnits(text) {
  const src = String(text == null ? "" : text);
  const units = [];
  for (const clause of clauseSpans(src)) {
    const body = src.slice(clause.start, clause.end);
    const verb = firstVerbIndex(body);
    if (verb === -1) continue;
    const terms = [];
    for (const q of quotedSpans(body)) {
      if (q.start >= verb) break;            // only quotes that precede the verb
      if (q.value.length >= 2) terms.push(q.value);
    }
    const unique = dedupeTerms(terms);
    if (unique.length) units.push({ start: clause.start, end: clause.end, terms: unique });
  }
  return units;
}

/* The terms a single section defines. Quoted definitions always count; the
   looser unquoted "Capitalized X means" reading is only used for sections that
   look like a definitions list, to keep false positives down. */
export function sectionTerms(sec) {
  const units = definitionUnits(sec.body);
  const terms = units.flatMap((u) => u.terms);
  if (/definition/i.test(sec.title || "") || units.length >= 2) terms.push(...capsTerms(sec.body));
  return dedupeTerms(terms);
}

export function isDefinitionSection(sec) {
  if (/definition/i.test(sec.title || "")) return true;
  return definitionUnits(sec.body).length >= 2;
}

/* Every term defined anywhere in the chapter. Recomputed on every render and
   independent of insertion order, so a definitions section pasted after other
   sections retroactively highlights those earlier sections. */
export function chapterDefinitions(ch) {
  const terms = [];
  for (const s of ch.sections) terms.push(...sectionTerms(s));
  return dedupeTerms(terms);
}

/* Matching is case-insensitive: statutes define "Bread" and then write "bread",
   and both should highlight. Whole-word boundaries are still required. */
export function buildTermRegex(terms) {
  const parts = dedupeTerms(terms).slice().sort((a, b) => b.length - a.length)
    .map((t) => escapeRe(t).replace(/\s+/g, "\\s+"));
  if (!parts.length) return null;
  return new RegExp("(?<![A-Za-z0-9])(?:" + parts.join("|") + ")(?![A-Za-z0-9])", "gi");
}

/* Split text into highlighted runs: [{ text } | { mark }].
   `shouldMark(term, offset)` decides, per match, whether it becomes a <mark>.
   Because the runs are built from the raw string, no term can be lost or
   double-counted by text-node boundaries. */
export function highlightRuns(text, terms, shouldMark) {
  const value = String(text == null ? "" : text);
  const re = buildTermRegex(terms);
  if (!re) return [{ text: value }];

  const runs = [];
  let last = 0, m;
  re.lastIndex = 0;
  while ((m = re.exec(value)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    if (shouldMark && !shouldMark(m[0], m.index)) continue;
    if (m.index > last) runs.push({ text: value.slice(last, m.index) });
    runs.push({ mark: m[0] });
    last = m.index + m[0].length;
  }
  if (last < value.length) runs.push({ text: value.slice(last) });
  return runs;
}

/* Build the per-section rule from that section's own definition units:

   - a term this section does not define is always highlighted;
   - a term this section *does* define is suppressed inside this section,
     because a definition should not highlight itself;
   - the exception is a different definition in the same section: if the match
     falls inside a unit that defines some other term, it is highlighted.

   `units` must be the units of the section being rendered, and `offset` is the
   match position within that section's stored body. */
export function termSuppressor(units) {
  const own = new Set();
  for (const u of units) for (const t of u.terms) own.add(t.toLowerCase());

  return (term, offset) => {
    const key = String(term).toLowerCase();
    if (!own.has(key)) return true;
    for (const u of units) {
      if (offset >= u.start && offset < u.end) {
        return !u.terms.some((t) => t.toLowerCase() === key);
      }
    }
    return false;
  };
}
