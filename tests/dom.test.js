/* End-to-end smoke test: boots the REAL src/main.js against the real
   index.html (via the DOM shim) and drives the app the way a user would —
   load sample, paste + add sections, export chapters. No dependencies.

   Run with:  node --test tests/dom.test.js

   The tests share one DOM and run in order, so they are intentionally
   sequential: each one starts where the previous left off. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom-shim.js";

const dom = installDom();
await import("../src/main.js");        // dynamic import: runs AFTER the globals exist

const $ = (id) => dom.document.getElementById(id);
const click = async (id) => { for (const r of $(id).dispatch("click")) await r; };

function all(root, pred, out = []) {
  for (const c of root.childNodes) {
    if (c.nodeType === 1) { if (pred(c)) out.push(c); all(c, pred, out); }
  }
  return out;
}
const byClass = (root, cls) => all(root, (e) => e.classList.contains(cls));
const headOf = (sect) => byClass(sect, "sect-head")[0].textContent;
const heads = () => byClass($("sections"), "sect-head").map((e) => e.textContent);
const termTexts = () => byClass($("sections"), "term").map((e) => e.textContent);

function sectByHead(head) {
  for (const s of byClass($("sections"), "sect")) if (headOf(s) === head) return s;
  return null;
}
const child = (node, tag) => node.childNodes.find((n) => n.nodeType === 1 && n.tagName === tag);

async function paste({ text, chNum = "", secNum = "", secTitle = "" }) {
  $("paste").value = text;
  $("chNum").value = chNum;
  $("chTitle").value = "";
  $("secNum").value = secNum;
  $("secTitle").value = secTitle;
  await click("add");
}

test("boots with an empty document", () => {
  assert.match($("sections").textContent, /No chapters yet/);
  assert.match($("chapters").textContent, /No chapters yet\./);
});

test("paste detection reports the parsed header", () => {
  $("paste").value = "\u00a7 7-12. Rate filings\n(a) Every public utility shall file its rates.";
  $("paste").dispatch("input");
  assert.equal($("detect").textContent, "Detected \u2014 Chapter: \u2014 \u00b7 Section: 7-12 \u00b7 Title: Rate filings");
});

test("load sample: chapters ordered, sections rendered, definitions highlighted", async () => {
  await click("sample");

  const chapters = byClass($("chapters"), "chap-btn");
  assert.deepEqual(chapters.map((b) => byClass(b, "cl")[0].textContent), ["Chapter 7", "Chapter 12"]);
  assert.ok(chapters[0].classList.contains("active"), "Chapter 7 is active");

  // Pre-existing behavior, preserved by the refactor: sample data is injected
  // directly into state, so it keeps its authored order (sorting happens on add).
  assert.deepEqual(heads(), [
    "\u00a7 7-4. Certificates",
    "\u00a7 7-1. Application",
    "\u00a7 7-3. Rate filings",
    "\u00a7 7-2. Definitions"
  ]);

  // The sample's definitions section (rendered last) highlights its quoted terms.
  assert.deepEqual(termTexts().sort(), ["Authority", "Certificate of public convenience and necessity", "Net income"]);
});

test("clause nesting: indentation wins, markers printed exactly once", () => {
  const s71 = sectByHead("\u00a7 7-1. Application");
  const clauses = byClass(s71, "clause");
  assert.deepEqual(clauses.map((c) => c.style.paddingLeft), ["0rem", "0rem", "1.5rem", "1.5rem", "0rem"]);
  assert.deepEqual(clauses.map((c) => { const b = child(c, "B"); return b ? b.textContent : null; }),
    [null, "(a)", "(1)", "(2)", "(b)"]);

  for (const c of clauses) {
    const b = child(c, "B"), span = child(c, "SPAN");
    if (b) {
      assert.equal(b.tagName, "B", "marker is a bold label");
      assert.ok(!span.textContent.startsWith(b.textContent), "marker is sliced off the body, not repeated");
    }
  }
  assert.equal(child(clauses[1], "SPAN").textContent, "The authority shall review each application within 60 days.");

  // No indentation in this section, so depth is inferred from the marker sequence.
  const c73 = byClass(sectByHead("\u00a7 7-3. Rate filings"), "clause");
  assert.deepEqual(c73.map((c) => c.style.paddingLeft), ["1.5rem", "3rem", "3rem"]);
  assert.deepEqual(c73.map((c) => child(c, "B").textContent), ["(a)", "(1)", "(2)"]);
});

test("export chapter: standalone, styled, identical to the preview", async () => {
  const before = dom.downloads.length;
  await click("xOne");
  assert.equal(dom.downloads.length, before + 1);
  assert.equal(dom.downloads.at(-1).download, "chapter-7.html");

  const html = dom.exportedHtml();
  assert.match(html, /^<!doctype html>/);
  assert.ok(html.includes(":root{ --bg:#efece6;"), "inlines styles/doc.css");
  assert.ok(html.includes(".doc .page{"), "inlines the document rules");
  assert.ok(html.includes('body class="doc-export"'));
  assert.ok(html.includes('<div class="doc"><div class="page">'), "wraps the shared page markup");
  assert.ok(html.includes('<h3 class="chapter-head">Chapter 7 \u2014 Public Utilities</h3>'));
  assert.ok(html.includes('<h4 class="sect-head">\u00a7 7-2. Definitions</h4>'));
  assert.ok(html.includes('<mark class="term">Authority</mark>'), "highlighting survives into the export");
  assert.ok(!html.includes("<script") && !html.includes("<link"), "self-contained: no external refs");

  const onScreen = $("sections").childNodes.find((n) => n.nodeType === 1 && n.classList.contains("page"));
  assert.ok(html.includes(onScreen.outerHTML), "preview markup == export markup");
});

test("export all: one file per chapter", async () => {
  const before = dom.downloads.length;
  await click("xAll");
  assert.equal(dom.downloads.length, before + 2);
  assert.deepEqual(dom.downloads.slice(-2).map((d) => d.download), ["chapter-7.html", "chapter-12.html"]);
});

test("clear all empties the document", async () => {
  await click("clear");
  assert.match($("sections").textContent, /No chapters yet/);
  assert.deepEqual(dom.savedState().chapters, []);
});

test("adding sections: natural sort, duplicate guard, retroactive highlighting", async () => {
  await paste({ text: "The Authority shall act on each application.", chNum: "7", secNum: "7-10" });
  assert.deepEqual(heads(), ["\u00a7 7-10"]);
  assert.deepEqual(termTexts(), [], "no definitions section yet, so nothing is highlighted");

  await paste({ text: "Every public utility shall file its rates.", chNum: "7", secNum: "7-2" });
  assert.deepEqual(heads(), ["\u00a7 7-2", "\u00a7 7-10"], "7-2 sorts before 7-10");

  await paste({ text: "The Authority shall publish notice.", chNum: "7", secNum: "7-1" });
  assert.deepEqual(heads(), ["\u00a7 7-1", "\u00a7 7-2", "\u00a7 7-10"]);

  await paste({ text: "\u201CAuthority\u201D means the board.", chNum: "7", secNum: "7-3", secTitle: "Definitions" });
  assert.deepEqual(heads(), ["\u00a7 7-1", "\u00a7 7-2", "\u00a7 7-3. Definitions", "\u00a7 7-10"]);

  // 7-1 and 7-10 were added (and rendered unhighlighted) BEFORE the definitions
  // section existed — a later definitions section must retrofit them.
  assert.ok(byClass(sectByHead("\u00a7 7-1"), "term").some((e) => e.textContent === "Authority"),
    "definitions added later retroactively highlight earlier sections");
  assert.ok(byClass(sectByHead("\u00a7 7-10"), "term").some((e) => e.textContent === "Authority"));
  assert.equal(termTexts().length, 3);
  assert.equal(sectByHead("\u00a7 7-2").textContent.includes("Authority"), false, "non-defining section untouched");

  await paste({ text: "Duplicate attempt.", chNum: "7", secNum: "7-1" });
  assert.deepEqual(heads(), ["\u00a7 7-1", "\u00a7 7-2", "\u00a7 7-3. Definitions", "\u00a7 7-10"], "duplicate rejected");
  assert.match($("toast").textContent, /Section 7-1 is already in Chapter 7\./);
});

test("persisted state keeps raw bodies (no highlighting baked in)", () => {
  const saved = dom.savedState();
  assert.equal(saved.activeKey, "7");
  assert.deepEqual(saved.chapters.map((c) => c.key), ["7"]);
  assert.deepEqual(saved.chapters[0].sections.map((s) => s.number), ["7-1", "7-2", "7-3", "7-10"]);
  assert.ok(saved.chapters[0].sections.every((s) => !s.body.includes("<mark")), "stored bodies stay raw");
});
