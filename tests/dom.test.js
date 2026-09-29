/* End-to-end smoke test: boots the REAL src/main.js against the real
   index.html (via the DOM shim) and drives the app the way a user would —
   pick a jurisdiction, type a chapter and section number, paste wording, edit
   names and organization parts, export chapters. No dependencies.

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
const jurNames = () => byClass($("chapters"), "jur-name").map((e) => e.textContent);

function sectByHead(head) {
  return byClass($("sections"), "sect").find((s) => byClass(s, "sect-head")[0].textContent === head) || null;
}
function chapterRow(label) {
  return byClass($("chapters"), "chap-row").find((r) => byClass(r, "cl")[0].textContent === label);
}
function jurGroup(name) {
  return byClass($("chapters"), "jur-group")
    .find((g) => (byClass(g, "jur-name")[0] || {}).textContent === name);
}
const openEditor = (scope) => byClass(scope, "edit-form")[0];
const savedChapter = (number) => dom.savedState().chapters.find((c) => c.partValues.Chapter === number);

function setPart(type, value) {
  const wrap = all($("parts"), (e) => e._part === type)[0];
  if (!wrap) throw new Error("no composer part field for " + type);
  inputs(wrap)[0].value = value;
}

async function pickJurisdiction(key) {
  if ($("jurisdiction").value === key) return;
  $("jurisdiction").value = key;
  await dispatch($("jurisdiction"), "change");
}

async function addSection({ paste = "", chNum = "", chTitle = "", secNum = "", secTitle = "", jur, parts }) {
  if (jur) await pickJurisdiction(jur);
  if (parts) for (const [t, v] of Object.entries(parts)) setPart(t, v);
  $("paste").value = paste;
  $("chNum").value = chNum;
  $("chTitle").value = chTitle;
  $("secNum").value = secNum;
  $("secTitle").value = secTitle;
  await click("add");
}

test("boots empty, seeds Federal, and states only the numbers are required", () => {
  assert.match($("sections").textContent, /No chapters yet/);
  assert.match($("hint").textContent, /Only the chapter and section number are required/);
  assert.deepEqual(jurNames(), ["Federal"]);
});

test("adding requires the chapter number and the section number", async () => {
  await addSection({ paste: "(a) Every utility shall file." });
  assert.match($("toast").textContent, /Enter the chapter number and section number\./);

  await addSection({ chNum: "7", paste: "(a) text" });
  assert.match($("toast").textContent, /Enter the section number\./);
  assert.match($("sections").textContent, /No chapters yet/);

  await addSection({ chNum: "7", secNum: "7-1" });
  assert.match($("toast").textContent, /Paste the statute or regulation text first\./);
  assert.match($("sections").textContent, /No chapters yet/);
});

test("blank titles default to UNKNOWN and the paste is normalized", async () => {
  await addSection({
    chNum: "7", secNum: "7-1",
    paste: "(a)  Every   public utility shall file its rates.\r\n\r\n\r\n    (1) A filing must state the net income.\t"
  });

  assert.deepEqual(heads(), ["\u00a7 7-1. UNKNOWN"]);
  assert.equal(savedChapter("7").title, "UNKNOWN");
  assert.equal(savedChapter("7").sections[0].title, "UNKNOWN");
  assert.equal($("paste").value, "");
  assert.equal($("chNum").value, "");
  assert.equal($("hint").textContent.startsWith("Only the chapter"), true);

  assert.equal(savedChapter("7").sections[0].body,
    "(a) Every public utility shall file its rates.\n\n    (1) A filing must state the net income.",
    "CRLF, runs of spaces, blank-line piles and trailing tabs are cleaned up");
});

test("text that looks like a heading is kept as wording, not parsed", async () => {
  await addSection({
    chNum: "7", secNum: "7-2", secTitle: "Certificates",
    paste: "\u00a7 7-99. Something else\n(a) It stays in the body."
  });

  const sec = savedChapter("7").sections.find((s) => s.number === "7-2");
  assert.equal(sec.body, "\u00a7 7-99. Something else\n(a) It stays in the body.");
  assert.ok(heads().includes("\u00a7 7-2. Certificates"), "the typed number wins");
});

test("a duplicate section number is refused", async () => {
  await addSection({ chNum: "7", secNum: "7-1", paste: "(a) text" });
  assert.match($("toast").textContent, /Section 7-1 is already in Chapter 7\./);
  assert.deepEqual(heads(), ["\u00a7 7-1. UNKNOWN", "\u00a7 7-2. Certificates"]);
});

test("a chapter title supplied later backfills an UNKNOWN chapter", async () => {
  await addSection({ chNum: "7", chTitle: "Public Utilities", secNum: "7-3", paste: "A filing must state the net income." });
  assert.equal(savedChapter("7").title, "Public Utilities");
  assert.equal(byClass($("chapters"), "ct")[0].textContent, "Public Utilities");
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

  assert.deepEqual(heads(), ["\u00a7 7-1. UNKNOWN", "\u00a7 7-3. UNKNOWN", "\u00a7 7-10. Renamed"],
    "re-sorted after the rename");
  assert.equal(openEditor($("sections")), undefined, "editor closes");
});

test("cancelling a section edit changes nothing", async () => {
  await clickNode(buttonNamed(sectByHead("\u00a7 7-10. Renamed"), "Edit"));
  const form = openEditor($("sections"));
  inputs(form)[0].value = "999";
  await clickNode(buttonNamed(form, "Cancel"));
  assert.deepEqual(heads(), ["\u00a7 7-1. UNKNOWN", "\u00a7 7-3. UNKNOWN", "\u00a7 7-10. Renamed"]);
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

test("clearing a section title on edit falls back to UNKNOWN", async () => {
  await clickNode(buttonNamed(sectByHead("\u00a7 7-10. By Enter"), "Edit"));
  const form = openEditor($("sections"));
  inputs(form)[1].value = "";
  await clickNode(buttonNamed(form, "Save"));
  assert.ok(heads().includes("\u00a7 7-10. UNKNOWN"));
});

test("editing a section onto an existing number is refused", async () => {
  await clickNode(buttonNamed(sectByHead("\u00a7 7-10. UNKNOWN"), "Edit"));
  const form = openEditor($("sections"));
  inputs(form)[0].value = "7-1";
  await clickNode(buttonNamed(form, "Save"));

  assert.match($("toast").textContent, /Section 7-1 is already in Chapter 7\./);
  const stillOpen = openEditor($("sections"));
  assert.ok(stillOpen, "editor stays open so the clash can be fixed");
  await clickNode(buttonNamed(stillOpen, "Cancel"));
});

test("a chapter's organization and title can be edited in the sidebar", async () => {
  await clickNode(buttonNamed(chapterRow("Chapter 7"), "Edit"));

  const form = openEditor($("chapters"));
  const num = inputs(form).find((i) => i._part === "Chapter");
  assert.equal(num.value, "7");
  const title = inputs(form).at(-1);
  assert.equal(title.value, "Public Utilities");

  num.value = "7A";
  title.value = "Utilities";
  await clickNode(buttonNamed(form, "Save"));

  assert.deepEqual(clLabels(), ["Chapter 7A"]);
  assert.equal(byClass($("chapters"), "ct")[0].textContent, "Utilities");
  assert.ok($("sections").textContent.includes("Chapter 7A"), "document header follows the rename");
});

test("editing a chapter onto an existing one is refused", async () => {
  await addSection({ chNum: "12", secNum: "12-1", paste: "A tax is imposed." });

  await clickNode(buttonNamed(chapterRow("Chapter 12"), "Edit"));
  const form = openEditor($("chapters"));
  inputs(form).find((i) => i._part === "Chapter").value = "7A";
  await clickNode(buttonNamed(form, "Save"));

  assert.match($("toast").textContent, /That chapter already exists in this jurisdiction\./);
  assert.ok(openEditor($("chapters")), "editor stays open so the clash can be fixed");
  await clickNode(buttonNamed(openEditor($("chapters")), "Cancel"));
  assert.deepEqual(clLabels(), ["Chapter 7A", "Chapter 12"]);
});

test("a state jurisdiction can be added and groups the sidebar", async () => {
  await click("addJurisdiction");
  const form = openEditor($("chapters"));
  assert.ok(form, "the new-jurisdiction editor opens");

  inputs(form)[0].value = "Kentucky";
  await clickNode(buttonNamed(form, "Save"));

  assert.deepEqual(jurNames(), ["Federal", "Kentucky"]);
  assert.deepEqual(byClass(jurGroup("Kentucky"), "jur-tag").map((e) => e.textContent), ["State"]);
});

test("a chapter can be added under a state jurisdiction", async () => {
  await addSection({ jur: "kentucky", chNum: "1", secNum: "1-1", paste: "A tax is imposed on every resident." });

  assert.deepEqual(clLabels(), ["Chapter 7A", "Chapter 12", "Chapter 1"]);
  assert.equal(savedChapter("1").jurisdiction, "kentucky");
  assert.equal(savedChapter("1").title, "UNKNOWN");
});

test("federal organization parts can be added, reordered and removed", async () => {
  const group = jurGroup("Federal");
  await clickNode(buttonNamed(byClass(group, "jur-head")[0], "Edit"));
  let form = openEditor($("chapters"));
  const partNames = () => byClass(form, "part-name").map((e) => e.textContent);
  assert.deepEqual(partNames(), ["Title", "Chapter", "Subchapter", "Part"]);

  const chapterRowEl = byClass(form, "part-row").find((r) => byClass(r, "part-name")[0].textContent === "Chapter");
  assert.equal(buttonNamed(chapterRowEl, "\u2715"), undefined, "the Chapter anchor cannot be removed");

  inputs(form).find((i) => i.placeholder === "e.g. Subpart").value = "Subpart";
  await clickNode(buttonNamed(form, "Add"));
  form = openEditor($("chapters"));
  assert.deepEqual(partNames(), ["Title", "Chapter", "Subchapter", "Part", "Subpart"]);

  const subpartRow = () => byClass(form, "part-row").find((r) => byClass(r, "part-name")[0].textContent === "Subpart");
  await clickNode(buttonNamed(subpartRow(), "\u2191"));
  form = openEditor($("chapters"));
  assert.deepEqual(partNames(), ["Title", "Chapter", "Subchapter", "Subpart", "Part"]);

  const partRow = () => byClass(form, "part-row").find((r) => byClass(r, "part-name")[0].textContent === "Part");
  await clickNode(buttonNamed(partRow(), "\u2715"));
  form = openEditor($("chapters"));
  assert.deepEqual(partNames(), ["Title", "Chapter", "Subchapter", "Subpart"]);

  await clickNode(buttonNamed(form, "Save"));
  assert.equal(openEditor($("chapters")), undefined, "editor closes");
});

test("the composer exposes the federal organization fields", async () => {
  await pickJurisdiction("federal");
  assert.deepEqual(byClass($("parts"), "part-label").map((e) => e.textContent),
    ["Title", "Subchapter", "Subpart"], "every level except the Chapter anchor");
});

test("a federal statute is filed under its full organization path", async () => {
  await addSection({
    jur: "federal", chNum: "21", secNum: "1983", secTitle: "Civil action",
    parts: { Title: "42", Subchapter: "IV" },
    paste: "Every person who, under color of law, deprives another of a right shall be liable."
  });

  assert.ok(clLabels().includes("Title 42 \u00b7 Chapter 21 \u00b7 Subchapter IV"));
  const us = savedChapter("21");
  assert.deepEqual(us.partValues, { Title: "42", Chapter: "21", Subchapter: "IV", Subpart: "" });
  assert.equal(us.title, "UNKNOWN");
  assert.deepEqual(heads(), ["\u00a7 1983. Civil action"]);
});

test("load sample: groups, chapter order, definitions and the self-highlight rule", async () => {
  await click("sample");

  assert.deepEqual(jurNames(), ["Federal", "Kentucky"]);
  assert.deepEqual(clLabels(), ["Title 42 \u00b7 Chapter 21 \u00b7 Subchapter IV", "Chapter 7", "Chapter 12"]);
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
  assert.equal(dom.downloads.at(-1).download, "kentucky-7.html");

  const html = dom.exportedHtml();
  assert.match(html, /^<!doctype html>/);
  assert.ok(html.includes(":root{ --bg:#efece6;"), "inlines styles/doc.css");
  assert.ok(html.includes('<div class="doc"><div class="page">'));
  assert.ok(html.includes('<h3 class="chapter-head">Chapter 7 \u2014 Public Utilities</h3>'));
  assert.ok(html.includes('<h4 class="sect-head">\u00a7 7-2. Definitions</h4>'));
  assert.ok(html.includes("Kentucky \u00b7 4 sections"), "names the jurisdiction");
  assert.ok(html.includes('<mark class="term">Authority</mark>'));
  assert.ok(!html.includes("<script") && !html.includes("<link"), "self-contained: no external refs");
  assert.ok(!html.includes("edit-form"), "no editor markup leaks into the export");
  assert.ok(!html.includes(">Edit</button>"), "no edit buttons leak into the export");
});

test("export all writes one file per chapter, named by jurisdiction and path", async () => {
  const before = dom.downloads.length;
  await click("xAll");
  assert.equal(dom.downloads.length, before + 3);
  assert.deepEqual(dom.downloads.slice(-3).map((d) => d.download),
    ["kentucky-7.html", "kentucky-12.html", "federal-42-21-IV.html"]);
});

test("persisted state keeps raw bodies", () => {
  const saved = dom.savedState();
  assert.deepEqual(saved.jurisdictions.map((j) => j.key), ["federal", "kentucky"]);
  assert.ok(saved.chapters[0].sections.every((s) => !s.body.includes("<mark")), "bodies stay raw");
});

test("clear all empties the document but keeps the default jurisdiction", async () => {
  await click("clear");
  assert.match($("sections").textContent, /No chapters yet/);
  assert.deepEqual(dom.savedState().chapters, []);
  assert.deepEqual(jurNames(), ["Federal"]);
});

test("a soft-wrapped paste is unwrapped but keeps its structure", async () => {
  await addSection({
    chNum: "9", secNum: "9-1",
    paste: "The authority shall review each application within 60 days\n" +
      "of receipt of a complete filing. It shall then\n" +
      "issue a decision.\n\n" +
      "(a) The board shall act.\n" +
      "    (1) Records shall be kept."
  });

  const stored = savedChapter("9").sections[0].body;
  assert.equal(stored,
    "The authority shall review each application within 60 days of receipt of a complete filing. " +
    "It shall then issue a decision.\n\n" +
    "(a) The board shall act.\n" +
    "    (1) Records shall be kept.",
    "prose wraps joined, paragraph break and indented item kept");
});
