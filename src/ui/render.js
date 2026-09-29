/* All DOM building. Pasted text is always inserted via textContent/text nodes
   and never innerHTML; innerHTML is only used to clear a host element.

   Highlighting is built from the raw clause text (core/definitions.js#highlightRuns)
   rather than by walking finished text nodes, so a per-match decision — such as
   "is this occurrence inside the section's own definition?" — is possible.

   The interactive bits (edit buttons and inline forms) are only rendered when a
   `ctx` is supplied, which keeps the exported document free of UI chrome.

   The sidebar is grouped by jurisdiction (the federal system, or a state) and
   the composer files a section through the fixed organization tree: the
   jurisdiction's anchor level (Title for federal, Chapter for a state) plus the
   optional levels the user checked, each with a 1-2 character code. */

import {
  CODE_MAX, FEDERAL_ANCHOR, ORG_LEVELS, TITLE_MAX, TITLE_MIN, anchorOf, chaptersInOrder,
  currentChapter, findJurisdiction, partPath, sortedJurisdictions
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

/* Every input inside a node (the chapter editor nests its fields in the
   organization tree, so this cannot just look at direct children). */
function inputsIn(node) {
  const out = [];
  const walk = (n) => {
    for (const c of arrayOf(n.childNodes)) {
      if (c.nodeType !== 1) continue;
      if (c.tagName === "INPUT" || c.tagName === "SELECT") out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

/* An inline form over already-built nodes. Enter saves, Escape cancels, and
   the first field is focused when the form appears. */
function editForm(nodes, onSave, onCancel) {
  const form = el("div", "edit-form");
  let first = null;
  for (const node of nodes) {
    form.appendChild(node);
    for (const input of inputsIn(node)) {
      if (!first) first = input;
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); onSave(); }
        else if (ev.key === "Escape") onCancel();
      });
    }
  }
  form._focus = first;

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

/* ---------- the organization tree ---------- */

function readOrgRows(rows) {
  const values = {};
  const checked = [];
  for (const row of rows) {
    if (!row.check.checked) continue;
    checked.push(row.level);
    const value = String(row.input.value == null ? "" : row.input.value).trim();
    if (value) values[row.level] = value;
  }
  return { values, checked };
}

/* The fixed hierarchy, one row per level. The jurisdiction's anchor row is
   always checked — it is the required level and cannot be turned off — and is
   a pick-list of federal Titles or a chapter number for a state. Every other
   level is opt-in; once checked it takes a code of up to 2 letters or digits.
   Returns the built rows so callers can read the live values back. */
export function orgTree(jurisdiction, values, checked) {
  const anchor = anchorOf(jurisdiction);
  const federal = !!jurisdiction && jurisdiction.kind === "federal";
  const src = values || {};
  const on = (Array.isArray(checked) ? checked : []).map((c) => String(c).toLowerCase());
  const box = el("div", "org-tree");
  const rows = [];

  ORG_LEVELS.forEach((level, i) => {
    const isAnchor = level === anchor;
    const row = el("div", "org-row" + (isAnchor ? " anchor" : ""));
    row.style.paddingLeft = (i * 0.7) + "rem";
    row._level = level;

    const pick = el("label", "org-pick");
    const check = el("input", "org-check");
    check.type = "checkbox";
    check.checked = isAnchor || on.includes(level.toLowerCase()) || !!src[level];
    check.disabled = isAnchor;
    pick.appendChild(check);
    pick.appendChild(el("span", "org-name", level));
    row.appendChild(pick);

    let input;
    if (isAnchor && federal) {
      input = el("select", "org-input");
      const blank = el("option", null, "Select");
      blank.value = "";
      input.appendChild(blank);
      for (let n = TITLE_MIN; n <= TITLE_MAX; n++) {
        const option = el("option", null, String(n));
        option.value = String(n);
        input.appendChild(option);
      }
      input.value = src[level] ? String(src[level]) : "";
    } else {
      input = el("input", "org-input");
      input.type = "text";
      input.maxLength = isAnchor ? 12 : CODE_MAX;
      input.placeholder = isAnchor ? "e.g. 7" : "1\u20132";
      input.value = src[level] ? String(src[level]) : "";
    }
    input._level = level;
    input.disabled = !check.checked;

    check.addEventListener("change", () => {
      input.disabled = !check.checked;
      if (check.checked && typeof input.focus === "function") input.focus();
    });

    row.appendChild(input);
    box.appendChild(row);
    rows.push({ level, isAnchor, check, input });
  });

  return { box, rows, read: () => readOrgRows(rows) };
}

/* The composer's tree lives across re-renders: it is read back before being
   rebuilt so a render triggered elsewhere never wipes a code mid-entry. */
let orgKey = null;
let orgRows = [];
let orgDraft = { values: {}, checked: [] };

export function mountOrgTree(jurisdiction) {
  const host = $("parts");
  const key = jurisdiction ? jurisdiction.key : "";
  if (key !== orgKey) {
    orgKey = key;
    orgRows = [];
    orgDraft = { values: {}, checked: [] };
  } else if (orgRows.length) {
    orgDraft = readOrgRows(orgRows);
  }

  const anchor = anchorOf(jurisdiction);
  host.innerHTML = "";
  host.appendChild(el("span", "org-caption",
    "Organization \u2014 only the " + anchor +
    " is required; every level you check takes 1\u20132 letters or numbers."));
  const tree = orgTree(jurisdiction, orgDraft.values, orgDraft.checked);
  host.appendChild(tree.box);
  orgRows = tree.rows;
  return tree;
}

/* What the composer's tree currently says: levels that are checked and the
   codes they carry. */
export function readOrg() {
  return readOrgRows(orgRows);
}

/* ---------- inline editors ---------- */

function chapterEditor(ch, jurisdiction, ctx) {
  const anchor = anchorOf(jurisdiction);
  const values = ch.partValues || {};
  const tree = orgTree(jurisdiction, values, Object.keys(values));
  const title = field(anchor + " title", ch.title, "defaults to UNKNOWN");

  const form = editForm([tree.box, title.wrap],
    () => {
      const org = tree.read();
      ctx.handlers.onSaveChapter(ch.id, {
        partValues: org.values, checked: org.checked, title: title.input.value
      });
    },
    () => ctx.handlers.onCancelEdit());
  ctx.focus = form._focus;
  return form;
}

function sectionEditor(sec, ctx) {
  const number = field("Section number *", sec.number, "e.g. 7-12");
  const title = field("Section title", sec.title, "defaults to UNKNOWN");
  const form = editForm([number.wrap, title.wrap],
    () => ctx.handlers.onSaveSection(sec.id, { number: number.input.value, title: title.input.value }),
    () => ctx.handlers.onCancelEdit());
  ctx.focus = form._focus;
  return form;
}

/* The jurisdiction editor edits a draft held in view.editing (UI-only state).
   Save reads the live inputs, so nothing has to be stashed while typing. */
function jurisdictionEditor(ctx) {
  const draft = ctx.view.editing.draft;
  const name = field("Jurisdiction name", draft.name, "e.g. Kentucky");

  const kindWrap = el("label", "edit-field");
  kindWrap.appendChild(el("span", "edit-label", "Kind"));
  const kind = el("select", "edit-input");
  for (const [value, label] of [["state", "State"], ["federal", "Federal"]]) {
    const option = el("option", null, label);
    option.value = value;
    kind.appendChild(option);
  }
  kind.value = draft.kind === "federal" ? "federal" : "state";
  kindWrap.appendChild(kind);

  const form = editForm([name.wrap, kindWrap],
    () => ctx.handlers.onSaveJurisdiction(name.input.value, kind.value),
    () => ctx.handlers.onCancelEdit());
  ctx.focus = form._focus;
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
    const option = el("option", null, j.name + (j.kind === "federal" ? " (Federal)" : ""));
    option.value = j.key;
    sel.appendChild(option);
  }
  const keys = list.map((j) => j.key);
  sel.value = keys.includes(previous) ? previous : (keys[0] || "");
  return sel.value;
}

/* Two required fields, and a chapter title that follows the jurisdiction: a
   Title heading for the federal system, a Chapter title for a state. */
export function renderComposerLabels(jurisdiction) {
  const anchor = anchorOf(jurisdiction);
  $("chTitleLabel").textContent = anchor + " " + (anchor === FEDERAL_ANCHOR ? "heading" : "title");
  $("secNumLabel").textContent = "Section number *";
}

/* ---------- document body ---------- */

export function renderRuns(host, text, terms, shouldMark) {
  for (const run of highlightRuns(text, terms, shouldMark)) {
    if (run.mark != null) host.appendChild(el("mark", "term", run.mark));
    else if (run.text) host.appendChild(document.createTextNode(run.text));
  }
}

/* One step of indentation per nesting level: a clause in the body's own margin
   sits at depth 0, a subclause inside it at 1, a subclause inside that at 2.
   The marker is followed by a real space so the label and the wording never run
   together, on screen, in an export, or when the text is copied out. */
export function renderBody(body, terms, units) {
  const container = el("div", "sect-body");
  const suppressed = termSuppressor(units);

  for (const item of analyzeBody(body)) {
    if (item.type === "blank") { container.appendChild(el("div", "blank")); continue; }

    const p = el("div", "clause");
    p.style.paddingLeft = (item.depth * 1.5) + "rem";
    if (item.marker) {
      p.appendChild(el("b", "clause-num", item.marker));
      p.appendChild(document.createTextNode(" "));
    }

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
  head.appendChild(iconButton("Edit", "Edit jurisdiction",
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
  const jurisdiction = findJurisdiction(state, $("jurisdiction").value);
  renderComposerLabels(jurisdiction);
  mountOrgTree(jurisdiction);
  renderSidebar(state, ctx);

  const host = $("sections");
  host.innerHTML = "";
  const ch = currentChapter(state);
  if (!ch) {
    host.appendChild(el("p", "empty-note",
      "No chapters yet \u2014 choose a jurisdiction and a section's organization above, paste the wording, then click \u201CAdd section\u201D."));
    return;
  }
  host.appendChild(renderChapterContent(ch, findJurisdiction(state, ch.jurisdiction), ctx));

  if (ctx.focus && typeof ctx.focus.focus === "function") ctx.focus.focus();
}
