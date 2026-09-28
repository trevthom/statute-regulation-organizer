/* Definition detection and term extraction.
   Heuristic and deliberately conservative: a quoted "X" followed by
   means/includes/refers-to, or a Capitalized X means. It will miss valid
   forms and can produce false positives — keep it narrow. */

const TERM_QUOTED = /[\u201C\u201D"']([^"\u201C\u201D\u2018\u2019']{1,60}?)[\u201C\u201D\u2018\u2019"']\s*(?:means|shall mean|includes|include|refers to|has the meaning)/gi;
const TERM_CAPS = /\b([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*){0,3})\s+(?:means|shall mean)\b/g;
const DEFINITION_HITS = /[\u201C\u201D"'][^"\u201C\u201D\u2018\u2019']{1,60}[\u201C\u201D\u2018\u2019"']\s*(?:means|shall mean|includes|refers to)/gi;

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractTerms(body) {
  const out = []; let m;
  TERM_QUOTED.lastIndex = 0;
  while ((m = TERM_QUOTED.exec(body)) !== null) {
    const t = m[1].trim();
    if (t.length >= 2) out.push(t);
  }
  TERM_CAPS.lastIndex = 0;
  while ((m = TERM_CAPS.exec(body)) !== null) {
    const t = m[1].trim();
    if (t.length >= 2 && !/^(The|A|An|It|This|That|Such)$/i.test(t)) out.push(t);
  }
  return out;
}

export function isDefinitionSection(sec) {
  if (/definition/i.test(sec.title || "")) return true;
  const hits = (sec.body.match(DEFINITION_HITS) || []).length;
  return hits >= 2;
}

/* The chapter-wide term list, computed from ALL sections on every render.
   Because it never depends on insertion order, a definitions section pasted
   after other sections retroactively highlights those earlier sections. */
export function chapterDefinitions(ch) {
  const set = new Set();
  for (const s of ch.sections) {
    if (!isDefinitionSection(s)) continue;
    for (const t of extractTerms(s.body)) set.add(t);
  }
  return Array.from(set);
}

export function buildTermRegex(terms) {
  const parts = terms.slice().sort((a, b) => b.length - a.length)
    .map((t) => escapeRe(t).replace(/\s+/g, "\\s+"));
  if (!parts.length) return null;
  return new RegExp("(?<![A-Za-z0-9])(?:" + parts.join("|") + ")(?![A-Za-z0-9])", "g");
}
