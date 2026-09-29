/* All DOM building. Pasted text is always inserted via textContent/text nodes
   and never innerHTML; innerHTML is only used to clear a host element.

   Highlighting is built from the raw clause text (core/definitions.js#highlightRuns)
   rather than by walking finished text nodes, so a per-match decision — such as
   "is this occurrence inside the section's own definition?" — is possible.

   The interactive bits (edit buttons and inline forms) are only rendered when a
   `ctx` is supplied, which keeps the exported document free of UI chrome.

   The sidebar is grouped by jurisdiction (a state, or Federal). Federal
   jurisdictions additionally expose their ordered organization parts, edited
   inline through ctx.view.editing.draft. */

import {
  ANCHOR, chaptersInOrder, currentChapter, findJurisdiction, partPath, sortedJurisdictions
} from "../core/model.js";
import { chapterDefinitions, definitionUnits, highlightRuns, termSuppressor } from "../core/definitions.js";
import { analyzeBody } from "../core/nesting.js";

const $ = (id) => document.getElementById(id);
const arrayOf = (list) => Array.from(list || []);

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

let toastTimer = null;
export function toast(msg, kind) {
  const t = $("toast");
  t.textContent = msg;
  t.style.background = kind === "warn" ? "#7a4a12" : kind === "err" ? "#8a1c1c" : "#2a2620";
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

/* ---------- inline editing pieces ---------- */

function iconButton(label, title, onClick) {
  const b = el("button", "mini", label);
  b.type = "button";
  b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

function field(labelText, value, placeholder) {
  const wrap = el("label", "edit-field");
  wrap.appendChild(el("span", "edit-label", labelText));
  const input = el("input", "edit-input");
  input.type = "text";
  input.value = value == null ? "" : value;
  input.placeholder = placeholder || "";
  wrap.appendChild(input);
  return { wrap, input };
}

function editForm(fields, onSave, onCancel) {
  const form = el("div", "edit-form");
  form._focus = fields.length ? fields[0].input : null;

  for (const f of fields) {
    f.input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); onSave(); }
      else if (ev.key === "Escape") onCancel();
    });
    form.appendChild(f.wrap);
  }

  const actions = el("div", "edit-actions");
  const ok = el("button", "primary", "Save");
  ok.type = "button";
  ok.addEventListener("click", onSave);
  const cancel = el("button", null, "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", onCancel);
  actions.appendChild(ok);
  actions.appendChild(cancel);
  form.appendChild(actions);
  return form;
}

function inputIn(node) {
  for (const c of arrayOf(node.childNodes)) {
    if (c.nodeType === 1 && c.tagName === "INPUT") return c;
  }
  return null;
}

/* One text field per organization part, in the jurisdiction's order. The
   Chapter anchor is marked required and defaults its label to "Chapter *". */
function chapterEditor(ch, jurisdiction, ctx) {
  const fields = [];
  const parts = jurisdiction ? jurisdiction.parts : [ANCHOR];
  for (const t of parts) {
    const f = field(t === ANCHOR ? t + " *" : t, (ch.partValues || {})[t],
      t === ANCHOR ? "e.g. 7" : "optional");
    f.part = t;
    f.input._part = t;                 // marker so callers/tests can find the field
    fields.push(f);
  }
  const title = field("Chapter title", ch.title, "defaults to UNKNOWN");
  fields.push(title);

  const form = editForm(fields,
    () => ctx.handlers.onSaveChapter(ch.id, {
      partValues: collectParts(fields),
      title: title.input.value
    }),
    () => ctx.handlers.onCancelEdit());
  ctx.focus = form._focus;
  return form;
}

function collectParts(fields) {
  const values = {};
  for (const f of fields) if (f.part) values[f.part] = f.input.value;
  return values;
}

function sectionEditor(sec, ctx) {
  const number = field("Section number", sec.number, "e.g. 7-12");
  const title = field("Section title", sec.title, "defaults to UNKNOWN");
  const form = editForm([number, title],
    () => ctx.handlers.onSaveSection(sec.id, { number: number.input.value, title: title.input.value }),
    () => ctx.handlers.onCancelEdit());
  ctx.focus = form._focus;
  return form;
}

/* The jurisdiction editor edits a draft held in view.editing (UI-only state).
   Because reordering / adding / removing a part re-renders the form, the name
   and "new part" inputs are stashed on the editing object so the handlers can
   flush whatever the user typed before rebuilding. */
function jurisdictionEditor(ctx) {
  const ed = ctx.view.editing;
  const draft = ed.draft;
  const form = el("div", "edit-form jur-edit");

  const name = field("Jurisdiction name", draft.name, "e.g. Kentucky");
  ed._name = name.input;
  form.appendChild(name.wrap);

  const kindWrap = el("label", "edit-field");
  kindWrap.appendChild(el("span", "edit-label", "Kind"));
  const kind = el("select", "edit-input");
  for (const [value, label] of [["state", "State"], ["federal", "Federal"]]) {
    const o = el("option", null, label);
    o.value = value;
    kind.appendChild(o);
  }
  kind.value = draft.kind;
  kind.addEventListener("change", () => ctx.handlers.onJurisdictionKind(kind.value));
  kindWrap.appendChild(kind);
  ed._kind = kind;
  form.appendChild(kindWrap);

  if (draft.kind === "federal") {
    form.appendChild(el("span", "edit-label", "Organization (top to bottom)"));
    const list = el("div", "part-list");
    draft.parts.forEach((t, i) => {
      const row = el("div", "part-row");
      row.appendChild(el("span", "part-name", t));
      row.appendChild(iconButton("\u2191", "Move up", () => ctx.handlers.onMovePart(i, -1)));
      row.appendChild(iconButton("\u2193", "Move down", () => ctx.handlers.onMovePart(i, 1)));
      if (t.toLowerCase() !== ANCHOR.toLowerCase()) {
        row.appendChild(iconButton("\u2715", "Remove " + t, () => ctx.handlers.onRemovePart(i)));
      }
      list.appendChild(row);
    });

    const addRow = el("div", "part-row");
    const newPart = el("input", "edit-input");
    newPart.type = "text";
    newPart.placeholder = "e.g. Subpart";
    newPart.value = draft.newPart || "";
    ed._newPart = newPart;
    addRow.appendChild(newPart);
    const addBtn = el("button", null, "Add");
    addBtn.type = "button";
    addBtn.addEventListener("click", () => ctx.handlers.onAddPart());
    addRow.appendChild(addBtn);
    list.appendChild(addRow);
    form.appendChild(list);
  }

  const actions = el("div", "edit-actions");
  const save = el("button", "primary", "Save");
  save.type = "button";
  save.addEventListener("click", () => ctx.handlers.onSaveJurisdiction());
  const cancel = el("button", null, "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => ctx.handlers.onCancelEdit());
  actions.appendChild(save);
  actions.appendChild(cancel);
  form.appendChild(actions);

  ctx.focus = name.input;
  return form;
}

/* ---------- composer fields ---------- */

/* (Re)build the jurisdiction <select>. Keeps the current choice when it still
   exists, otherwise falls back to the first jurisdiction in sidebar order. */
export function renderJurisdictionSelect(state) {
  const sel = $("jurisdiction");
  const previous = sel.value;
  sel.innerHTML = "";
  const list = sortedJurisdictions(state);
  for (const j of list) {
    const o = el("option", null, j.name + (j.kind === "federal" ? " (Federal)" : ""));
    o.value = j.key;
    sel.appendChild(o);
  }
  const keys = list.map((j) => j.key);
  sel.value = keys.includes(previous) ? previous : (keys[0] || "");
  return sel.value;
}

/* Extra organization inputs for the selected jurisdiction (everything except
   the Chapter anchor, which has its own fixed "chapter number" field). Only
   rebuilds when the jurisdiction or its part list actually changes, so a
   re-render triggered elsewhere never wipes text the user is typing. */
let partSignature = null;
export function renderPartFields(state, jurisdictionKey, values) {
  const host = $("parts");
  const j = findJurisdiction(state, jurisdictionKey);
  const sig = j ? j.key + "::" + j.parts.map((t) => t.toLowerCase()).join(",") : "";
  if (sig === partSignature) return;
  partSignature = sig;

  host.innerHTML = "";
  if (!j) return;
  const src = values || {};
  for (const t of j.parts) {
    if (t.toLowerCase() === ANCHOR.toLowerCase()) continue;
    const wrap = el("label", "part-field");
    wrap._part = t;
    wrap.appendChild(el("span", "part-label", t));
    const input = el("input", "part-input");
    input.type = "text";
    input.placeholder = "optional";
    input.value = src[t] == null ? "" : src[t];
    wrap.appendChild(input);
    host.appendChild(wrap);
  }
}

/* Current values of the extra organization inputs, keyed by part type. */
export function readPartFields() {
  const values = {};
  for (const node of arrayOf($("parts").childNodes)) {
    if (node.nodeType !== 1 || !node._part) continue;
    const input = inputIn(node);
    if (input) values[node._part] = input.value.trim();
  }
  return values;
}

export function clearPartFields() {
  for (const node of arrayOf($("parts").childNodes)) {
    if (node.nodeType !== 1 || !node._part) continue;
    const input = inputIn(node);
    if (input) input.value = "";
  }
}

/* ---------- document body ---------- */

export function renderRuns(host, text, terms, shouldMark) {
  for (const run of highlightRuns(text, terms, shouldMark)) {
    if (run.mark != null) host.appendChild(el("mark", "term", run.mark));
    else if (run.text) host.appendChild(document.createTextNode(run.text));
  }
}

export function renderBody(body, terms, units) {
  const container = el("div", "sect-body");
  const suppressed = termSuppressor(units);

  for (const item of analyzeBody(body)) {
    if (item.type === "blank") { container.appendChild(el("div", "blank")); continue; }

    const p = el("div", "clause");
    p.style.paddingLeft = (item.depth * 1.5) + "rem";
    if (item.marker) p.appendChild(el("b", "clause-num", item.marker));

    const span = el("span");
    renderRuns(span, item.text, terms, (term, i) => suppressed(term, item.start + i));
    p.appendChild(span);

    container.appendChild(p);
  }
  return container;
}

export function renderSection(sec, terms, ctx) {
  const wrap = el("section", "sect");
  const editing = ctx && ctx.view.editing &&
    ctx.view.editing.type === "section" && ctx.view.editing.id === sec.id;

  if (editing) {
    wrap.appendChild(sectionEditor(sec, ctx));
  } else {
    const head = el("div", "sect-head-row");
    const label = sec.number
      ? "\u00a7 " + sec.number + (sec.title ? ". " + sec.title : "")
      : (sec.title || "(untitled section)");
    head.appendChild(el("h4", "sect-head", label));
    if (ctx) {
      head.appendChild(iconButton("Edit", "Edit section number and title",
        () => ctx.handlers.onEditSection(sec.id)));
    }
    wrap.appendChild(head);
  }

  wrap.appendChild(renderBody(sec.body, terms, definitionUnits(sec.body)));
  return wrap;
}

/* Also used by the exporter with no ctx: it builds the page as DOM and
   serializes it, so the screen and the exported file share one implementation. */
export function renderChapterContent(ch, jurisdiction, ctx) {
  const page = el("div", "page");
  const label = partPath(jurisdiction, ch.partValues) || "Chapter";
  page.appendChild(el("h3", "chapter-head", label + (ch.title ? " \u2014 " + ch.title : "")));
  page.appendChild(el("p", "chapter-sub",
    (jurisdiction ? jurisdiction.name + " \u00b7 " : "") +
    ch.sections.length + " section" + (ch.sections.length === 1 ? "" : "s") + " \u00b7 auto-sorted"));

  const terms = chapterDefinitions(ch);
  for (const s of ch.sections) page.appendChild(renderSection(s, terms, ctx));
  return page;
}

/* ---------- chrome ---------- */

function chapterRow(state, ch, jurisdiction, ctx) {
  if (ctx.view.editing && ctx.view.editing.type === "chapter" && ctx.view.editing.id === ch.id) {
    return chapterEditor(ch, jurisdiction, ctx);
  }

  const row = el("div", "chap-row");
  const btn = el("button", "chap-btn" + (ch.id === state.activeId ? " active" : ""));
  btn.type = "button";
  btn.appendChild(el("span", "cn", ch.sections.length + " \u00a7"));
  btn.appendChild(el("span", "cl", partPath(jurisdiction, ch.partValues) || "Chapter"));
  if (ch.title) btn.appendChild(el("span", "ct", ch.title));
  btn.addEventListener("click", () => ctx.handlers.onSelectChapter(ch.id));
  row.appendChild(btn);
  row.appendChild(iconButton("Edit", "Edit chapter organization and title",
    () => ctx.handlers.onEditChapter(ch.id)));
  return row;
}

function jurisdictionGroup(state, jurisdiction, ctx) {
  const group = el("div", "jur-group");
  const editing = ctx.view.editing &&
    ctx.view.editing.type === "jurisdiction" && ctx.view.editing.key === jurisdiction.key;

  if (editing) { group.appendChild(jurisdictionEditor(ctx)); return group; }

  const head = el("div", "jur-head");
  head.appendChild(el("span", "jur-name", jurisdiction.name));
  head.appendChild(el("span", "jur-tag", jurisdiction.kind === "federal" ? "Federal" : "State"));
  head.appendChild(iconButton("Edit", "Edit jurisdiction and organization",
    () => ctx.handlers.onEditJurisdiction(jurisdiction.key)));
  group.appendChild(head);

  const list = chaptersInOrder(state, jurisdiction.key);
  if (!list.length) { group.appendChild(el("p", "empty", "No chapters yet.")); return group; }
  for (const ch of list) group.appendChild(chapterRow(state, ch, jurisdiction, ctx));
  return group;
}

export function renderSidebar(state, ctx) {
  const host = $("chapters");
  host.innerHTML = "";
  const ed = ctx.view.editing;

  /* A brand-new jurisdiction has no group yet, so its editor renders at the top. */
  const adding = ed && ed.type === "jurisdiction" && ed.key == null;
  if (adding) {
    const wrap = el("div", "jur-group");
    wrap.appendChild(jurisdictionEditor(ctx));
    host.appendChild(wrap);
  }

  if (!state.jurisdictions.length) {
    if (!adding) host.appendChild(el("p", "empty", "No jurisdictions yet."));
    return;
  }
  for (const j of sortedJurisdictions(state)) host.appendChild(jurisdictionGroup(state, j, ctx));
}

export function renderActive(state, view, handlers) {
  const ctx = { view, handlers, focus: null };

  renderJurisdictionSelect(state);
  renderPartFields(state, $("jurisdiction").value);
  renderSidebar(state, ctx);

  const host = $("sections");
  host.innerHTML = "";
  const ch = currentChapter(state);
  if (!ch) {
    host.appendChild(el("p", "empty-note",
      "No chapters yet \u2014 fill in the chapter number and section number above, then click \u201CAdd section\u201D."));
    return;
  }
  host.appendChild(renderChapterContent(ch, findJurisdiction(state, ch.jurisdiction), ctx));

  if (ctx.focus && typeof ctx.focus.focus === "function") ctx.focus.focus();
}
