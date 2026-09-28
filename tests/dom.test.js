/* End-to-end smoke test: boots the REAL src/main.js against the real
   index.html (via the DOM shim) and drives the app the way a user would —
   type the four fields by hand, paste wording, edit names, export chapters.
   No dependencies.

   Run with:  node --test tests/dom.test.js

   The tests share one DOM and run in order, so they are intentionally
   sequential: each one starts where the previous left off. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom-shim.js";

const dom = installDom();
await import("../src/main.js");        // dynamic import: runs AFTER the globals exist

const $ = (id) => dom.document.getElementById(id);
const dispatch = async (node, type, extra) => { for (const r of node.dispatch(type, extra)) await r; };
const clickNode = (node) => dispatch(node, "click");
const press = (node, key) => dispatch(node, "keydown", { key });
const click = (id) => clickNode($(id));

function all(root, pred, out = []) {
  for (const c of root.childNodes) {
    if (c.nodeType === 1) { if (pred(c)) out.push(c); all(c, pred, out); }
  }
  return out;
}
const byClass = (root, cls) => all(root, (e) => e.classList.contains(cls));
const buttonNamed = (root, text) => all(root, (e) => e.tagName === "BUTTON").find((b) => b.textContent === text);
const inputs = (root) => all(root, (e) => e.tagName === "INPUT");
const heads = () => byClass($("sections"), "sect-head").map((e) => e.textContent);
const marksIn = (root) => byClass(root, "term").map((e) => e.textContent);
const clLabels = () => byClass($("chapters"), "cl").map((e) => e.textContent);

function sectByHead(head) {
  return byClass($("sections"), "sect").find((s) => byClass(s, "sect-head")[0].textContent === head) || null;
}
function chapterRow(label) {
  return byClass($("chapters"), "chap-row").find((r) => byClass(r, "cl")[0].textContent === label);
}
const openEditor = (scope) => byClass(scope, "edit-form")[0];

async function addSection({ paste = "", chNum = "", chTitle = "", secNum = "", secTitle = "" }) {
  $("paste").value = paste;
  $("chNum").value = chNum;
  $("chTitle").value = chTitle;
  $("secNum").value = secNum;
  $("secTitle").value = secTitle;
  await click("add");
}

test("boots empty and explains that all four fields are required", () => {
  assert.match($("sections").textContent, /No chapters yet/);
  assert.match($("hint").textContent, /All four fields are required/);
});

test("adding requires all four fields to be entered by hand", async () => {
  await addSection({ paste: "(a) Every utility shall file." });
  assert.match($("toast").textContent, /Enter the Chapter, Chapter title, Section number and Section title\./);
  assert.match($("hint").textContent, /Section title/);
  assert.match($("sections").textContent, /No chapters yet/);

  await addSection({ chNum: "7", paste: "(a) text" });
  assert.match($("toast").textContent, /Enter the Chapter title, Section number and Section title\./);

  await addSection({ chNum: "7", chTitle: "Public Utilities", secNum: "7-1", secTitle: "Rate filings" });
  assert.match($("toast").textContent, /Paste the statute or regulation text first\./);
  assert.match($("sections").textContent, /No chapters yet/);
});

test("adding normalizes the pasted wording and clears the form", async () => {
  await addSection({
    chNum: "7", chTitle: "Public Utilities", secNum: "7-1", secTitle: "Rate filings",
    paste: "(a)  Every   public utility shall file its rates.\r\n\r\n\r\n    (1) A filing must state the net income.\t"
  });

  assert.deepEqual(heads(), ["\u00a7 7-1. Rate filings"]);
  assert.equal($("paste").value, "");
  assert.equal($("chNum").value, "");
  assert.equal($("hint").textContent.startsWith("All four fields"), true);

  assert.equal(dom.savedState().chapters[0].sections[0].body,
    "(a) Every public utility shall file its rates.\n\n    (1) A filing must state the net income.",
    "CRLF, runs of spaces, blank-line piles and trailing tabs are cleaned up");
});

test("text that looks like a heading is kept as wording, not parsed", async () => {
  await addSection({
    chNum: "7", chTitle: "Public Utilities", secNum: "7-2", secTitle: "Certificates",
    paste: "\u00a7 7-99. Something else\n(a) It stays in the body."
  });

  const sec = dom.savedState().chapters[0].sections.find((s) => s.number === "7-2");
  assert.equal(sec.body, "\u00a7 7-99. Something else\n(a) It stays in the body.");
  assert.ok(heads().includes("\u00a7 7-2. Certificates"), "the typed number wins");
});

test("a duplicate section number is refused", async () => {
  await addSection({ chNum: "7", chTitle: "Public Utilities", secNum: "7-1", secTitle: "Dup", paste: "(a) text" });
  assert.match($("toast").textContent, /Section 7-1 is already in Chapter 7\./);
  assert.deepEqual(heads(), ["\u00a7 7-1. Rate filings", "\u00a7 7-2. Certificates"]);
});

test("a section's number and title can be edited after it was added", async () => {
  await clickNode(buttonNamed(sectByHead("\u00a7 7-2. Certificates"), "Edit"));

  const form = openEditor($("sections"));
  const [num, title] = inputs(form);
  assert.equal(num.value, "7-2");
  assert.equal(title.value, "Certificates");

  num.value = "7-10";
  title.value = "Renamed";
  await clickNode(buttonNamed(form, "Save"));

  assert.deepEqual(heads(), ["\u00a7 7-1. Rate filings", "\u00a7 7-10. Renamed"], "re-sorted after the rename");
  assert.equal(openEditor($("sections")), undefined, "editor closes");
});

test("cancelling a section edit changes nothing", async () => {
  await clickNode(buttonNamed(sectByHead("\u00a7 7-10. Renamed"), "Edit"));
  const form = openEditor($("sections"));
  inputs(form)[0].value = "999";
  await clickNode(buttonNamed(form, "Cancel"));
  assert.deepEqual(heads(), ["\u00a7 7-1. Rate filings", "\u00a7 7-10. Renamed"]);
});

test("Enter saves and Escape cancels an inline editor", async () => {
  await clickNode(buttonNamed(sectByHead("\u00a7 7-10. Renamed"), "Edit"));
  let form = openEditor($("sections"));
  inputs(form)[1].value = "By Enter";
  await press(inputs(form)[1], "Enter");
  assert.ok(heads().includes("\u00a7 7-10. By Enter"));

  await clickNode(buttonNamed(sectByHead("\u00a7 7-10. By Enter"), "Edit"));
  form = openEditor($("sections"));
  inputs(form)[1].value = "Discarded";
  await press(inputs(form)[1], "Escape");
  assert.ok(heads().includes("\u00a7 7-10. By Enter"));
});

test("editing a section onto an existing number is refused", async () => {
  await clickNode(buttonNamed(sectByHead("\u00a7 7-10. By Enter"), "Edit"));
  const form = openEditor($("sections"));
  inputs(form)[0].value = "7-1";
  await clickNode(buttonNamed(form, "Save"));

  assert.match($("toast").textContent, /Section 7-1 is already in Chapter 7\./);
  const stillOpen = openEditor($("sections"));
  assert.ok(stillOpen, "editor stays open so the clash can be fixed");
  await clickNode(buttonNamed(stillOpen, "Cancel"));
});

test("a chapter's name and title can be edited in the sidebar", async () => {
  await clickNode(buttonNamed($("chapters"), "Edit"));

  const form = openEditor($("chapters"));
  const [name, title] = inputs(form);
  assert.equal(name.value, "7");
  assert.equal(title.value, "Public Utilities");

  name.value = "7A";
  title.value = "Utilities";
  await clickNode(buttonNamed(form, "Save"));

  assert.deepEqual(clLabels(), ["Chapter 7A"]);
  assert.equal(byClass($("chapters"), "ct")[0].textContent, "Utilities");
  assert.ok($("sections").textContent.includes("Chapter 7A"), "document header follows the rename");
});

test("renaming a chapter onto an existing one is refused", async () => {
  await addSection({ chNum: "12", chTitle: "Taxation", secNum: "12-1", secTitle: "Imposition", paste: "A tax is imposed." });

  await clickNode(buttonNamed(chapterRow("Chapter 12"), "Edit"));
  const form = openEditor($("chapters"));
  inputs(form)[0].value = "7A";
  await clickNode(buttonNamed(form, "Save"));

  assert.match($("toast").textContent, /Chapter 7A already exists\./);
  assert.ok(openEditor($("chapters")), "editor stays open so the clash can be fixed");
  await clickNode(buttonNamed(openEditor($("chapters")), "Cancel"));
  assert.deepEqual(clLabels(), ["Chapter 7A", "Chapter 12"]);
});

test("load sample: chapter order, multi-term definitions and the self-highlight rule", async () => {
  await click("sample");

  assert.deepEqual(clLabels(), ["Chapter 7", "Chapter 12"]);
  assert.deepEqual(heads(), [
    "\u00a7 7-4. Certificates",
    "\u00a7 7-1. Application",
    "\u00a7 7-3. Rate filings",
    "\u00a7 7-2. Definitions"
  ]);

  // The section that defines a term must not highlight that term in its own
  // definitions — only where it turns up inside a DIFFERENT definition.
  const definitions = sectByHead("\u00a7 7-2. Definitions");
  assert.deepEqual(marksIn(definitions), ["Authority", "certificate"],
    "only the references inside the \u201CRate\u201D definition are highlighted");

  // Other sections highlight everything, case-insensitively, including the
  // second term of a multi-term definition.
  const application = marksIn(sectByHead("\u00a7 7-1. Application"));
  assert.ok(application.includes("authority"), "lowercase use of a defined term is highlighted");
  assert.ok(application.includes("certificate of public convenience and necessity"));
});

test("export chapter: standalone, styled and free of editing chrome", async () => {
  await click("xOne");
  assert.equal(dom.downloads.at(-1).download, "chapter-7.html");

  const html = dom.exportedHtml();
  assert.match(html, /^<!doctype html>/);
  assert.ok(html.includes(":root{ --bg:#efece6;"), "inlines styles/doc.css");
  assert.ok(html.includes('<div class="doc"><div class="page">'));
  assert.ok(html.includes('<h3 class="chapter-head">Chapter 7 \u2014 Public Utilities</h3>'));
  assert.ok(html.includes('<h4 class="sect-head">\u00a7 7-2. Definitions</h4>'));
  assert.ok(html.includes('<mark class="term">Authority</mark>'));
  assert.ok(!html.includes("<script") && !html.includes("<link"), "self-contained: no external refs");
  assert.ok(!html.includes("edit-form"), "no editor markup leaks into the export");
  assert.ok(!html.includes(">Edit</button>"), "no edit buttons leak into the export");
});

test("export all writes one file per chapter", async () => {
  const before = dom.downloads.length;
  await click("xAll");
  assert.equal(dom.downloads.length, before + 2);
  assert.deepEqual(dom.downloads.slice(-2).map((d) => d.download), ["chapter-7.html", "chapter-12.html"]);
});

test("persisted state keeps raw bodies", () => {
  const saved = dom.savedState();
  assert.deepEqual(saved.chapters.map((c) => c.key), ["7", "12"]);
  assert.ok(saved.chapters[0].sections.every((s) => !s.body.includes("<mark")), "bodies stay raw");
});

test("clear all empties the document", async () => {
  await click("clear");
  assert.match($("sections").textContent, /No chapters yet/);
  assert.deepEqual(dom.savedState().chapters, []);
});
