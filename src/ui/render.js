/* All DOM building. Pasted text is always inserted via textContent/text nodes
   and never innerHTML; innerHTML is only used to clear a host element.

   Highlighting is built from the raw clause text (core/definitions.js#highlightRuns)
   rather than by walking finished text nodes, so a per-match decision — such as
   "is this occurrence inside the section's own definition?" — is possible.

   The interactive bits (edit buttons and inline forms) are only rendered when a
   `ctx` is supplied, which keeps the exported document free of UI chrome. */

import { naturalCmp } from "../core/sort.js";
import { currentChapter } from "../core/model.js";
import { chapterDefinitions, definitionUnits, highlightRuns, termSuppressor } from "../core/definitions.js";
import { analyzeBody } from "../core/nesting.js";

const $ = (id) => document.getElementById(id);

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

function chapterEditor(ch, ctx) {
  const name = field("Chapter name", ch.key, "e.g. 7");
  const title = field("Chapter title", ch.title, "e.g. Public Utilities");
  const form = editForm([name, title],
    () => ctx.handlers.onSaveChapter(ch.key, { key: name.input.value, title: title.input.value }),
    () => ctx.handlers.onCancelEdit());
  ctx.focus = form._focus;
  return form;
}

function sectionEditor(sec, ctx) {
  const number = field("Section number", sec.number, "e.g. 7-12");
  const title = field("Section title", sec.title, "e.g. Rate filings");
  const form = editForm([number, title],
    () => ctx.handlers.onSaveSection(sec.id, { number: number.input.value, title: title.input.value }),
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
export function renderChapterContent(ch, ctx) {
  const page = el("div", "page");
  page.appendChild(el("h3", "chapter-head", "Chapter " + ch.key + (ch.title ? " — " + ch.title : "")));
  page.appendChild(el("p", "chapter-sub", ch.sections.length + " section" +
    (ch.sections.length === 1 ? "" : "s") + " · auto-sorted"));

  const terms = chapterDefinitions(ch);
  for (const s of ch.sections) page.appendChild(renderSection(s, terms, ctx));
  return page;
}

/* ---------- chrome ---------- */

export function renderSidebar(state, ctx) {
  const host = $("chapters");
  host.innerHTML = "";
  const list = state.chapters.slice().sort((a, b) => naturalCmp(a.key, b.key));
  if (!list.length) { host.appendChild(el("p", "empty", "No chapters yet.")); return; }

  for (const ch of list) {
    const editing = ctx.view.editing &&
      ctx.view.editing.type === "chapter" && ctx.view.editing.key === ch.key;
    if (editing) { host.appendChild(chapterEditor(ch, ctx)); continue; }

    const row = el("div", "chap-row");
    const btn = el("button", "chap-btn" + (ch.key === state.activeKey ? " active" : ""));
    btn.type = "button";
    btn.appendChild(el("span", "cn", ch.sections.length + " \u00a7"));
    btn.appendChild(el("span", "cl", "Chapter " + ch.key));
    if (ch.title) btn.appendChild(el("span", "ct", ch.title));
    btn.addEventListener("click", () => ctx.handlers.onSelectChapter(ch.key));
    row.appendChild(btn);
    row.appendChild(iconButton("Edit", "Edit chapter name and title",
      () => ctx.handlers.onEditChapter(ch.key)));
    host.appendChild(row);
  }
}

export function renderActive(state, view, handlers) {
  const ctx = { view, handlers, focus: null };

  renderSidebar(state, ctx);

  const host = $("sections");
  host.innerHTML = "";
  const ch = currentChapter(state);
  if (!ch) {
    host.appendChild(el("p", "empty-note",
      "No chapters yet — fill in the four fields above and click \u201CAdd section\u201D."));
    return;
  }
  host.appendChild(renderChapterContent(ch, ctx));

  if (ctx.focus && typeof ctx.focus.focus === "function") ctx.focus.focus();
}
