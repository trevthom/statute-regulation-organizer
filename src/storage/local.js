/* Persistence. Both accessors swallow errors: a sandboxed or file:// origin
   can throw on setItem, and the app must keep working without storage.
   STORE_KEY is centralized here — bump the version and add a migration in
   load() whenever the stored shape changes. */

import { seedJurisdictions } from "../core/model.js";

export const STORE_KEY = "chapterBuilder.v3";
const LEGACY_KEYS = ["chapterBuilder.v2", "chapterBuilder.v1"];

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* unavailable or unparseable — start fresh */ }
  return null;
}

/* Older shapes carried the jurisdiction's organization (`parts`, `dividers`).
   The hierarchy is fixed now, so those fields are dropped, the jurisdiction
   list is topped up with Federal and every state, and chapters keep their
   partValues untouched. */
export function migrate(saved) {
  if (!saved || !Array.isArray(saved.jurisdictions)) return saved;
  return {
    jurisdictions: seedJurisdictions(saved.jurisdictions),
    chapters: Array.isArray(saved.chapters) ? saved.chapters : [],
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
