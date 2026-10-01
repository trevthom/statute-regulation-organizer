/* All DOM building. Pasted text is always inserted via textContent/text nodes
   and never innerHTML; innerHTML is only used to clear a host element.

   Highlighting is built from the raw clause text (core/definitions.js#highlightRuns)
   rather than by walking finished text nodes, so a per-match decision — such as
   "is this occurrence inside the section's own definition?" — is possible.

   The interactive bits (edit buttons and inline forms) are only rendered when a
   `ctx` is supplied, which keeps the exported document free of UI chrome.

   The composer is one organization layer: a jurisdiction picker (Federal, or a
   state) followed by the fixed hierarchy, one row per level, with a checkbox, a
   value and an optional title. The sidebar's chapter editor reuses the same row
   builder over the chapter levels, so the two cannot drift apart. */

import {
  CHAPTER_LEVELS, LEVEL_MAX, ORG_LEVELS, SECTION_LEVELS, chaptersInOrder,
  currentChapter, findJurisdiction, partPath, sectionKey, sortedJurisdictions
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
   organization rows, so this cannot just look at direct children). */
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

/* ---------- the organization rows ---------- */

/* One row per level: a checkbox, the level name, its value and its optional
   title. Every row is an ordinary opt-in — nothing is preselected, including
   Section. A section still needs its number, which the model enforces. */
function orgRows(levels, values, titles, checked) {
  const box = el("div", "org-tree");
  const rows = [];
  const src = values || {};
  const srcTitles = titles || {};
  const on = new Set((Array.isArray(checked) ? checked : []).map((c) => String(c).toLowerCase()));

  levels.forEach((level, i) => {
    const row = el("div", "org-row");
    row.style.paddingLeft = (i * 0.7) + "rem";
    row._level = level;

    const pick = el("label", "org-pick");
    const check = el("input", "org-check");
    check.type = "checkbox";
    check.checked = on.has(level.toLowerCase()) || !!src[level];
    pick.appendChild(check);
    pick.appendChild(el("span", "org-name", level));
    row.appendChild(pick);

    const value = el("input", "org-input org-value");
    value.type = "text";
    value.maxLength = LEVEL_MAX;
    value.placeholder = "value";
    value.value = src[level] == null ? "" : String(src[level]);
    value.disabled = !check.checked;

    const title = el("input", "org-input org-title");
    title.type = "text";
    title.placeholder = "title (optional)";
    title.value = srcTitles[level] == null ? "" : String(srcTitles[level]);
    title.disabled = !check.checked;

    check.addEventListener("change", () => {
      value.disabled = !check.checked;
      title.disabled = !check.checked;
      if (check.checked && typeof value.focus === "function") value.focus();
    });

    row.appendChild(value);
    row.appendChild(title);
    box.appendChild(row);
    rows.push({ level, check, value, title });
  });

  return { box, rows };
}

/* What a set of rows currently says: the levels that are on, their values and
   their titles. */
function readRows(rows) {
  const values = {};
  const titles = {};
  const checked = [];
  for (const row of rows) {
    if (!row.check.checked) continue;
    checked.push(row.level);
    const value = String(row.value.value == null ? "" : row.value.value).trim();
    if (value) values[row.level] = value;
    const title = String(row.title.value == null ? "" : row.title.value).trim();
    if (title) titles[row.level] = title;
  }
  return { values, titles, checked };
}

/* ---------- the composer's organization layer ---------- */

/* The layer's live state, module-level because the composer survives
   re-renders: it is read back before being rebuilt so a render triggered
   elsewhere never wipes a value mid-entry. */
let orgRowsLive = [];
let orgJuris = { kind: "federal", stateKey: "" };
let orgDraft = { values: {}, titles: {}, checked: [] };

function jurisdictionPicker(state) {
  const box = el("div", "org-juris");

  const kindWrap = el("label", "org-juris-field");
  kindWrap.appendChild(el("span", "org-juris-label", "Jurisdiction"));
  const kind = el("select", "org-kind");
  for (const [value, label] of [["federal", "Federal"], ["state", "State"]]) {
    const option = el("option", null, label);
    option.value = value;
    kind.appendChild(option);
  }
  kind.value = orgJuris.kind;
  kindWrap.appendChild(kind);
  box.appendChild(kindWrap);

  const stateWrap = el("label", "org-juris-field");
  stateWrap.appendChild(el("span", "org-juris-label", "State"));
  const sel = el("select", "org-state");
  const blank = el("option", null, "Select a state");
  blank.value = "";
  sel.appendChild(blank);
  for (const j of sortedJurisdictions(state)) {
    if (j.kind !== "state") continue;
    const option = el("option", null, j.name);
    option.value = j.key;
    sel.appendChild(option);
  }
  sel.value = orgJuris.stateKey || "";
  stateWrap.appendChild(sel);
  box.appendChild(stateWrap);

  const sync = () => {
    orgJuris.kind = kind.value === "state" ? "state" : "federal";
    if (sel.value) orgJuris.stateKey = sel.value;
    sel.disabled = orgJuris.kind !== "state";
  };
  kind.addEventListener("change", sync);
  sel.addEventListener("change", sync);
  sync();
  return box;
}

/* Rebuild the layer: the jurisdiction picker, then the fixed hierarchy. Every
   row is opt-in, including Section — but a section cannot be added without its
   number, so the Section row is the one that must be checked. */
export function mountOrgTree(state) {
  const host = $("parts");
  if (orgRowsLive.length) {
    const read = readRows(orgRowsLive);
    orgDraft = { values: read.values, titles: read.titles, checked: read.checked };
  }

  host.innerHTML = "";
  host.appendChild(el("span", "org-caption",
    "Organization \u2014 check the levels that apply; Section is required. Every level " +
    "you check takes up to " + LEVEL_MAX +
    " letters, numbers, parentheses or hyphens, and an optional title."));

  host.appendChild(jurisdictionPicker(state));
  const tree = orgRows(ORG_LEVELS, orgDraft.values, orgDraft.titles, orgDraft.checked);
  host.appendChild(tree.box);
  orgRowsLive = tree.rows;
  return tree;
}

/* Everything the composer's layer says: the chosen jurisdiction plus the
   levels that are on, with their values and titles. */
export function readOrg() {
  const read = orgRowsLive.length ? readRows(orgRowsLive) : { values: {}, titles: {}, checked: [] };
  return Object.assign({
    kind: orgJuris.kind,
    jurisdictionKey: orgJuris.kind === "state" ? orgJuris.stateKey : "federal"
  }, read);
}

/* Empty the section's own rows (number, subsection and their titles) after a
   successful add, so the next section can be typed straight in while the
   chapter-level rows stay put. The Section and Subsection rows are turned back
   off — they belong to the section that was just added, not to the next one,
   so the next add starts from a clean, unchecked section designation. */
export function resetSectionRows() {
  for (const row of orgRowsLive) {
    if (!SECTION_LEVELS.includes(row.level)) continue;
    row.value.value = "";
    row.title.value = "";
    row.check.checked = false;
    row.value.disabled = true;
    row.title.disabled = true;
  }
}

/* ---------- inline editors ---------- */

function chapterEditor(ch, ctx) {
  const values = ch.partValues || {};
  const titles = ch.partTitles || {};
  const tree = orgRows(CHAPTER_LEVELS, values, titles, Object.keys(values));

  const form = editForm([el("span", "edit-note", "Edit organizational levels"), tree.box],
    () => {
      const org = readRows(tree.rows);
      ctx.handlers.onSaveChapter(ch.id, {
        partValues: org.values, partTitles: org.titles, checked: org.checked
      });
    },
    () => ctx.handlers.onCancelEdit());
  ctx.focus = form._focus;
  return form;
}

function sectionEditor(sec, ctx) {
  const number = field("Section number *", sec.number, "e.g. 1983");
  const title = field("Section title", sec.title, "optional");
  const subsection = field("Subsection", sec.subsection, "optional");
  const subsectionTitle = field("Subsection title", sec.subsectionTitle, "optional");
  const form = editForm([number.wrap, title.wrap, subsection.wrap, subsectionTitle.wrap],
    () => ctx.handlers.onSaveSection(sec.id, {
      number: number.input.value,
      title: title.input.value,
      subsection: subsection.input.value,
      subsectionTitle: subsectionTitle.input.value
    }),
    () => ctx.handlers.onCancelEdit());
  ctx.focus = form._focus;
  return form;
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
    const titles = [sec.title, sec.subsectionTitle].filter(Boolean);
    const label = "\u00a7 " + sectionKey(sec) + (titles.length ? ". " + titles.join(" \u2014 ") : "");
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
  const label = partPath(ch.partValues, ch.partTitles) || "Untitled chapter";
  page.appendChild(el("h3", "chapter-head", label));
  page.appendChild(el("p", "chapter-sub",
    (jurisdiction ? jurisdiction.name + " \u00b7 " : "") +
    ch.sections.length + " section" + (ch.sections.length === 1 ? "" : "s") + " \u00b7 auto-sorted"));

  const terms = chapterDefinitions(ch);
  for (const s of ch.sections) page.appendChild(renderSection(s, terms, ctx));
  return page;
}

/* ---------- chrome ---------- */

function chapterRow(state, ch, ctx) {
  if (ctx.view.editing && ctx.view.editing.type === "chapter" && ctx.view.editing.id === ch.id) {
    return chapterEditor(ch, ctx);
  }

  const row = el("div", "chap-row");
  const btn = el("button", "chap-btn" + (ch.id === state.activeId ? " active" : ""));
  btn.type = "button";
  btn.appendChild(el("span", "cn", ch.sections.length + " \u00a7"));
  btn.appendChild(el("span", "cl", partPath(ch.partValues, ch.partTitles) || "No organization levels"));
  btn.addEventListener("click", () => ctx.handlers.onSelectChapter(ch.id));
  row.appendChild(btn);
  row.appendChild(iconButton("Edit", "Edit organizational levels",
    () => ctx.handlers.onEditChapter(ch.id)));
  return row;
}

function jurisdictionGroup(state, jurisdiction, ctx) {
  const group = el("div", "jur-group");
  const head = el("div", "jur-head");
  head.appendChild(el("span", "jur-name", jurisdiction.name));
  head.appendChild(el("span", "jur-tag", jurisdiction.kind === "federal" ? "Federal" : "State"));
  group.appendChild(head);

  const list = chaptersInOrder(state, jurisdiction.key);
  if (!list.length) { group.appendChild(el("p", "empty", "No chapters yet.")); return group; }
  for (const ch of list) group.appendChild(chapterRow(state, ch, ctx));
  return group;
}

export function renderSidebar(state, ctx) {
  const host = $("chapters");
  host.innerHTML = "";
  for (const j of sortedJurisdictions(state)) host.appendChild(jurisdictionGroup(state, j, ctx));
}

export function renderActive(state, view, handlers) {
  const ctx = { view, handlers, focus: null };

  mountOrgTree(state);
  renderSidebar(state, ctx);

  const host = $("sections");
  host.innerHTML = "";
  const ch = currentChapter(state);
  if (!ch) {
    host.appendChild(el("p", "empty-note",
      "No chapters yet \u2014 pick a jurisdiction and the organization levels above, paste the wording, then click \u201CAdd section\u201D."));
    return;
  }
  host.appendChild(renderChapterContent(ch, findJurisdiction(state, ch.jurisdiction), ctx));

  if (ctx.focus && typeof ctx.focus.focus === "function") ctx.focus.focus();
}
