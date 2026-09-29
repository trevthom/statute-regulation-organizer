/* State mutations over plain data. No DOM, no storage: callers own persistence
   and rendering so this module stays easy to unit-test.

   The library is organized as:

     jurisdiction (a state, or Federal)
       └─ chapter   (the unit that groups sections; its designation comes from
                     the jurisdiction's organization parts)
            └─ section

   A jurisdiction declares an ordered list of "organization parts" — the levels a
   statute is filed under (e.g. Federal: Title, Chapter, Subchapter, Part).
   States default to just Chapter. The Chapter level is the anchor: it is always
   present and its value is the required chapter number. A chapter stores one
   value per part (`partValues`) plus a title that defaults to UNKNOWN. */

import { naturalCmp } from "./sort.js";

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export const UNKNOWN = "UNKNOWN";
export const ANCHOR = "Chapter";                 // the level that groups sections
export const FEDERAL_PARTS = ["Title", ANCHOR, "Subchapter", "Part"];

const isAnchor = (t) => String(t).toLowerCase() === ANCHOR.toLowerCase();

function cleanTitle(value) {
  const s = String(value == null ? "" : value).trim();
  return s || UNKNOWN;
}

export function slugKey(name) {
  const s = String(name == null ? "" : name).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || uid();
}

/* Part-type names, trimmed, de-duplicated case-insensitively, with the Chapter
   anchor guaranteed to be present (appended last when the caller omitted it). */
export function normalizeParts(parts) {
  const out = [];
  for (const raw of Array.isArray(parts) ? parts : []) {
    const t = String(raw == null ? "" : raw).trim();
    if (!t) continue;
    if (out.some((x) => x.toLowerCase() === t.toLowerCase())) continue;
    out.push(t);
  }
  if (!out.some(isAnchor)) out.push(ANCHOR);
  return out;
}

export function makeJurisdiction({ key, name, kind, parts }) {
  const clean = String(name == null ? "" : name).trim();
  return {
    key: key || slugKey(clean),
    name: clean || "Untitled jurisdiction",
    kind: kind === "federal" ? "federal" : "state",
    parts: normalizeParts(parts)
  };
}

export function emptyState() {
  return {
    jurisdictions: [
      makeJurisdiction({ key: "federal", name: "Federal", kind: "federal", parts: FEDERAL_PARTS })
    ],
    chapters: [],
    activeId: null
  };
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

export function chapterNumber(ch) {
  return String((ch.partValues && ch.partValues[ANCHOR]) || "").trim();
}

/* Reduce free-form input to exactly the jurisdiction's part types, trimmed. */
export function partValuesOf(jurisdiction, input) {
  const out = {};
  const src = input || {};
  for (const t of jurisdiction ? jurisdiction.parts : [ANCHOR]) {
    out[t] = String(src[t] == null ? "" : src[t]).trim();
  }
  return out;
}

/* Identity of a chapter within its jurisdiction: the full part path, so Title 42
   Chapter 21 and Title 15 Chapter 21 stay distinct. */
export function chapterSignature(jurisdiction, values) {
  const order = jurisdiction ? jurisdiction.parts : [ANCHOR];
  return order.map((t) => t.toLowerCase() + "=" + String((values || {})[t] || "").trim().toLowerCase()).join("|");
}

/* "Title 42 · Chapter 21" — the parts that actually have a value, in order. */
export function partPath(jurisdiction, values) {
  const order = jurisdiction ? jurisdiction.parts : [ANCHOR];
  const bits = [];
  for (const t of order) {
    const v = String((values || {})[t] || "").trim();
    if (v) bits.push(t + " " + v);
  }
  return bits.join(" \u00b7 ");
}

/* Document/sidebar order: part values in jurisdiction order, then title. */
export function compareChapters(jurisdiction, a, b) {
  const order = jurisdiction ? jurisdiction.parts : [ANCHOR];
  for (const t of order) {
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

/* Add a section. Finds or creates the chapter matching the full part path,
   rejects a duplicate section number, defaults both titles to UNKNOWN, and
   keeps sections in natural order. Only the chapter number and the section
   number are required. Returns a small result description. */
export function addSection(state, { jurisdiction, partValues, chapterTitle, number, title, body }) {
  const j = findJurisdiction(state, jurisdiction) || state.jurisdictions[0] || null;
  if (!j) return { status: "no-jurisdiction" };

  const values = partValuesOf(j, partValues);
  if (!values[ANCHOR]) return { status: "invalid", field: "chapter" };
  const num = String(number == null ? "" : number).trim();
  if (!num) return { status: "invalid", field: "section" };

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
  ch.sections.sort((a, b) => naturalCmp(a.number, b.number));
  state.activeId = ch.id;
  return { status: "added", chapter: ch, number: num };
}

/* Edit a chapter's organization values and title. The full part path must stay
   unique within the jurisdiction, so an edit may not collide with another
   chapter; a blank chapter number is refused. */
export function updateChapter(state, id, { partValues, title }) {
  const ch = state.chapters.find((c) => c.id === id);
  if (!ch) return { status: "missing" };
  const j = findJurisdiction(state, ch.jurisdiction);
  const values = partValuesOf(j, partValues);
  if (!values[ANCHOR]) return { status: "invalid", field: "chapter" };
  const sig = chapterSignature(j, values);
  if (state.chapters.some((c) => c.id !== id && c.jurisdiction === ch.jurisdiction &&
    chapterSignature(j, c.partValues) === sig)) {
    return { status: "duplicate", number: values[ANCHOR] };
  }
  ch.partValues = values;
  ch.title = cleanTitle(title);
  return { status: "ok", chapter: ch };
}

/* Edit a section's number and title in place. The number must stay unique within
   its chapter (same rule as adding) and the chapter is re-sorted. */
export function updateSection(state, id, { number, title }) {
  for (const ch of state.chapters) {
    const sec = ch.sections.find((s) => s.id === id);
    if (!sec) continue;
    const num = String(number == null ? "" : number).trim();
    if (!num) return { status: "invalid" };
    if (num !== sec.number && ch.sections.some((s) => s.number === num)) {
      return { status: "duplicate", number: num, chapter: ch };
    }
    sec.number = num;
    sec.title = cleanTitle(title);
    ch.sections.sort((a, b) => naturalCmp(a.number, b.number));
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

export function addJurisdiction(state, { name, kind, parts }) {
  const clean = String(name == null ? "" : name).trim();
  if (!clean) return { status: "invalid" };
  const key = slugKey(clean);
  if (state.jurisdictions.some((j) => j.key === key)) return { status: "duplicate", key };
  const j = makeJurisdiction({ key, name: clean, kind, parts });
  state.jurisdictions.push(j);
  return { status: "ok", jurisdiction: j };
}

/* Update a jurisdiction's display name, kind and organization parts. The key is
   stable, so existing chapters keep their jurisdiction. Parts are normalized
   (Chapter always present); values for a removed part type are left in place and
   simply stop being shown, so re-adding the type restores them. */
export function updateJurisdiction(state, key, { name, kind, parts }) {
  const j = findJurisdiction(state, key);
  if (!j) return { status: "missing" };
  const clean = String(name == null ? "" : name).trim();
  if (!clean) return { status: "invalid" };
  j.name = clean;
  j.kind = kind === "federal" ? "federal" : "state";
  if (Array.isArray(parts)) j.parts = normalizeParts(parts);
  return { status: "ok", jurisdiction: j };
}

/* Demo data that exercises the features: two jurisdictions, out-of-order
   sections, federal organization levels, and chapter-wide definitions. */
export function sampleData() {
  const federal = makeJurisdiction({ key: "federal", name: "Federal", kind: "federal", parts: FEDERAL_PARTS });
  const kentucky = makeJurisdiction({ key: "kentucky", name: "Kentucky", kind: "state", parts: [ANCHOR] });

  const ky7 = {
    id: uid(), jurisdiction: kentucky.key, partValues: { [ANCHOR]: "7" }, title: "Public Utilities",
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
    id: uid(), jurisdiction: kentucky.key, partValues: { [ANCHOR]: "12" }, title: "Taxation",
    sections: [
      { id: uid(), number: "12-1", title: "Imposition", body: "A tax is imposed on the net income of every resident." }
    ]
  };

  const us42 = {
    id: uid(), jurisdiction: federal.key,
    partValues: { Title: "42", [ANCHOR]: "21", Subchapter: "IV", Part: "" },
    title: "Civil Rights",
    sections: [
      {
        id: uid(), number: "1983", title: "Civil action for deprivation of rights",
        body: "Every person who, under color of law, subjects any citizen to the deprivation of any rights secured by the Constitution shall be liable to the party injured."
      }
    ]
  };

  return {
    jurisdictions: [federal, kentucky],
    chapters: [ky7, ky12, us42],
    activeId: ky7.id
  };
}
