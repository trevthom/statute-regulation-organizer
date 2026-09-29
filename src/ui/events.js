/* All addEventListener wiring. Reads and mutates app state through the small
   context main.js hands us, and returns the render handlers the document and
   sidebar use for their edit buttons. */

import {
  addJurisdiction, addSection, anchorOf, currentChapter, emptyState, findJurisdiction, partPath,
  sampleData, updateChapter, updateJurisdiction, updateSection
} from "../core/model.js";
import { normalizeBody } from "../core/text.js";
import { save } from "../storage/local.js";
import { exportChapter } from "../export/html.js";
import { mountOrgTree, readOrg, renderComposerLabels, toast } from "./render.js";

const $ = (id) => document.getElementById(id);

function joinList(items) {
  if (items.length === 1) return items[0];
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

function selectedJurisdiction(state) {
  return findJurisdiction(state, $("jurisdiction").value) || state.jurisdictions[0] || null;
}

/* The two required fields: the anchor (a federal Title from 1 to 50, or a
   state's chapter) and the section number. */
function defaultNote(state) {
  const j = selectedJurisdiction(state);
  const anchor = anchorOf(j);
  const federal = !!j && j.kind === "federal";
  return "Only the " + anchor + " and the section number are required" +
    (federal ? " \u2014 a Title is 1 to 50" : "") +
    ". Every level you check takes 1\u20132 letters or numbers; titles are optional.";
}

let note = "";
function hint(message) {
  $("hint").textContent = message || note;
}

function chapterLabel(state, ch) {
  const j = findJurisdiction(state, ch.jurisdiction);
  return partPath(j, ch.partValues) || anchorOf(j);
}

/* What a rejected organization path means to the user. */
function orgMessage(anchor, result) {
  if (result.field === "anchor") {
    return result.reason === "range"
      ? "A Title must be a number from 1 to 50."
      : "Choose the " + anchor + ".";
  }
  return result.reason === "missing"
    ? "Enter 1\u20132 letters or numbers for the " + result.level + "."
    : "The " + result.level + " can only be 1\u20132 letters or numbers.";
}

/* Keep the composer's labels, organization tree and hint in step with the
   selected jurisdiction. */
function updateComposer(state) {
  const j = selectedJurisdiction(state);
  renderComposerLabels(j);
  mountOrgTree(j);
  note = defaultNote(state);
  hint("");
}

/* Refuse to add before touching state when a required field is empty, and say
   everything that is missing at once. The model checks the same things, so a
   caller that skips this cannot sneak a section in. */
function missingRequired(org, jurisdiction) {
  const anchor = anchorOf(jurisdiction);
  const missing = [];
  if (!org.values[anchor]) missing.push(anchor);
  if (!$("secNum").value.trim()) missing.push("section number");
  return missing.length ? "Enter the " + joinList(missing) + "." : "";
}

function onAdd(app) {
  const state = app.getState();
  const jurisdiction = selectedJurisdiction(state);
  const anchor = anchorOf(jurisdiction);

  const org = readOrg();
  const missing = missingRequired(org, jurisdiction);
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
    jurisdiction: jurisdiction ? jurisdiction.key : "",
    partValues: org.values,
    checked: org.checked,
    chapterTitle: $("chTitle").value.trim(),
    number: $("secNum").value.trim(),
    title: $("secTitle").value.trim(),
    body
  });
  save(state);

  if (result.status === "no-jurisdiction") {
    hint("Add a jurisdiction first.");
    toast("Add a jurisdiction in the sidebar first.", "warn");
    return;
  }
  if (result.status === "invalid") {
    const message = result.field === "number" ? "Enter the section number." : orgMessage(anchor, result);
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

  $("chTitle").value = "";
  $("secNum").value = "";
  $("secTitle").value = "";
  $("paste").value = "";
  hint("");
  app.render();
  toast("Added " + (result.number ? "\u00a7 " + result.number : "the section") +
    " to " + chapterLabel(state, result.chapter) + ".", "ok");
}

function setEditing(app, next) {
  app.getView().editing = next;
  app.render();
}

/* ---------- chapter / section edits ---------- */

function saveChapterEdit(app, id, draft) {
  const state = app.getState();
  const ch = state.chapters.find((c) => c.id === id);
  const anchor = anchorOf(ch && findJurisdiction(state, ch.jurisdiction));
  const result = updateChapter(state, id, draft);
  if (result.status === "invalid") { toast(orgMessage(anchor, result), "warn"); return; }
  if (result.status === "duplicate") { toast("That chapter already exists in this jurisdiction.", "warn"); return; }
  if (result.status === "missing") { setEditing(app, null); return; }
  save(state);
  setEditing(app, null);
  toast("Chapter updated.", "ok");
}

function saveSectionEdit(app, id, draft) {
  const state = app.getState();
  const result = updateSection(state, id, draft);
  if (result.status === "invalid") { toast("Enter the section number.", "warn"); return; }
  if (result.status === "duplicate") {
    toast("Section " + result.number + " is already in " + chapterLabel(state, result.chapter) + ".", "warn");
    return;
  }
  if (result.status === "missing") { setEditing(app, null); return; }
  save(state);
  setEditing(app, null);
  toast("Section updated.", "ok");
}

/* ---------- jurisdiction edits ---------- */

function saveJurisdictionEdit(app, name, kind) {
  const state = app.getState();
  const ed = app.getView().editing;
  if (!ed || ed.type !== "jurisdiction") return;
  const draft = { name, kind };
  const result = ed.key == null ? addJurisdiction(state, draft) : updateJurisdiction(state, ed.key, draft);
  if (result.status === "invalid") { toast("Jurisdiction name cannot be empty.", "warn"); return; }
  if (result.status === "duplicate") { toast("A jurisdiction with that name already exists.", "warn"); return; }
  if (result.status === "missing") { setEditing(app, null); return; }
  save(state);
  setEditing(app, null);
  toast("Jurisdiction saved.", "ok");
}

/* ---------- wiring ---------- */

export function initEvents(app) {
  note = defaultNote(app.getState());
  hint("");

  $("add").addEventListener("click", () => onAdd(app));
  $("jurisdiction").addEventListener("change", () => updateComposer(app.getState()));

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

  $("addJurisdiction").addEventListener("click", () => {
    setEditing(app, { type: "jurisdiction", key: null, draft: { name: "", kind: "state" } });
  });

  $("sample").addEventListener("click", () => {
    app.setState(sampleData());
    app.getView().editing = null;
    save(app.getState());
    app.render();
    updateComposer(app.getState());   // the anchor and note follow the new selection
    toast("Sample loaded.", "ok");
  });

  $("clear").addEventListener("click", () => {
    if (!app.getState().chapters.length) return;
    if (!confirm("Delete all chapters and sections? This cannot be undone.")) return;
    app.setState(emptyState());
    app.getView().editing = null;
    save(app.getState());
    app.render();
    updateComposer(app.getState());
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
    onSaveSection(id, draft) { saveSectionEdit(app, id, draft); },

    onEditJurisdiction(key) {
      const j = findJurisdiction(app.getState(), key);
      if (!j) return;
      setEditing(app, {
        type: "jurisdiction",
        key: j.key,
        draft: { name: j.name, kind: j.kind }
      });
    },
    onSaveJurisdiction(name, kind) { saveJurisdictionEdit(app, name, kind); }
  };
}
