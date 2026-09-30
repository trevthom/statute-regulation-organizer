/* State mutations over plain data. No DOM, no storage: callers own persistence
   and rendering so this module stays easy to unit-test.

   The library is organized as:

     jurisdiction (the federal system, or one of the 50 states)
       └─ chapter   (a filing area, identified by the organization path the
                     user filled in below that jurisdiction)
            └─ section

   Every jurisdiction files statutes under the same fixed hierarchy, outermost
   level first:

     Title → Subtitle → Division → Chapter → Subchapter → Part → Subpart →
     Section → Subsection

   The first seven levels organize a chapter; the last two describe the section
   itself (its number, and an optional deeper designation such as a paragraph).
   Nothing is automatic — a federal Title is just another optional level,
   because not every state has one. Every level the user turns on carries a
   value of up to 12 letters, digits, parentheses or hyphens plus an optional
   title, and the Section row is always on, so a section always has a number.

   A chapter's identity within its jurisdiction is its organization path
   (`chapterSignature`): a statute that fills in the same levels with the same
   values joins the same chapter, and a different path starts another one.
   Section numbers stay unique within a chapter, sorting naturally
   (7-2 < 7-10). */

import { naturalCmp } from "./sort.js";

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/* The organization hierarchy, outermost level first. These names are also the
   keys of a chapter's `partValues` / `partTitles`, so their spelling is part of
   the stored data — renaming one needs a migration. */
export const ORG_LEVELS = [
  "Title", "Subtitle", "Division", "Chapter", "Subchapter", "Part", "Subpart",
  "Section", "Subsection"
];

/* Section and Subsection describe the section being filed (its number and an
   optional deeper designation); every other level organizes the chapter. A
   chapter's identity is built from the chapter levels alone, so several
   sections can share one chapter. */
export const SECTION_LEVELS = ["Section", "Subsection"];
export const CHAPTER_LEVELS = ORG_LEVELS.filter((l) => !SECTION_LEVELS.includes(l));

/* Every level's value: up to 12 characters, letters, digits, parentheses and
   hyphens only. */
export const LEVEL_MAX = 12;
const LEVEL_RE = /^[A-Za-z0-9()\-]{1,12}$/;

export function isValidLevelValue(value) {
  return LEVEL_RE.test(String(value == null ? "" : value).trim());
}

/* The jurisdiction list is closed: the federal system plus these states. Their
   names are also the sidebar labels and the `key` is derived from the name, so
   the list is stable. */
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

/* The canonical spelling of a level name, or null when it is not one. */
export function orgLevel(name) {
  const s = String(name == null ? "" : name).trim().toLowerCase();
  return ORG_LEVELS.find((l) => l.toLowerCase() === s) || null;
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

/* Federal first, then every state, keeping anything already there (and its
   chapters). Used by emptyState and by the storage migration so both ends up
   with the same, closed list. */
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

/* Keep only the levels that carry a value, in hierarchy order. Titles are as
   free-form as the user likes, so they are only trimmed. */
function pick(values, levels) {
  const src = values || {};
  const out = {};
  for (const t of levels) {
    const v = String(src[t] == null ? "" : src[t]).trim();
    if (v) out[t] = v;
  }
  return out;
}

export function chapterValues(values) {
  return pick(values, CHAPTER_LEVELS);
}

export function chapterTitles(titles) {
  return pick(titles, CHAPTER_LEVELS);
}

/* Identity of a chapter within its jurisdiction: the organization path of the
   chapter levels, so Title 42 Chapter 21 and Title 15 Chapter 21 stay distinct
   while a statute with the same path joins the same chapter. */
export function chapterSignature(values) {
  const v = values || {};
  return CHAPTER_LEVELS
    .map((t) => [t.toLowerCase(), String(v[t] == null ? "" : v[t]).trim().toLowerCase()])
    .filter(([, value]) => value)
    .map(([level, value]) => level + "=" + value)
    .join("|");
}

/* "Title 42 — Civil Rights · Chapter 21": the levels that carry a value, in
   hierarchy order, each followed by its optional title. */
export function partPath(values, titles) {
  const v = values || {};
  const t = titles || {};
  const bits = [];
  for (const level of ORG_LEVELS) {
    const value = String(v[level] == null ? "" : v[level]).trim();
    if (!value) continue;
    const title = String(t[level] == null ? "" : t[level]).trim();
    bits.push(level + " " + value + (title ? " \u2014 " + title : ""));
  }
  return bits.join(" \u00b7 ");
}

/* Document/sidebar order: organization values in hierarchy order, then the
   optional titles. */
export function compareChapters(a, b) {
  for (const t of ORG_LEVELS) {
    const c = naturalCmp((a.partValues || {})[t] || "", (b.partValues || {})[t] || "");
    if (c) return c;
  }
  for (const t of ORG_LEVELS) {
    const c = naturalCmp((a.partTitles || {})[t] || "", (b.partTitles || {})[t] || "");
    if (c) return c;
  }
  return 0;
}

export function chaptersInOrder(state, jurisdictionKey) {
  return chaptersOf(state, jurisdictionKey).sort(compareChapters);
}

export function currentChapter(state) {
  return state.chapters.find((c) => c.id === state.activeId) || state.chapters[0] || null;
}

/* A section's designation: its number, plus an optional subsection in
   parentheses, so § 1983(a) and § 1983(b) can both live in one chapter. */
export function sectionKey(section) {
  const n = String((section || {}).number == null ? "" : section.number).trim();
  const sub = String((section || {}).subsection == null ? "" : section.subsection).trim();
  return sub ? n + "(" + sub + ")" : n;
}

/* Section order. Every section has a number; a blank one (only possible in data
   carried over from an older store) sorts last rather than first. */
export function compareSections(a, b) {
  const x = sectionKey(a);
  const y = sectionKey(b);
  if (!x && !y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  return naturalCmp(x, y);
}

/* ---------- organization validation ---------- */

function checkLevel(values, level) {
  const raw = String((values || {})[level] == null ? "" : values[level]).trim();
  if (!raw) return { status: "invalid", field: "level", level, reason: "missing" };
  if (!isValidLevelValue(raw)) return { status: "invalid", field: "level", level, reason: "format" };
  return null;
}

/* Every level the user turned on must carry a value. Returns null when the
   path is acceptable, or a description of the first problem. */
function checkOrg(values, checked, levels) {
  const on = new Set((Array.isArray(checked) ? checked : []).map((c) => String(c).toLowerCase()));
  for (const level of levels) {
    if (!on.has(level.toLowerCase())) continue;
    const invalid = checkLevel(values, level);
    if (invalid) return invalid;
  }
  return null;
}

/* The levels the user turned on, with the values and titles they carry. An
   unticked level keeps its text in the form but never reaches the path. */
function pickChecked(values, titles, checked) {
  const src = values || {};
  const srcTitles = titles || {};
  const on = new Set((Array.isArray(checked) ? checked : []).map((c) => String(c).toLowerCase()));
  const out = { values: {}, titles: {} };
  for (const level of ORG_LEVELS) {
    if (!on.has(level.toLowerCase())) continue;
    const value = String(src[level] == null ? "" : src[level]).trim();
    if (value) out.values[level] = value;
    const title = String(srcTitles[level] == null ? "" : srcTitles[level]).trim();
    if (title) out.titles[level] = title;
  }
  return out;
}

/* ---------- mutations ---------- */

/* Add a section. The Section row is always on, so a section always has its own
   number; it finds or creates the chapter matching the organization path,
   rejects a duplicate designation, keeps the optional level titles and sorts
   the sections naturally. */
export function addSection(state, { jurisdiction, partValues, partTitles, checked, body }) {
  const j = findJurisdiction(state, jurisdiction);
  if (!j) return { status: "no-jurisdiction" };

  const on = (checked || []).concat(["Section"]);
  const invalid = checkOrg(partValues, on, ORG_LEVELS);
  if (invalid) return invalid;

  const picked = pickChecked(partValues, partTitles, on);
  const values = chapterValues(picked.values);
  const titles = chapterTitles(picked.titles);
  const sig = chapterSignature(values);
  let ch = state.chapters.find((c) => c.jurisdiction === j.key && chapterSignature(c.partValues) === sig);
  if (!ch) {
    ch = { id: uid(), jurisdiction: j.key, partValues: values, partTitles: titles, sections: [] };
    state.chapters.push(ch);
  } else {
    ch.partValues = values;
    ch.partTitles = Object.assign({}, ch.partTitles, titles);   // a title supplied later backfills
  }

  const sec = {
    id: uid(),
    number: picked.values.Section || "",
    title: picked.titles.Section || "",
    subsection: picked.values.Subsection || "",
    subsectionTitle: picked.titles.Subsection || "",
    body
  };

  const key = sectionKey(sec);
  if (ch.sections.some((s) => sectionKey(s) === key)) {
    state.activeId = ch.id;
    return { status: "duplicate", chapter: ch, number: key };
  }

  ch.sections.push(sec);
  ch.sections.sort(compareSections);
  state.activeId = ch.id;
  return { status: "added", chapter: ch, section: sec, number: key };
}

/* Edit a chapter's organization path (its chapter levels, never Section or
   Subsection, which belong to a section). The path must stay unique within the
   jurisdiction, so an edit may not collide with another chapter. */
export function updateChapter(state, id, { partValues, partTitles, checked }) {
  const ch = state.chapters.find((c) => c.id === id);
  if (!ch) return { status: "missing" };
  const invalid = checkOrg(partValues, checked, CHAPTER_LEVELS);
  if (invalid) return invalid;

  const picked = pickChecked(partValues, partTitles, checked);
  const values = chapterValues(picked.values);
  const sig = chapterSignature(values);
  if (state.chapters.some((c) => c.id !== id && c.jurisdiction === ch.jurisdiction &&
    chapterSignature(c.partValues) === sig)) {
    return { status: "duplicate", path: partPath(values, picked.titles) };
  }
  ch.partValues = values;
  ch.partTitles = chapterTitles(picked.titles);
  return { status: "ok", chapter: ch };
}

/* Edit a section's designation (its number, title, subsection) in place. The
   number is required and the designation must stay unique within its chapter;
   the chapter is re-sorted afterwards. */
export function updateSection(state, id, { number, title, subsection, subsectionTitle }) {
  for (const ch of state.chapters) {
    const sec = ch.sections.find((s) => s.id === id);
    if (!sec) continue;

    const invalid = checkLevel({ Section: number }, "Section");
    if (invalid) return invalid;
    const sub = String(subsection == null ? "" : subsection).trim();
    if (sub && !isValidLevelValue(sub)) {
      return { status: "invalid", field: "level", level: "Subsection", reason: "format" };
    }

    const key = sectionKey({ number, subsection: sub });
    if (key !== sectionKey(sec) && ch.sections.some((s) => s.id !== id && sectionKey(s) === key)) {
      return { status: "duplicate", number: key, chapter: ch };
    }
    sec.number = String(number).trim();
    sec.title = String(title == null ? "" : title).trim();
    sec.subsection = sub;
    sec.subsectionTitle = String(subsectionTitle == null ? "" : subsectionTitle).trim();
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
