/* Persistence. Both accessors swallow errors: a sandboxed or file:// origin
   can throw on setItem, and the app must keep working without storage.
   STORE_KEY is centralized here — bump the version and add a migration in
   load() whenever the stored shape changes. */

export const STORE_KEY = "chapterBuilder.v1";

export function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* unavailable or unparseable — start fresh */ }
  return null;
}

export function save(state) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) { /* sandboxed/file:// — ignore */ }
}
