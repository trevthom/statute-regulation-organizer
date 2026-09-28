/* Pasted-text cleanup, applied once when a section is added and before it is
   stored.

   Copy/pasting out of a PDF or a web page brings along CRLF newlines, hard
   spaces, stray tabs, runs of spaces, piles of blank lines and hard line wraps
   in the middle of sentences. This repairs those formatting artifacts without
   touching the wording: no word, punctuation mark, capital letter or citation
   is ever changed.

   A single newline between two lines of ordinary prose is treated as a soft
   line wrap and replaced with a space. A newline is kept as a real break when
   either side of it looks structural:

   - a blank line (paragraph break),
   - an ALL-CAPS or keyword-led heading (ARTICLE 5, DEFINITIONS, "Sec. 3"),
   - a numbered/lettered item or bullet ((a), (12), iv., A., •, -, §),
   - a line opening a quotation (a new definition entry),
   - a line indented deeper than the paste's base indent,
   - the previous line ending in . : ! ? (end of a sentence or a lead-in).

   A deeper-indented line is still joined when it plainly continues a sentence
   (it starts lowercase), which is what a hanging indent looks like.

   Indentation is otherwise preserved because clause nesting depends on it.

   Known approximations: a title-case heading sitting on the line immediately
   before prose (no blank line, not ALL CAPS, no keyword) is indistinguishable
   from a wrapped line and gets joined, and a hyphen at a wrap point is only
   removed when the following fragment is recognizable as a word ending. */

const UNICODE_SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;

const SOFT_HYPHEN = "\u00AD";
const NON_BREAKING_HYPHEN = "\u2011";
/* Hyphens a typesetter can leave behind when a word was split across lines. */
const BREAK_HYPHENS = ["-", "\u2010", NON_BREAKING_HYPHEN, SOFT_HYPHEN];

/* Word endings that are not words on their own. If the fragment after a
   wrapped hyphen ends in one of these the hyphen split a word
   (establish- + ment -> establishment); otherwise the hyphen is assumed to be
   a real compound hyphen and is kept (well- + known -> well-known). */
const WORD_ENDINGS = [
  "ment", "ments", "tion", "tions", "sion", "sions", "ation", "ations",
  "ition", "itions", "ization", "izations", "isation", "isations", "ness",
  "ity", "ities", "ance", "ances", "ence", "ences", "ous", "ious", "ive",
  "ative", "itive", "able", "ible", "ally", "ically", "ology", "ography",
  "ument", "ernment", "tional", "ional", "istic"
];

const TRAILING_CLOSERS = /["'\u201D\u2019)\]}]+$/;
const CLAUSE_MARKER = /^(?:\(\s*(?:\d{1,4}|[A-Za-z]{1,5})\s*\)|(?:\d{1,4}|[A-Za-z]{1,5})[.)](?=\s|$))/;
const BULLET = /^(?:[•‣▪◦·*+-]\s|[\u2014\u2013]\s)/;
const SECTION_SIGN = /^§/;
const HEADING_WORD = /^(?:articles?|sections?|sec\.|chapters?|parts?|rules?|titles?|schedules?|exhibits?|§)/i;
const HEADING_CAPS = /^(?:ARTICLE|SECTION|CHAPTER|PART|RULE|TITLE|SCHEDULE|EXHIBIT|APPENDIX)\b/;
const QUOTE_START = /^["'\u201C\u201D\u2018\u2019]/;

function splitIndent(line) {
  const lead = line.match(/^[ \t]*/)[0];
  return {
    indent: lead.replace(/\t/g, "    "),
    rest: line.slice(lead.length).replace(/\t/g, " ")
  };
}

const indentWidth = (line) => line.length - line.trimStart().length;

function baseIndent(lines) {
  let base = Infinity;
  for (const line of lines) {
    if (line.trim()) base = Math.min(base, indentWidth(line));
  }
  return Number.isFinite(base) ? base : 0;
}

function endsTerminal(text) {
  return /[.:!?]$/.test(text.replace(TRAILING_CLOSERS, ""));
}

function isHeading(text) {
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 3 && letters === letters.toUpperCase()) return true;
  if (text.length > 60) return false;
  if (!HEADING_WORD.test(text)) return false;
  return !endsTerminal(text) && !/[,;:]$/.test(text);
}

function startsStructure(text) {
  return CLAUSE_MARKER.test(text) || BULLET.test(text) || SECTION_SIGN.test(text) ||
    HEADING_CAPS.test(text) || QUOTE_START.test(text);
}

/* Glue a hyphenated line wrap. Returns the merged line, or null when the break
   is not a hyphenated wrap at all. */
function hyphenJoin(prev, next) {
  const left = prev.replace(/[ ]+$/, "");
  const last = left[left.length - 1];
  if (!BREAK_HYPHENS.includes(last)) return null;

  const before = left.slice(0, -1);
  if (!/[A-Za-z]$/.test(before)) return null;

  const rest = next.trimStart();
  if (!/^[a-z]/.test(rest)) return null;                     // a continuation is lowercase

  if (last === SOFT_HYPHEN) return before + rest;            // invisible: just glue
  if (last === NON_BREAKING_HYPHEN) return before + last + rest;  // deliberate: keep

  const fragment = (rest.match(/^[a-z]+/) || [""])[0];
  const split = WORD_ENDINGS.some((ending) => fragment.endsWith(ending));
  return before + (split ? "" : last) + rest;
}

function canJoin(prev, next, base) {
  if (!prev.trim() || !next.trim()) return false;            // paragraph break

  const prevText = prev.trim();
  const nextText = next.trimStart();
  const nextIndent = indentWidth(next);

  if (prevText[prevText.length - 1] === "-" || prevText[prevText.length - 1] === SOFT_HYPHEN) {
    return false;                                            // a hyphen we could not resolve
  }
  if (isHeading(prevText) || isHeading(nextText)) return false;
  if (endsTerminal(prevText)) return false;
  if (startsStructure(nextText)) return false;
  if (nextIndent > base && !/^[a-z]/.test(nextText)) return false;

  return true;
}

/* Join soft line wraps back into single lines. Exported for testing. */
export function joinSoftWraps(lines) {
  if (!lines.length) return "";
  const base = baseIndent(lines);
  const out = [lines[0]];

  for (let i = 1; i < lines.length; i++) {
    const prev = out[out.length - 1];
    const next = lines[i];
    const glued = hyphenJoin(prev, next);

    if (glued !== null) out[out.length - 1] = glued;
    else if (canJoin(prev, next, base)) out[out.length - 1] = prev + " " + next.trimStart();
    else out.push(next);
  }
  return out.join("\n");
}

export function normalizeBody(raw) {
  const text = String(raw == null ? "" : raw)
    .replace(/\r\n?/g, "\n")
    .replace(UNICODE_SPACES, " ");

  const lines = text.split("\n").map((line) => {
    const { indent, rest } = splitIndent(line);
    return (indent + rest.replace(/ {2,}/g, " ")).replace(/ +$/, "");
  });

  return joinSoftWraps(lines)
    .replace(/\u00AD/g, "")        // any soft hyphen left mid-word is invisible
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
