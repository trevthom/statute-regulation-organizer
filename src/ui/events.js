/* All addEventListener wiring. Reads and mutates app state through the small
   context main.js hands us, and returns the render handlers the document and
   sidebar use for their edit buttons. */

import {
  ANCHOR, FEDERAL_PARTS, addJurisdiction, addSection, currentChapter, emptyState, findJurisdiction,
  partPath, sampleData, updateChapter, updateJurisdiction, updateSection
} from "../core/model.js";
import { normalizeBody } from "../core/text.js";
import { save } from "../storage/local.js";
import { exportChapter } from "../export/html.js";
import { clearPartFields, readPartFields, renderPartFields, toast } from "./render.js";

const $ = (id) => document.getElementById(id);

/* Only the chapter number and the section number are required. Titles are
   optional and default to UNKNOWN; the pasted text is purely the wording. */
const REQUIRED = [
  ["chNum", "chapter number"],
  ["secNum", "section number"]
];

const REQUIRED_NOTE = "Only the chapter and section number are required. Titles default to UNKNOWN; " +
  "the pasted text is used only as the section wording.";

function joinList(items) {
  if (items.length === 1) return items[0];
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

function hint(message) {
  $("hint").textContent = message || REQUIRED_NOTE;
}

function chapterLabel(state, ch) {
  const j = findJurisdiction(state, ch.jurisdiction);
  return partPath(j, ch.partValues) || "Chapter";
}

function selectedJurisdiction(state) {
  const key = $("jurisdiction").value;
  return findJurisdiction(state, key) || state.jurisdictions[0] || null;
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

  const jurisdiction = selectedJurisdiction(state);
  const draft = {
    jurisdiction: jurisdiction ? jurisdiction.key : "",
    partValues: { ...readPartFields(), [ANCHOR]: $("chNum").value.trim() },
    chapterTitle: $("chTitle").value.trim(),
    number: $("secNum").value.trim(),
    title: $("secTitle").value.trim(),
    body
  };

  const result = addSection(state, draft);
  save(state);

  if (result.status === "no-jurisdiction") {
    hint("Add a jurisdiction first.");
    toast("Add a jurisdiction in the sidebar first.", "warn");
    return;
  }
  if (result.status === "invalid") {
    const message = result.field === "chapter" ? "Enter the chapter number." : "Enter the section number.";
    hint(message);
    toast(message, "warn");
    return;
  }
  if (result.status === "duplicate") {
    hint("");
    app.render();
    toast("Section " + draft.number + " is already in " + chapterLabel(state, result.chapter) + ".", "warn");
    return;
  }

  for (const [id] of REQUIRED) $(id).value = "";
  $("chTitle").value = "";
  $("secTitle").value = "";
  $("paste").value = "";
  clearPartFields();
  hint("");
  app.render();
  toast("Added \u00a7 " + draft.number + " to " + chapterLabel(state, result.chapter) + ".", "ok");
}

function setEditing(app, next) {
  app.getView().editing = next;
  app.render();
}

/* ---------- chapter / section edits ---------- */

function saveChapterEdit(app, id, draft) {
  const state = app.getState();
  const result = updateChapter(state, id, draft);
  if (result.status === "invalid") { toast("Chapter number cannot be empty.", "warn"); return; }
  if (result.status === "duplicate") { toast("That chapter already exists in this jurisdiction.", "warn"); return; }
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
    toast("Section " + result.number + " is already in " + chapterLabel(state, result.chapter) + ".", "warn");
    return;
  }
  if (result.status === "missing") { setEditing(app, null); return; }
  save(state);
  setEditing(app, null);
  toast("Section updated.", "ok");
}

/* ---------- jurisdiction edits ---------- */

/* Push whatever the user typed into the draft before a part action rebuilds
   the form, so editing the organization never discards a pending name. */
function flushJurisdictionDraft(view) {
  const ed = view.editing;
  if (!ed || ed.type !== "jurisdiction") return null;
  if (ed._name) ed.draft.name = ed._name.value;
  if (ed._kind) ed.draft.kind = ed._kind.value;
  if (ed._newPart) ed.draft.newPart = ed._newPart.value;
  return ed;
}

function saveJurisdictionEdit(app) {
  const ed = flushJurisdictionDraft(app.getView());
  if (!ed) return;
  const state = app.getState();
  const draft = { name: ed.draft.name, kind: ed.draft.kind, parts: ed.draft.parts };
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
  hint("");

  $("add").addEventListener("click", () => onAdd(app));

  $("jurisdiction").addEventListener("change", () => {
    const values = readPartFields();
    renderPartFields(app.getState(), $("jurisdiction").value, values);
    hint("");
  });

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
    setEditing(app, {
      type: "jurisdiction",
      key: null,
      draft: { name: "", kind: "state", parts: [ANCHOR], newPart: "" }
    });
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
        draft: { name: j.name, kind: j.kind, parts: j.parts.slice(), newPart: "" }
      });
    },
    onSaveJurisdiction() { saveJurisdictionEdit(app); },

    onJurisdictionKind(kind) {
      const ed = flushJurisdictionDraft(app.getView());
      if (!ed) return;
      ed.draft.kind = kind;
      if (kind === "federal" && ed.draft.parts.length <= 1) ed.draft.parts = FEDERAL_PARTS.slice();
      app.render();
    },

    onMovePart(index, delta) {
      const ed = flushJurisdictionDraft(app.getView());
      if (!ed) return;
      const next = index + delta;
      const parts = ed.draft.parts;
      if (next < 0 || next >= parts.length) return;
      const [moved] = parts.splice(index, 1);
      parts.splice(next, 0, moved);
      app.render();
    },

    onRemovePart(index) {
      const ed = flushJurisdictionDraft(app.getView());
      if (!ed) return;
      const part = ed.draft.parts[index];
      if (!part || part.toLowerCase() === ANCHOR.toLowerCase()) return;
      ed.draft.parts = ed.draft.parts.filter((_, i) => i !== index);
      app.render();
    },

    onAddPart() {
      const ed = flushJurisdictionDraft(app.getView());
      if (!ed) return;
      const part = String(ed.draft.newPart || "").trim();
      if (!part) return;
      if (ed.draft.parts.some((t) => t.toLowerCase() === part.toLowerCase())) {
        toast("That organization part already exists.", "warn");
        return;
      }
      ed.draft.parts = [...ed.draft.parts, part];
      ed.draft.newPart = "";
      app.render();
    }
  };
}
