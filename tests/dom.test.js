/* End-to-end smoke test: boots the REAL src/main.js against the real
   index.html (via the DOM shim) and drives the app the way a user would — pick
   a jurisdiction, fill in the organization tree, paste wording, edit names,
   export chapters. No dependencies.

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
const options = (node) => all(node, (e) => e.tagName === "OPTION");
const heads = () => byClass($("sections"), "sect-head").map((e) => e.textContent);
const marksIn = (root) => byClass(root, "term").map((e) => e.textContent);
const clLabels = () => byClass($("chapters"), "cl").map((e) => e.textContent);
const jurNames = () => byClass($("chapters"), "jur-name").map((e) => e.textContent);
const saved = () => dom.savedState();

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

/* ---------- the composer's organization tree ---------- */
const orgRows = (host = $("parts")) => byClass(host, "org-row");
const orgRow = (level, host = $("parts")) =>
  orgRows(host).find((r) => byClass(r, "org-name")[0].textContent === level);
const orgCheck = (level, host) => byClass(orgRow(level, host), "org-check")[0];
const orgInput = (level, host) => byClass(orgRow(level, host), "org-input")[0];
const anchorInput = (host = $("parts")) => byClass(all(host, (e) => e.classList.contains("anchor"))[0], "org-input")[0];

/* The anchor of the selected jurisdiction, via the row the composer marks. */
function anchorLevel() {
  return byClass($("parts"), "org-name")[orgRows().findIndex((r) => r.classList.contains("anchor"))]
    .textContent;
}

async function setAnchor(value) {
  anchorInput().value = value;
}

/* Turn a level on (if it is off) and give it its code. */
async function setLevel(level, code) {
  const box = orgCheck(level);
  if (!box.checked) { box.checked = true; await dispatch(box, "change"); }
  orgInput(level).value = code;
}

async function pickJurisdiction(key) {
  if ($("jurisdiction").value === key) return;
  $("jurisdiction").value = key;
  await dispatch($("jurisdiction"), "change");
}

function fillComposer({ paste = "", chTitle = "", secNum = "", secTitle = "" }) {
  $("paste").value = paste;
  $("chTitle").value = chTitle;
  $("secNum").value = secNum;
  $("secTitle").value = secTitle;
}

async function addSection(opts = {}) {
  if (opts.jur) await pickJurisdiction(opts.jur);
  if (opts.anchor != null) await setAnchor(opts.anchor);
  for (const [level, code] of Object.entries(opts.levels || {})) await setLevel(level, code);
  fillComposer(opts);
  await click("add");
}

const fedChapter = (title) => saved().chapters.find((c) => (c.partValues || {}).Title === title);
const kyChapter = (number) => saved().chapters.find((c) => (c.partValues || {}).Chapter === number);
const chapterOf = (number) => saved().chapters.find((c) => c.sections.some((s) => s.number === number));

/* ---------- boot ---------- */

test("boots with Federal plus every state and asks for the Title and a section number", () => {
  assert.match($("sections").textContent, /No chapters yet/);
  assert.match($("hint").textContent, /Only the Title and the section number are required/);
  assert.equal($("chTitleLabel").textContent, "Title heading");
  assert.equal($("secNumLabel").textContent, "Section number *", "the section number is required");

  const sel = $("jurisdiction");
  assert.equal(options(sel).length, 51);
  assert.equal(sel.value, "federal");
  assert.equal(options(sel)[0].textContent, "Federal (Federal)");
  assert.deepEqual(options(sel).slice(1, 4).map((o) => o.textContent), ["Alabama", "Alaska", "Arizona"]);
  assert.equal(options(sel).at(-1).textContent, "Wyoming");

  assert.equal(jurNames().length, 51, "the sidebar is prepopulated");
  assert.equal(jurNames()[0], "Federal");
  assert.ok(jurNames().includes("Kentucky") && jurNames().includes("Wyoming"));
});

test("the Title is a drop-down that offers exactly 1 to 50", () => {
  const sel = anchorInput();
  assert.equal(sel.tagName, "SELECT");
  assert.equal(anchorLevel(), "Title");
  assert.equal(orgRows().map((r) => byClass(r, "org-name")[0].textContent).join(","),
    "Title,Subtitle,Division,Chapter,Subchapter,Part,Subpart,Section,Subsection");

  const opts = options(sel);
  assert.equal(opts.length, 51, "a blank choice plus 50 Titles");
  assert.equal(opts[0].value, "");
  assert.deepEqual(opts.slice(1, 4).map((o) => o.textContent), ["1", "2", "3"]);
  assert.equal(opts.at(-1).textContent, "50");

  const check = orgCheck("Title");
  assert.ok(check.checked && check.disabled, "the Title row is the required level");
  assert.equal(orgCheck("Chapter").checked, false);
  assert.equal(orgInput("Chapter").disabled, true, "an unchecked level takes no code");
});

/* ---------- validation ---------- */

test("adding needs the Title, a section number and some wording", async () => {
  fillComposer({ paste: "(a) Every utility shall file." });
  await click("add");
  assert.match($("toast").textContent, /Enter the Title and section number\./,
    "everything that is missing is named at once");

  await setAnchor("42");
  await click("add");
  assert.match($("toast").textContent, /Enter the section number\./,
    "the Title alone is not enough");

  fillComposer({ paste: "(a) text", secNum: "1971" });
  await setLevel("Chapter", "");
  await click("add");
  assert.match($("toast").textContent, /Enter 1\u20132 letters or numbers for the Chapter\./);

  await setLevel("Chapter", "217");
  await click("add");
  assert.match($("toast").textContent, /The Chapter can only be 1\u20132 letters or numbers\./);

  fillComposer({ secNum: "1971" });
  await click("add");
  assert.match($("toast").textContent, /Paste the statute or regulation text first\./);

  assert.match($("sections").textContent, /No chapters yet/, "nothing is stored yet");
});

test("a Title outside 1 to 50 is refused even if it reaches the model", async () => {
  await setLevel("Chapter", "21");
  await setAnchor("51");
  fillComposer({ paste: "(a) text", secNum: "1971" });
  await click("add");
  assert.match($("toast").textContent, /A Title must be a number from 1 to 50\./);
  assert.match($("sections").textContent, /No chapters yet/);
});

/* ---------- adding ---------- */

test("a section is filed under the Title and the checked levels", async () => {
  await addSection({ anchor: "42", levels: { Chapter: "21" }, secNum: "1971", paste: "Every utility shall file." });

  assert.ok(clLabels().includes("Title 42 \u00b7 Chapter 21"));
  assert.deepEqual(fedChapter("42").partValues, { Title: "42", Chapter: "21" });
  assert.equal(fedChapter("42").title, "UNKNOWN");
  assert.deepEqual(heads(), ["\u00a7 1971. UNKNOWN"]);
  assert.equal(fedChapter("42").sections[0].number, "1971");
  assert.equal($("secNum").value, "", "the section number is cleared for the next one");
  assert.equal($("paste").value, "");
});

test("the Title and the level codes stay put, so several sections share a chapter", async () => {
  await addSection({ levels: { Chapter: "21", Subchapter: "IV" }, secNum: "1983", secTitle: "Civil action", paste: "(a) Every person shall be liable." });

  assert.equal(anchorInput().value, "42", "the Title is still selected");
  assert.equal(orgInput("Chapter").value, "21");
  assert.equal(orgInput("Subchapter").value, "IV");

  await addSection({ secNum: "1985", paste: "(a) Another section." });
  assert.equal(chapterOf("1983").sections.length, 2, "the same path merges into one chapter");
  assert.deepEqual(chapterOf("1983").sections.map((s) => s.number), ["1983", "1985"]);
  assert.ok(clLabels().includes("Title 42 \u00b7 Chapter 21 \u00b7 Subchapter IV"));
  assert.ok(clLabels().includes("Title 42 \u00b7 Chapter 21"),
    "with fewer levels checked the same Title and Chapter make a different chapter");
});

test("a section title supplied later backfills an UNKNOWN chapter", async () => {
  await addSection({ chTitle: "Civil Rights", secNum: "1990", paste: "A filing must state the net income." });
  assert.equal(chapterOf("1983").title, "Civil Rights");
  assert.deepEqual(chapterOf("1983").sections.map((s) => s.number), ["1983", "1985", "1990"]);
});

test("a duplicate section number is refused", async () => {
  await addSection({ secNum: "1983", paste: "(a) text" });
  assert.match($("toast").textContent,
    /Section 1983 is already in Title 42 \u00b7 Chapter 21 \u00b7 Subchapter IV\./);
  assert.equal(chapterOf("1983").sections.length, 3);
});

/* ---------- clause rendering ---------- */

test("a subclause is indented once per nesting level and keeps a space after its label", async () => {
  await addSection({
    secNum: "2000", secTitle: "Nesting",
    paste: "(a) The board shall act.\n    (1) Records shall be kept.\n        (i) A record is public."
  });

  const sect = sectByHead("\u00a7 2000. Nesting");
  const clauses = byClass(sect, "clause");
  assert.deepEqual(clauses.map((p) => p.style.paddingLeft), ["0rem", "1.5rem", "3rem"],
    "the clause sits in the margin, its subclause one step in, that subclause two");
  assert.deepEqual(byClass(sect, "clause-num").map((e) => e.textContent), ["(a)", "(1)", "(i)"]);
  assert.deepEqual(clauses.map((p) => p.textContent), [
    "(a) The board shall act.",
    "(1) Records shall be kept.",
    "(i) A record is public."
  ], "the label and the wording are separated by a space");
});

/* ---------- edits ---------- */

test("a section's number and title can be edited after it was added", async () => {
  await clickNode(buttonNamed(sectByHead("\u00a7 2000. Nesting"), "Edit"));
  let form = openEditor($("sections"));
  const [num, title] = inputs(form);
  assert.equal(num.value, "2000");
  assert.equal(title.value, "Nesting");

  num.value = "1999";
  title.value = "Renamed";
  await clickNode(buttonNamed(form, "Save"));

  assert.ok(heads().includes("\u00a7 1999. Renamed"), "re-sorted after the rename");
  assert.equal(openEditor($("sections")), undefined, "editor closes");
});

test("cancelling a section edit changes nothing, Enter saves and Escape cancels", async () => {
  await clickNode(buttonNamed(sectByHead("\u00a7 1999. Renamed"), "Edit"));
  let form = openEditor($("sections"));
  inputs(form)[0].value = "999";
  await clickNode(buttonNamed(form, "Cancel"));
  assert.ok(heads().includes("\u00a7 1999. Renamed"));

  await clickNode(buttonNamed(sectByHead("\u00a7 1999. Renamed"), "Edit"));
  form = openEditor($("sections"));
  inputs(form)[1].value = "By Enter";
  await press(inputs(form)[1], "Enter");
  assert.ok(heads().includes("\u00a7 1999. By Enter"));

  await clickNode(buttonNamed(sectByHead("\u00a7 1999. By Enter"), "Edit"));
  form = openEditor($("sections"));
  inputs(form)[1].value = "Discarded";
  await press(inputs(form)[1], "Escape");
  assert.ok(heads().includes("\u00a7 1999. By Enter"));
});

test("a section's number cannot be cleared", async () => {
  await clickNode(buttonNamed(sectByHead("\u00a7 1999. By Enter"), "Edit"));
  let form = openEditor($("sections"));
  assert.equal(byClass(form, "edit-label")[0].textContent, "Section number *",
    "the editor marks the number required");

  inputs(form)[0].value = "";
  inputs(form)[1].value = "Untitled";
  await clickNode(buttonNamed(form, "Save"));
  assert.match($("toast").textContent, /Enter the section number\./);
  assert.ok(openEditor($("sections")), "the editor stays open so the number can be typed");

  form = openEditor($("sections"));
  inputs(form)[0].value = "1999";
  await clickNode(buttonNamed(form, "Save"));
  assert.ok(heads().includes("\u00a7 1999. Untitled"));
});

test("editing a section onto an existing number is refused", async () => {
  await clickNode(buttonNamed(sectByHead("\u00a7 1999. Untitled"), "Edit"));
  const form = openEditor($("sections"));
  inputs(form)[0].value = "1983";
  await clickNode(buttonNamed(form, "Save"));

  assert.match($("toast").textContent, /Section 1983 is already in Title 42 \u00b7 Chapter 21 \u00b7 Subchapter IV\./);
  const stillOpen = openEditor($("sections"));
  assert.ok(stillOpen, "editor stays open so the clash can be fixed");
  await clickNode(buttonNamed(stillOpen, "Cancel"));
});

test("a chapter's organization can be edited in the sidebar", async () => {
  await clickNode(buttonNamed(chapterRow("Title 42 \u00b7 Chapter 21"), "Edit"));
  const form = openEditor($("chapters"));
  const host = byClass(form, "org-tree")[0];

  assert.equal(anchorInput(host).value, "42");
  assert.equal(orgInput("Chapter", host).value, "21");
  assert.equal(orgCheck("Subchapter", host).checked, false);

  anchorInput(host).value = "15";
  orgInput("Chapter", host).value = "217";
  await clickNode(buttonNamed(form, "Save"));
  assert.match($("toast").textContent, /The Chapter can only be 1\u20132 letters or numbers\./);
  assert.ok(openEditor($("chapters")), "the editor stays open so the code can be fixed");

  const reopen = openEditor($("chapters"));
  orgInput("Chapter", reopen).value = "10";
  await clickNode(buttonNamed(reopen, "Save"));

  assert.ok(clLabels().includes("Title 15 \u00b7 Chapter 10"));
  assert.equal(fedChapter("15").title, "UNKNOWN");
  assert.equal(clLabels().includes("Title 42 \u00b7 Chapter 21"), false,
    "the path moved, it was not copied");
});

test("editing a chapter onto an existing path is refused", async () => {
  await clickNode(buttonNamed(chapterRow("Title 15 \u00b7 Chapter 10"), "Edit"));
  let form = openEditor($("chapters"));
  const host = byClass(form, "org-tree")[0];
  anchorInput(host).value = "42";
  orgInput("Chapter", host).value = "21";
  const box = orgCheck("Subchapter", host);
  box.checked = true;
  await dispatch(box, "change");
  orgInput("Subchapter", host).value = "IV";
  await clickNode(buttonNamed(form, "Save"));

  assert.match($("toast").textContent, /That chapter already exists in this jurisdiction\./);
  form = openEditor($("chapters"));
  assert.ok(form, "the editor stays open so the clash can be fixed");
  await clickNode(buttonNamed(form, "Cancel"));
  assert.ok(clLabels().includes("Title 15 \u00b7 Chapter 10"));
});

/* ---------- states ---------- */

test("a state jurisdiction anchors on Chapter and takes a chapter number", async () => {
  await pickJurisdiction("kentucky");
  assert.equal($("chTitleLabel").textContent, "Chapter title");
  assert.match($("hint").textContent, /Only the Chapter and the section number are required/);
  assert.equal(anchorLevel(), "Chapter");
  assert.equal(anchorInput().tagName, "INPUT");

  await addSection({ paste: "A tax is imposed on every resident.", secNum: "7-1" });
  assert.match($("toast").textContent, /Enter the Chapter\./);

  const before = saved().chapters.length;
  await addSection({ anchor: "7", levels: { Chapter: "7" }, paste: "A tax is imposed.", secNum: "" });
  assert.match($("toast").textContent, /Enter the section number\./, "a state needs a section number too");
  assert.equal(saved().chapters.length, before);

  await addSection({ anchor: "7", levels: { Subchapter: "I" }, paste: "A tax is imposed.", secNum: "7-1" });
  assert.equal(kyChapter("7").jurisdiction, "kentucky");
  assert.ok(clLabels().includes("Chapter 7 \u00b7 Subchapter I"));
  assert.equal(kyChapter("7").sections[0].title, "UNKNOWN");
});

test("the sidebar's jurisdiction editor renames a jurisdiction", async () => {
  await clickNode(buttonNamed(byClass(jurGroup("Kentucky"), "jur-head")[0], "Edit"));
  const form = openEditor($("chapters"));
  assert.deepEqual(byClass(form, "edit-input").map((e) => e.tagName), ["INPUT", "SELECT"],
    "a name and a kind, nothing else");
  inputs(form)[0].value = "Commonwealth of Kentucky";
  await clickNode(buttonNamed(form, "Save"));

  assert.ok(jurGroup("Commonwealth of Kentucky"));
  assert.equal(jurGroup("Kentucky"), undefined);
  assert.equal(saved().jurisdictions.find((j) => j.key === "kentucky").name, "Commonwealth of Kentucky");
});

/* ---------- sample, definitions, export ---------- */

test("load sample: jurisdictions, chapter order, definitions", async () => {
  await click("sample");

  assert.equal(jurNames().length, 51);
  assert.equal(jurNames()[0], "Federal");
  assert.ok(jurNames().includes("Kentucky"));
  assert.deepEqual(clLabels(),
    ["Title 42 \u00b7 Chapter 21 \u00b7 Subchapter IV", "Chapter 7", "Chapter 12"]);
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

test("the sample's nested clauses are indented one step per level", () => {
  const clauses = byClass(sectByHead("\u00a7 7-1. Application"), "clause");
  assert.deepEqual(clauses.map((p) => p.style.paddingLeft),
    ["0rem", "0rem", "1.5rem", "1.5rem", "0rem"]);
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
  assert.ok(html.includes('<b class="clause-num">(a)</b> <span>The '),
    "the clause label keeps its space in the export");
  assert.ok(!html.includes("<script") && !html.includes("<link"), "self-contained: no external refs");
  assert.ok(!html.includes("edit-form") && !html.includes("org-tree"), "no editor markup leaks into the export");
  assert.ok(!html.includes(">Edit</button>"), "no edit buttons leak into the export");
});

test("export all writes one file per chapter, named by jurisdiction and path", async () => {
  const before = dom.downloads.length;
  await click("xAll");
  assert.equal(dom.downloads.length, before + 3);
  assert.deepEqual(dom.downloads.slice(-3).map((d) => d.download),
    ["kentucky-7.html", "kentucky-12.html", "federal-42-21-IV.html"]);
});

/* ---------- persistence ---------- */

test("persisted state keeps raw bodies and the seeded jurisdictions", () => {
  assert.equal(saved().jurisdictions.length, 51);
  assert.ok(saved().chapters[0].sections.every((s) => !s.body.includes("<mark")), "bodies stay raw");
});

test("clear all empties the document but keeps Federal and the states", async () => {
  await click("clear");
  assert.match($("sections").textContent, /No chapters yet/);
  assert.deepEqual(saved().chapters, []);
  assert.equal(saved().jurisdictions.length, 51);
  assert.equal(jurNames().length, 51);
});

/* ---------- normalization ---------- */

test("a soft-wrapped paste is unwrapped but keeps its structure", async () => {
  await pickJurisdiction("federal");
  await addSection({
    anchor: "9", levels: { Chapter: "1" }, secNum: "9-1",
    paste: "The authority shall review each application within 60 days\n" +
      "of receipt of a complete filing. It shall then\n" +
      "issue a decision.\n\n" +
      "(a) The board shall act.\n" +
      "    (1) Records shall be kept."
  });

  const stored = fedChapter("9").sections[0].body;
  assert.equal(stored,
    "The authority shall review each application within 60 days of receipt of a complete filing. " +
    "It shall then issue a decision.\n\n" +
    "(a) The board shall act.\n" +
    "    (1) Records shall be kept.",
    "prose wraps joined, paragraph break and indented item kept");
});
