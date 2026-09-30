/* Persistence. Both accessors swallow errors: a sandboxed or file:// origin
   can throw on setItem, and the app must keep working without storage.
   STORE_KEY is centralized here — bump the version and add a migration in
   load() whenever the stored shape changes. */

import { chapterTitles, chapterValues, seedJurisdictions, uid } from "../core/model.js";

export const STORE_KEY = "chapterBuilder.v4";
const LEGACY_KEYS = ["chapterBuilder.v3", "chapterBuilder.v2", "chapterBuilder.v1"];

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* unavailable or unparseable — start fresh */ }
  return null;
}

/* Older shapes carried the jurisdiction's organization (`parts`, `dividers`) and
   a single chapter title. The hierarchy is fixed now, so those fields are
   dropped, a chapter keeps only its chapter-level values and gains the per-level
   `partTitles` map, each section gains the Subsection fields, and the
   jurisdiction list is topped up with Federal and every state. */
function migrateChapter(ch) {
  const src = ch || {};
  return {
    id: src.id || uid(),
    jurisdiction: src.jurisdiction,
    partValues: chapterValues(src.partValues),
    partTitles: chapterTitles(src.partTitles),
    sections: (Array.isArray(src.sections) ? src.sections : []).map((s) => ({
      id: s.id || uid(),
      number: String(s.number == null ? "" : s.number).trim(),
      title: String(s.title == null ? "" : s.title).trim(),
      subsection: String(s.subsection == null ? "" : s.subsection).trim(),
      subsectionTitle: String(s.subsectionTitle == null ? "" : s.subsectionTitle).trim(),
      body: s.body == null ? "" : s.body
    }))
  };
}

export function migrate(saved) {
  if (!saved || !Array.isArray(saved.jurisdictions)) return saved;
  return {
    jurisdictions: seedJurisdictions(saved.jurisdictions),
    chapters: (Array.isArray(saved.chapters) ? saved.chapters : []).map(migrateChapter),
    activeId: saved.activeId == null ? null : saved.activeId
  };
}

export function load() {
  const current = read(STORE_KEY);
  if (current) return migrate(current);
  for (const key of LEGACY_KEYS) {
    const older = read(key);
    if (older) return migrate(older);
  }
  return null;
}

export function save(state) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) { /* sandboxed/file:// — ignore */ }
}
