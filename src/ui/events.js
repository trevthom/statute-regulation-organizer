/* All addEventListener wiring. Reads and mutates app state through the small
   context main.js hands us, and returns the render handlers the document and
   sidebar use for their edit buttons. */

import {
  LEVEL_MAX, addSection, currentChapter, emptyState, findJurisdiction, partPath,
  updateChapter, updateSection
} from "../core/model.js";
import { normalizeBody } from "../core/text.js";
import { save } from "../storage/local.js";
import { exportChapter } from "../export/html.js";
import { readOrg, resetSectionRows, toast } from "./render.js";

const $ = (id) => document.getElementById(id);

/* Only the Section row is required (it carries the section number), plus the
   state when the statute is filed under a state. */
const NOTE = "Only the section number is required. Every other level you check takes up to " +
  LEVEL_MAX + " letters, numbers, parentheses or hyphens, and an optional title.";

function hint(message) {
  $("hint").textContent = message || NOTE;
}

function chapterLabel(state, ch) {
  const j = findJurisdiction(state, ch.jurisdiction);
  return partPath(ch.partValues, ch.partTitles) || (j ? j.name : "this jurisdiction");
}

/* What a rejected organization row means to the user. */
function orgMessage(result) {
  return result.reason === "missing"
    ? "Enter a value for the " + result.level + "."
    : "The " + result.level + " can only use up to " + LEVEL_MAX +
      " letters, numbers, parentheses or hyphens.";
}

/* Refuse to add before touching state when a required field is empty. The model
   checks the same things, so a caller that skips this cannot sneak a section
   in. */
function missingRequired(org) {
  if (org.kind === "state" && !org.jurisdictionKey) return "Choose the state.";
  if (!org.values.Section) return "Enter the section number.";
  return "";
}

function onAdd(app) {
  const state = app.getState();
  const org = readOrg();

  const missing = missingRequired(org);
  if (missing) {
    hint(missing);
    toast(missing, "warn");
    return;
  }

  const body = normalizeBody($("paste").value);
  if (!body) {
    hint("Paste the statute or regulation text first.");
    toast("Paste the statute or regulation text first.", "warn");
    return;
  }

  const result = addSection(state, {
    jurisdiction: org.jurisdictionKey,
    partValues: org.values,
    partTitles: org.titles,
    checked: org.checked,
    body
  });
  save(state);

  if (result.status === "no-jurisdiction") {
    hint("Choose the state.");
    toast("Choose the state.", "warn");
    return;
  }
  if (result.status === "invalid") {
    const message = orgMessage(result);
    hint(message);
    toast(message, "warn");
    return;
  }
  if (result.status === "duplicate") {
    hint("");
    app.render();
    toast("Section " + result.number + " is already in " + chapterLabel(state, result.chapter) + ".", "warn");
    return;
  }

  $("paste").value = "";
  resetSectionRows();
  hint("");
  app.render();
  toast("Added \u00a7 " + result.number + " to " + chapterLabel(state, result.chapter) + ".", "ok");
}

function setEditing(app, next) {
  app.getView().editing = next;
  app.render();
}

/* ---------- chapter / section edits ---------- */

function saveChapterEdit(app, id, draft) {
  const state = app.getState();
  const result = updateChapter(state, id, draft);
  if (result.status === "invalid") { toast(orgMessage(result), "warn"); return; }
  if (result.status === "duplicate") { toast("That organization path already exists in this jurisdiction.", "warn"); return; }
  if (result.status === "missing") { setEditing(app, null); return; }
  save(state);
  setEditing(app, null);
  toast("Organizational levels updated.", "ok");
}

function saveSectionEdit(app, id, draft) {
  const state = app.getState();
  const result = updateSection(state, id, draft);
  if (result.status === "invalid") { toast(orgMessage(result), "warn"); return; }
  if (result.status === "duplicate") {
    toast("Section " + result.number + " is already in " + chapterLabel(state, result.chapter) + ".", "warn");
    return;
  }
  if (result.status === "missing") { setEditing(app, null); return; }
  save(state);
  setEditing(app, null);
  toast("Section updated.", "ok");
}

/* ---------- wiring ---------- */

export function initEvents(app) {
  hint("");

  $("add").addEventListener("click", () => onAdd(app));

  $("xOne").addEventListener("click", () => {
    const state = app.getState();
    const ch = currentChapter(state);
    if (!ch) { toast("Nothing to export.", "warn"); return; }
    exportChapter(ch, findJurisdiction(state, ch.jurisdiction));
  });

  $("xAll").addEventListener("click", () => {
    const state = app.getState();
    if (!state.chapters.length) { toast("Nothing to export.", "warn"); return; }
    for (const ch of state.chapters) exportChapter(ch, findJurisdiction(state, ch.jurisdiction));
  });

  $("clear").addEventListener("click", () => {
    if (!app.getState().chapters.length) return;
    if (!confirm("Delete all chapters and sections? This cannot be undone.")) return;
    app.setState(emptyState());
    app.getView().editing = null;
    save(app.getState());
    app.render();
    hint("");
  });

  return {
    onSelectChapter(id) {
      app.getState().activeId = id;
      save(app.getState());
      setEditing(app, null);
    },
    onEditChapter(id) { setEditing(app, { type: "chapter", id }); },
    onEditSection(id) { setEditing(app, { type: "section", id }); },
    onCancelEdit() { setEditing(app, null); },
    onSaveChapter(id, draft) { saveChapterEdit(app, id, draft); },
    onSaveSection(id, draft) { saveSectionEdit(app, id, draft); }
  };
}
