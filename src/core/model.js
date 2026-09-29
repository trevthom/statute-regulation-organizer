/* State mutations over plain data. No DOM, no storage: callers own persistence
   and rendering so this module stays easy to unit-test.

   The library is organized as:

     jurisdiction (a state, or the federal system)
       └─ chapter   (the unit that groups sections; its designation is the
                     organization path of the levels that were filled in)
            └─ section

   Every jurisdiction files statutes under the same fixed hierarchy, outermost
   level first:

     Title → Subtitle → Division → Chapter → Subchapter → Part → Subpart →
     Section → Subsection

   Exactly one of those levels is the jurisdiction's anchor — the required one:
   a federal Title (a number from 1 to 50, picked from a list) or a state's
   Chapter. Every other level is optional; when the user turns one on it carries
   a short alphanumeric code (1-2 characters) that files the section deeper.

   A chapter stores one value per level that was used (`partValues`) plus a
   title that defaults to UNKNOWN, so `Title 42 · Chapter 21` and
   `Title 15 · Chapter 21` are different chapters. A section is identified by
   its own required number, which sorts naturally (7-2 < 7-10). */

import { naturalCmp } from "./sort.js";

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export const UNKNOWN = "UNKNOWN";

/* The organization hierarchy, outermost level first. These names are also the
   keys of a chapter's `partValues`, so their spelling is part of the stored
   data — renaming one needs a migration. */
export const ORG_LEVELS = [
  "Title", "Subtitle", "Division", "Chapter", "Subchapter", "Part", "Subpart",
  "Section", "Subsection"
];

export const FEDERAL_ANCHOR = "Title";
export const STATE_ANCHOR = "Chapter";

/* Federal Titles are numbered 1-50. (The real U.S. Code has more, but the
   library is scoped to that range and the composer offers exactly these.) */
export const TITLE_MIN = 1;
export const TITLE_MAX = 50;

/* An optional level carries a short code: letters or digits, at most 2. */
export const CODE_MAX = 2;
const CODE_RE = /^[A-Za-z0-9]{1,2}$/;

export const STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
  "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
  "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
  "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
  "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia",
  "Washington", "West Virginia", "Wisconsin", "Wyoming"
];

/* The one level a jurisdiction cannot do without: Title for the federal
   system, Chapter for a state. Anything with a `kind` works, so callers can
   pass a draft too. */
export function anchorOf(jurisdiction) {
  return jurisdiction && jurisdiction.kind === "federal" ? FEDERAL_ANCHOR : STATE_ANCHOR;
}

/* The canonical spelling of a level name, or null when it is not one. */
export function orgLevel(name) {
  const s = String(name == null ? "" : name).trim().toLowerCase();
  return ORG_LEVELS.find((l) => l.toLowerCase() === s) || null;
}

export function isValidTitle(value) {
  const s = String(value == null ? "" : value).trim();
  if (!/^\d+$/.test(s)) return false;
  const n = Number(s);
  return n >= TITLE_MIN && n <= TITLE_MAX;
}

export function isValidCode(value) {
  return CODE_RE.test(String(value == null ? "" : value).trim());
}

function cleanTitle(value) {
  const s = String(value == null ? "" : value).trim();
  return s || UNKNOWN;
}

export function slugKey(name) {
  const s = String(name == null ? "" : name).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || uid();
}

export function makeJurisdiction({ key, name, kind }) {
  const clean = String(name == null ? "" : name).trim();
  return {
    key: key || slugKey(clean),
    name: clean || "Untitled jurisdiction",
    kind: kind === "federal" ? "federal" : "state"
  };
}

/* Federal jurisdictions first, then every state, keeping anything already
   there (a jurisdiction the user added, and its chapters). Used by emptyState
   and by the storage migration so both ends up with the same list. */
export function seedJurisdictions(list) {
  const out = (Array.isArray(list) ? list : []).map((j) =>
    makeJurisdiction({ key: j.key, name: j.name, kind: j.kind }));
  const seeds = [
    makeJurisdiction({ key: "federal", name: "Federal", kind: "federal" }),
    ...STATES.map((name) => makeJurisdiction({ name, kind: "state" }))
  ];
  for (const seed of seeds) {
    if (!out.some((j) => j.key === seed.key)) out.push(seed);
  }
  return out;
}

export function emptyState() {
  return { jurisdictions: seedJurisdictions([]), chapters: [], activeId: null };
}

export function findJurisdiction(state, key) {
  return state.jurisdictions.find((j) => j.key === key) || null;
}

/* Jurisdictions in sidebar order: Federal first, then states alphabetically. */
export function sortedJurisdictions(state) {
  return state.jurisdictions.slice().sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "federal" ? -1 : 1;
    return naturalCmp(a.name, b.name);
  });
}

export function chaptersOf(state, jurisdictionKey) {
  return state.chapters.filter((c) => c.jurisdiction === jurisdictionKey);
}

/* The chapter's anchor value: the federal Title, or a state's Chapter. */
export function chapterNumber(ch) {
  const v = ch.partValues || {};
  return String(v[FEDERAL_ANCHOR] || v[STATE_ANCHOR] || "").trim();
}

/* Reduce free-form input to the hierarchy's own level names, trimmed, dropping
   the levels that carry no value. */
export function partValuesOf(jurisdiction, input) {
  const out = {};
  const src = input || {};
  for (const t of ORG_LEVELS) {
    const v = String(src[t] == null ? "" : src[t]).trim();
    if (v) out[t] = v;
  }
  return out;
}

/* Identity of a chapter within its jurisdiction: the full organization path,
   so Title 42 Chapter 21 and Title 15 Chapter 21 stay distinct. */
export function chapterSignature(jurisdiction, values) {
  const v = values || {};
  return ORG_LEVELS
    .map((t) => [t.toLowerCase(), String(v[t] == null ? "" : v[t]).trim().toLowerCase()])
    .filter(([, value]) => value)
    .map(([level, value]) => level + "=" + value)
    .join("|");
}

/* "Title 42 · Chapter 21" — the levels that actually have a value, in order. */
export function partPath(jurisdiction, values) {
  const v = values || {};
  const bits = [];
  for (const t of ORG_LEVELS) {
    const value = String(v[t] == null ? "" : v[t]).trim();
    if (value) bits.push(t + " " + value);
  }
  return bits.join(" \u00b7 ");
}

/* Document/sidebar order: organization values in hierarchy order, then title. */
export function compareChapters(jurisdiction, a, b) {
  for (const t of ORG_LEVELS) {
    const c = naturalCmp((a.partValues || {})[t] || "", (b.partValues || {})[t] || "");
    if (c) return c;
  }
  return naturalCmp(a.title || "", b.title || "");
}

export function chaptersInOrder(state, jurisdictionKey) {
  const j = findJurisdiction(state, jurisdictionKey);
  return chaptersOf(state, jurisdictionKey).sort((a, b) => compareChapters(j, a, b));
}

export function currentChapter(state) {
  return state.chapters.find((c) => c.id === state.activeId) || state.chapters[0] || null;
}

/* Section order. Every section has a number; a blank one (only possible in data
   carried over from an older store) sorts last rather than first. */
export function compareSections(a, b) {
  const x = String(a.number == null ? "" : a.number).trim();
  const y = String(b.number == null ? "" : b.number).trim();
  if (!x && !y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  return naturalCmp(x, y);
}

/* ---------- organization validation ---------- */

/* The anchor is required (a federal Title must be 1-50), and every level the
   user turned on must carry a 1-2 character code. Returns null when the path
   is acceptable, or a description of the first problem. */
function checkOrg(j, values, checked) {
  const anchor = anchorOf(j);
  if (!values[anchor]) return { status: "invalid", field: "anchor", reason: "missing" };
  if (j.kind === "federal" && !isValidTitle(values[anchor])) {
    return { status: "invalid", field: "anchor", reason: "range" };
  }
  for (const raw of Array.isArray(checked) ? checked : []) {
    const level = orgLevel(raw);
    if (!level || level === anchor) continue;
    const value = values[level];
    if (!value) return { status: "invalid", field: "level", level, reason: "missing" };
    if (!isValidCode(value)) return { status: "invalid", field: "level", level, reason: "format" };
  }
  return null;
}

/* ---------- mutations ---------- */

/* Add a section. Finds or creates the chapter matching the full organization
   path, rejects a duplicate section number, defaults both titles to UNKNOWN,
   and keeps sections in natural order. The anchor (a federal Title from 1 to 50,
   or a state chapter) and the section number are required. */
export function addSection(state, { jurisdiction, partValues, checked, chapterTitle, number, title, body }) {
  const j = findJurisdiction(state, jurisdiction) || state.jurisdictions[0] || null;
  if (!j) return { status: "no-jurisdiction" };

  const values = partValuesOf(j, partValues);
  const invalid = checkOrg(j, values, checked);
  if (invalid) return invalid;

  const num = String(number == null ? "" : number).trim();
  if (!num) return { status: "invalid", field: "number" };

  const sig = chapterSignature(j, values);
  let ch = state.chapters.find((c) => c.jurisdiction === j.key && chapterSignature(j, c.partValues) === sig);
  if (!ch) {
    ch = { id: uid(), jurisdiction: j.key, partValues: values, title: cleanTitle(chapterTitle), sections: [] };
    state.chapters.push(ch);
  } else {
    ch.partValues = values;
    if (chapterTitle && (ch.title === UNKNOWN || !ch.title)) ch.title = String(chapterTitle).trim();
  }

  if (ch.sections.some((s) => s.number === num)) {
    state.activeId = ch.id;
    return { status: "duplicate", chapter: ch, number: num };
  }

  ch.sections.push({ id: uid(), number: num, title: cleanTitle(title), body });
  ch.sections.sort(compareSections);
  state.activeId = ch.id;
  return { status: "added", chapter: ch, number: num };
}

/* Edit a chapter's organization values and title. The full path must stay
   unique within the jurisdiction, so an edit may not collide with another
   chapter; the anchor is required and a federal Title must be 1-50. */
export function updateChapter(state, id, { partValues, checked, title }) {
  const ch = state.chapters.find((c) => c.id === id);
  if (!ch) return { status: "missing" };
  const j = findJurisdiction(state, ch.jurisdiction);
  const values = partValuesOf(j, partValues);
  const invalid = checkOrg(j, values, checked);
  if (invalid) return invalid;

  const sig = chapterSignature(j, values);
  if (state.chapters.some((c) => c.id !== id && c.jurisdiction === ch.jurisdiction &&
    chapterSignature(j, c.partValues) === sig)) {
    return { status: "duplicate", number: values[anchorOf(j)] };
  }
  ch.partValues = values;
  ch.title = cleanTitle(title);
  return { status: "ok", chapter: ch };
}

/* Edit a section's number and title in place. The number is required and must
   stay unique within its chapter; the chapter is re-sorted afterwards. */
export function updateSection(state, id, { number, title }) {
  for (const ch of state.chapters) {
    const sec = ch.sections.find((s) => s.id === id);
    if (!sec) continue;
    const num = String(number == null ? "" : number).trim();
    if (!num) return { status: "invalid", field: "number" };
    if (num !== sec.number && ch.sections.some((s) => s.number === num)) {
      return { status: "duplicate", number: num, chapter: ch };
    }
    sec.number = num;
    sec.title = cleanTitle(title);
    ch.sections.sort(compareSections);
    return { status: "ok", chapter: ch, section: sec };
  }
  return { status: "missing" };
}

/* Remove a section by id. Exposed as a model primitive; the current UI does
   not wire a delete control. */
export function removeSection(state, id) {
  for (const ch of state.chapters) {
    const i = ch.sections.findIndex((s) => s.id === id);
    if (i !== -1) { ch.sections.splice(i, 1); return true; }
  }
  return false;
}

export function addJurisdiction(state, { name, kind }) {
  const clean = String(name == null ? "" : name).trim();
  if (!clean) return { status: "invalid" };
  const key = slugKey(clean);
  if (state.jurisdictions.some((j) => j.key === key)) return { status: "duplicate", key };
  const j = makeJurisdiction({ key, name: clean, kind });
  state.jurisdictions.push(j);
  return { status: "ok", jurisdiction: j };
}

/* Update a jurisdiction's display name and kind. The key is stable, so existing
   chapters keep their jurisdiction. */
export function updateJurisdiction(state, key, { name, kind }) {
  const j = findJurisdiction(state, key);
  if (!j) return { status: "missing" };
  const clean = String(name == null ? "" : name).trim();
  if (!clean) return { status: "invalid" };
  j.name = clean;
  j.kind = kind === "federal" ? "federal" : "state";
  return { status: "ok", jurisdiction: j };
}

/* Demo data that exercises the features: two jurisdictions with chapters, an
   out-of-order section list, tracked organization levels and chapter-wide
   definitions. */
export function sampleData() {
  const kentucky = makeJurisdiction({ key: "kentucky", name: "Kentucky", kind: "state" });

  const ky7 = {
    id: uid(), jurisdiction: kentucky.key, partValues: { Chapter: "7" }, title: "Public Utilities",
    sections: [
      {
        id: uid(), number: "7-4", title: "Certificates",
        body: "The authority may issue a certificate of public convenience and necessity only after notice and a hearing."
      },
      {
        id: uid(), number: "7-1", title: "Application",
        body: "This chapter applies to every public utility that receives a certificate of public convenience and necessity.\n(a) The authority shall review each application within 60 days.\n    (1) The authority may request additional information.\n    (2) A decision must issue within the period stated.\n(b) An applicant may appeal a denial as provided in section 7-9."
      },
      {
        id: uid(), number: "7-3", title: "Rate filings",
        body: "(a) Every public utility shall file its rates with the authority.\n(1) A filing must state the net income for the preceding year.\n(2) The authority shall accept or reject each filing within 90 days."
      },
      {
        id: uid(), number: "7-2", title: "Definitions",
        body: "As used in this chapter:\n\u201CAuthority\u201D means the Department of Public Utilities.\n\u201CNet income\u201D means gross income less allowable deductions.\n\u201CCertificate of public convenience and necessity\u201D and \u201Ccertificate\u201D mean an authorization issued under section 7-4.\n\u201CRate\u201D means a charge set by the Authority for service rendered under a certificate."
      }
    ]
  };

  const ky12 = {
    id: uid(), jurisdiction: kentucky.key, partValues: { Chapter: "12" }, title: "Taxation",
    sections: [
      { id: uid(), number: "12-1", title: "Imposition", body: "A tax is imposed on the net income of every resident." }
    ]
  };

  const us42 = {
    id: uid(), jurisdiction: "federal",
    partValues: { Title: "42", Chapter: "21", Subchapter: "IV" },
    title: "Civil Rights",
    sections: [
      {
        id: uid(), number: "1983", title: "Civil action for deprivation of rights",
        body: "Every person who, under color of law, subjects any citizen to the deprivation of any rights secured by the Constitution shall be liable to the party injured."
      }
    ]
  };

  return {
    jurisdictions: seedJurisdictions([makeJurisdiction({ key: "federal", name: "Federal", kind: "federal" }), kentucky]),
    chapters: [ky7, ky12, us42],
    activeId: ky7.id
  };
}
