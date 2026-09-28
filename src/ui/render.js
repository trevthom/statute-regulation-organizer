/* All DOM building. Pasted text is always inserted via textContent/text nodes
   and never innerHTML; innerHTML is only used to clear a host element. */

import { naturalCmp } from "../core/sort.js";
import { currentChapter } from "../core/model.js";
import { chapterDefinitions, buildTermRegex } from "../core/definitions.js";
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

/* Wrap every occurrence of a defined term in <mark class="term"> across the
   text nodes of root. Runs at render time only — stored bodies stay raw. */
export function highlightTerms(root, terms) {
  const re = buildTermRegex(terms);
  if (!re) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const value = node.nodeValue;
    re.lastIndex = 0;
    if (!re.test(value)) continue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    while ((m = re.exec(value)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      if (m.index > last) frag.appendChild(document.createTextNode(value.slice(last, m.index)));
      frag.appendChild(el("mark", "term", m[0]));
      last = m.index + m[0].length;
    }
    if (last < value.length) frag.appendChild(document.createTextNode(value.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
}

export function renderBody(body, defs) {
  const container = el("div", "sect-body");
  for (const item of analyzeBody(body)) {
    if (item.type === "blank") { container.appendChild(el("div", "blank")); continue; }

    const p = el("div", "clause");
    p.style.paddingLeft = (item.depth * 1.5) + "rem";
    if (item.marker) p.appendChild(el("b", "clause-num", item.marker));
    const span = el("span", null, item.text);
    p.appendChild(span);
    if (defs.length) highlightTerms(span, defs);

    container.appendChild(p);
  }
  return container;
}

export function renderSection(sec, defs) {
  const wrap = el("section", "sect");
  let head = "";
  if (sec.number) head = "§ " + sec.number + (sec.title ? ". " + sec.title : "");
  else head = sec.title || "(untitled section)";
  wrap.appendChild(el("h4", "sect-head", head));
  wrap.appendChild(renderBody(sec.body, defs));
  return wrap;
}

/* Also used by the exporter: it builds the page as DOM and serializes it, so
   the screen and the exported file share exactly one markup implementation. */
export function renderChapterContent(ch) {
  const page = el("div", "page");
  page.appendChild(el("h3", "chapter-head", "Chapter " + ch.key + (ch.title ? " — " + ch.title : "")));
  page.appendChild(el("p", "chapter-sub", ch.sections.length + " section" +
    (ch.sections.length === 1 ? "" : "s") + " · auto-sorted"));
  const defs = chapterDefinitions(ch);
  for (const s of ch.sections) page.appendChild(renderSection(s, defs));
  return page;
}

export function renderSidebar(state, onSelect) {
  const host = $("chapters");
  host.innerHTML = "";
  const list = state.chapters.slice().sort((a, b) => naturalCmp(a.key, b.key));
  if (!list.length) { host.appendChild(el("p", "empty", "No chapters yet.")); return; }
  for (const ch of list) {
    const btn = el("button", "chap-btn" + (ch.key === state.activeKey ? " active" : ""));
    btn.type = "button";
    btn.appendChild(el("span", "cn", ch.sections.length + " §"));
    btn.appendChild(el("span", "cl", "Chapter " + ch.key));
    if (ch.title) btn.appendChild(el("span", "ct", ch.title));
    btn.addEventListener("click", () => onSelect(ch.key));
    host.appendChild(btn);
  }
}

export function renderActive(state, onSelect) {
  renderSidebar(state, onSelect);
  const host = $("sections");
  host.innerHTML = "";
  const ch = currentChapter(state);
  if (!ch) {
    host.appendChild(el("p", "empty-note", "No chapters yet — paste a section above and click “Add section”."));
    return;
  }
  host.appendChild(renderChapterContent(ch));
}
