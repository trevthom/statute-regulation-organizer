/* All addEventListener wiring. Reads and mutates app state through the small
   context main.js hands us, and returns the render handlers the document and
   sidebar use for their edit buttons. */

import { addSection, currentChapter, emptyState, renameChapter, sampleData, updateSection } from "../core/model.js";
import { normalizeBody } from "../core/text.js";
import { save } from "../storage/local.js";
import { exportChapter } from "../export/html.js";
import { toast } from "./render.js";

const $ = (id) => document.getElementById(id);

/* Chapter, chapter title, section number and section title are entered by hand:
   the pasted text is treated purely as the wording of the section, so nothing
   is parsed out of it. */
const REQUIRED = [
  ["chNum", "Chapter"],
  ["chTitle", "Chapter title"],
  ["secNum", "Section number"],
  ["secTitle", "Section title"]
];

function joinList(items) {
  if (items.length === 1) return items[0];
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

const REQUIRED_NOTE = "All four fields are required. The pasted text is used only as the section wording.";

function hint(message) {
  $("hint").textContent = message || REQUIRED_NOTE;
}

function onAdd(app) {
  const state = app.getState();

  const missing = REQUIRED.filter(([id]) => !$(id).value.trim()).map(([, label]) => label);
  if (missing.length) {
    const message = "Enter the " + joinList(missing) + ".";
    hint(message);
    toast(message, "warn");
    return;
  }

  const body = normalizeBody($("paste").value);
  if (!body) {
    const message = "Paste the statute or regulation text first.";
    hint(message);
    toast(message, "warn");
    return;
  }

  const draft = {
    chapterNumber: $("chNum").value.trim(),
    chapterTitle: $("chTitle").value.trim(),
    number: $("secNum").value.trim(),
    title: $("secTitle").value.trim(),
    body
  };

  const result = addSection(state, draft);
  save(state);

  if (result.status === "duplicate") {
    hint("");
    app.render();
    toast("Section " + draft.number + " is already in Chapter " + result.chapter.key + ".", "warn");
    return;
  }

  for (const [id] of REQUIRED) $(id).value = "";
  $("paste").value = "";
  hint("");
  app.render();
  toast("Added \u00a7 " + draft.number + " to Chapter " + result.chapter.key + ".", "ok");
}

function setEditing(app, next) {
  app.getView().editing = next;
  app.render();
}

function saveChapterEdit(app, oldKey, draft) {
  const state = app.getState();
  const result = renameChapter(state, oldKey, draft.key, draft.title);
  if (result.status === "invalid") { toast("Chapter name cannot be empty.", "warn"); return; }
  if (result.status === "duplicate") { toast("Chapter " + result.key + " already exists.", "warn"); return; }
  if (result.status === "missing") { setEditing(app, null); return; }
  save(state);
  setEditing(app, null);
  toast("Chapter updated.", "ok");
}

function saveSectionEdit(app, id, draft) {
  const state = app.getState();
  const result = updateSection(state, id, draft);
  if (result.status === "invalid") { toast("Section number cannot be empty.", "warn"); return; }
  if (result.status === "duplicate") {
    toast("Section " + result.number + " is already in Chapter " + result.chapter.key + ".", "warn");
    return;
  }
  if (result.status === "missing") { setEditing(app, null); return; }
  save(state);
  setEditing(app, null);
  toast("Section updated.", "ok");
}

export function initEvents(app) {
  hint("");

  $("add").addEventListener("click", () => onAdd(app));

  $("xOne").addEventListener("click", () => {
    const ch = currentChapter(app.getState());
    if (!ch) { toast("Nothing to export.", "warn"); return; }
    exportChapter(ch);
  });

  $("xAll").addEventListener("click", () => {
    const chapters = app.getState().chapters;
    if (!chapters.length) { toast("Nothing to export.", "warn"); return; }
    for (const ch of chapters) exportChapter(ch);
  });

  $("sample").addEventListener("click", () => {
    app.setState(sampleData());
    app.getView().editing = null;
    save(app.getState());
    app.render();
    toast("Sample loaded.", "ok");
  });

  $("clear").addEventListener("click", () => {
    if (!app.getState().chapters.length) return;
    if (!confirm("Delete all chapters and sections? This cannot be undone.")) return;
    app.setState(emptyState());
    app.getView().editing = null;
    save(app.getState());
    app.render();
  });

  return {
    onSelectChapter(key) {
      app.getState().activeKey = key;
      save(app.getState());
      setEditing(app, null);
    },
    onEditChapter(key) { setEditing(app, { type: "chapter", key }); },
    onEditSection(id) { setEditing(app, { type: "section", id }); },
    onCancelEdit() { setEditing(app, null); },
    onSaveChapter(key, draft) { saveChapterEdit(app, key, draft); },
    onSaveSection(id, draft) { saveSectionEdit(app, id, draft); }
  };
}
