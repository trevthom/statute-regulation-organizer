/* End-to-end smoke test: boots the REAL src/main.js against the real
   index.html (via the DOM shim) and drives the app the way a user would — pick
   a jurisdiction and the organization levels, paste wording, edit names, export
   chapters. No dependencies.

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
const chapterBtn = (label) => byClass(chapterRow(label), "chap-btn")[0];
function jurGroup(name) {
  return byClass($("chapters"), "jur-group")
    .find((g) => (byClass(g, "jur-name")[0] || {}).textContent === name);
}
const openEditor = (scope) => byClass(scope, "edit-form")[0];

/* ---------- the composer's organization layer ---------- */

const orgRow = (level, host = $("parts")) =>
  byClass(host, "org-row").find((r) => byClass(r, "org-name")[0].textContent === level);
const orgCheck = (level, host) => byClass(orgRow(level, host), "org-check")[0];
const orgValue = (level, host) => byClass(orgRow(level, host), "org-input")[0];
const orgTitle = (level, host) => byClass(orgRow(level, host), "org-input")[1];
const orgLevels = (host = $("parts")) => byClass(host, "org-name").map((e) => e.textContent);
const kindSelect = () => byClass($("parts"), "org-kind")[0];
const stateSelect = () => byClass($("parts"), "org-state")[0];

async function setKind(kind) {
  const sel = kindSelect();
  if (sel.value === kind) return;
  sel.value = kind;
  await dispatch(sel, "change");
}

async function pickState(key) {
  const sel = stateSelect();
  sel.value = key;
  await dispatch(sel, "change");
}

/* Turn a level on (if it is off) and give it its value and title. */
async function setLevel(level, value, title) {
  const box = orgCheck(level);
  if (!box.checked) { box.checked = true; await dispatch(box, "change"); }
  orgValue(level).value = value == null ? "" : value;
  if (title != null) orgTitle(level).value = title;
}

async function unsetLevel(level) {
  const box = orgCheck(level);
  if (!box.checked) return;
  box.checked = false;
  await dispatch(box, "change");
}

async function addSection(opts = {}) {
  if (opts.kind) await setKind(opts.kind);
  if (opts.state != null) await pickState(opts.state);
  for (const level of opts.off || []) await unsetLevel(level);
  for (const [level, spec] of Object.entries(opts.levels || {})) {
    if (Array.isArray(spec)) await setLevel(level, spec[0], spec[1]);
    else await setLevel(level, spec);
  }
  if (opts.paste != null) $("paste").value = opts.paste;
  await click("add");
}

const chapterOf = (number) => saved().chapters.find((c) => c.sections.some((s) => s.number === number));
const chapterAt = (level, value) =>
  saved().chapters.find((c) => (c.partValues || {})[level] === value);

/* ---------- boot ---------- */

test("boots with Federal plus every state and a required section number", () => {
  assert.match($("sections").textContent, /No chapters yet/);
  assert.match($("hint").textContent, /Only the section number is required/);

  // The composer is now the paste box, the jurisdiction picker and the
  // organization rows — no fields above them, no sample, no jurisdiction editor.
  assert.deepEqual(dom.ids.slice().sort(),
    ["add", "chapters", "clear", "hint", "parts", "paste", "sections", "toast", "xAll", "xOne"]);
  assert.throws(() => $("sample"), "the Load sample button is gone");
  assert.throws(() => $("addJurisdiction"), "jurisdictions are a closed list now");
  assert.throws(() => $("secNum"), "there is no section number field above the organization layer");

  assert.deepEqual(orgLevels(),
    ["Title", "Subtitle", "Division", "Chapter", "Subchapter", "Part", "Subpart", "Section", "Subsection"]);
  const section = orgCheck("Section");
  assert.equal(section.checked, false, "the Section row is not preselected");
  assert.ok(!section.disabled, "the Section row is an ordinary opt-in row");
  assert.equal(orgCheck("Title").checked, false, "the Title is no longer automatic");
  assert.ok(orgValue("Title").disabled, "an unchecked level takes no value");
  assert.ok(orgTitle("Title"), "every level has a title input next to its value");

  assert.equal(kindSelect().value, "federal");
  assert.deepEqual(options(kindSelect()).map((o) => o.textContent), ["Federal", "State"]);
  assert.equal(stateSelect().disabled, true, "a state is only needed for a state jurisdiction");

  assert.equal(jurNames().length, 51, "the sidebar is prepopulated");
  assert.equal(jurNames()[0], "Federal");
  assert.ok(jurNames().includes("Kentucky") && jurNames().includes("Wyoming"));
});

test("no jurisdiction can be renamed, re-kinded or added", () => {
  const group = jurGroup("Kentucky");
  const head = byClass(group, "jur-head")[0];
  assert.equal(byClass(head, "jur-name")[0].textContent, "Kentucky");
  assert.equal(byClass(head, "jur-tag")[0].textContent, "State");
  assert.equal(buttonNamed(head, "Edit"), undefined, "no rename control");
  assert.equal(byClass($("chapters"), "edit-form").length, 0);
});

/* ---------- validation ---------- */

test("adding needs a section number, a state where relevant, values and wording", async () => {
  $("paste").value = "(a) Every utility shall file.";
  await click("add");
  assert.match($("toast").textContent, /Enter the section number\./);

  await setLevel("Section", "1971");
  $("paste").value = "";
  await click("add");
  assert.match($("toast").textContent, /Paste the statute or regulation text first\./);

  $("paste").value = "(a) text";
  await setLevel("Chapter", "");
  await click("add");
  assert.match($("toast").textContent, /Enter a value for the Chapter\./);

  await setLevel("Chapter", "21!");
  await click("add");
  assert.match($("toast").textContent,
    /The Chapter can only use up to 12 letters, numbers, parentheses or hyphens\./);

  await setLevel("Chapter", "1234567890123");
  await click("add");
  assert.match($("toast").textContent, /The Chapter can only use up to 12/);

  await setKind("state");
  await setLevel("Chapter", "21");
  await click("add");
  assert.match($("toast").textContent, /Choose the state\./, "a state jurisdiction needs the state");

  await setKind("federal");
  assert.match($("sections").textContent, /No chapters yet/, "nothing is stored yet");
});

/* ---------- adding ---------- */

test("a section is filed under the levels that were checked", async () => {
  await addSection({
    levels: { Title: ["42", "Civil Rights"], Chapter: "21", Section: ["1971", "Filing"] },
    paste: "Every utility shall file."
  });

  assert.ok(clLabels().includes("Title 42 \u2014 Civil Rights \u00b7 Chapter 21"));
  assert.deepEqual(chapterAt("Title", "42").partValues, { Title: "42", Chapter: "21" });
  assert.deepEqual(chapterAt("Title", "42").partTitles, { Title: "Civil Rights" });
  assert.deepEqual(heads(), ["\u00a7 1971. Filing"]);
  assert.equal(chapterOf("1971").sections[0].body, "Every utility shall file.");
  assert.equal($("paste").value, "", "the paste is cleared for the next section");
  assert.equal(orgValue("Section").value, "", "so is the section's own row");
});

test("the organization stays put, so a run of sections shares a chapter", async () => {
  assert.equal(orgValue("Title").value, "42");
  assert.equal(orgValue("Chapter").value, "21");

  await addSection({ levels: { Section: ["1983", "Civil action"] }, paste: "(a) Every person shall be liable." });
  await addSection({ levels: { Section: "1985" }, paste: "(a) Another section." });

  assert.equal(chapterOf("1983").sections.length, 3, "the same path merges into one chapter");
  assert.deepEqual(chapterOf("1983").sections.map((s) => s.number), ["1971", "1983", "1985"]);
});

test("an extra organization level files the same names in a different area", async () => {
  await addSection({ levels: { Subchapter: "IV", Section: "1983" }, paste: "(a) text" });
  assert.equal(saved().chapters.length, 2);
  assert.ok(clLabels().includes("Title 42 \u2014 Civil Rights \u00b7 Chapter 21 \u00b7 Subchapter IV"));

  await unsetLevel("Subchapter");
  await addSection({ levels: { Section: ["1983", ""] }, paste: "(a) text" });
  assert.match($("toast").textContent, /Section 1983 is already in Title 42/);
});

test("a subsection makes 1983(a) and 1983(b) different sections", async () => {
  await addSection({ levels: { Section: ["1983", ""], Subsection: ["a", "First"] }, paste: "(a) text" });
  await addSection({ levels: { Section: ["1983", ""], Subsection: ["b", "Second"] }, paste: "(b) text" });

  const chapter = chapterOf("1983");
  assert.deepEqual(chapter.sections.filter((s) => s.subsection)
    .map((s) => s.number + "(" + s.subsection + ")"), ["1983(a)", "1983(b)"]);
  assert.ok(heads().includes("\u00a7 1983(a). First"));
  assert.ok(heads().includes("\u00a7 1983(b). Second"));
});

/* ---------- clause rendering ---------- */

test("a subclause is indented once per nesting level and keeps a space after its label", async () => {
  await unsetLevel("Subsection");
  await addSection({
    levels: { Section: ["2000", "Nesting"] },
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

test("a section's number, title and subsection can be edited after it was added", async () => {
  await clickNode(buttonNamed(sectByHead("\u00a7 2000. Nesting"), "Edit"));
  const form = openEditor($("sections"));
  const fields = inputs(form);
  assert.deepEqual(fields.map((f) => f.value), ["2000", "Nesting", "", ""]);

  fields[0].value = "1999";
  fields[1].value = "Renamed";
  fields[2].value = "ii";
  await clickNode(buttonNamed(form, "Save"));

  assert.ok(heads().includes("\u00a7 1999(ii). Renamed"), "the designation follows the subsection");
  assert.equal(openEditor($("sections")), undefined, "editor closes");
});

test("a section's number cannot be cleared", async () => {
  await clickNode(buttonNamed(sectByHead("\u00a7 1999(ii). Renamed"), "Edit"));
  let form = openEditor($("sections"));
  assert.equal(byClass(form, "edit-label")[0].textContent, "Section number *",
    "the editor marks the number required");

  inputs(form)[0].value = "";
  await clickNode(buttonNamed(form, "Save"));
  assert.match($("toast").textContent, /Enter a value for the Section\./);
  assert.ok(openEditor($("sections")), "the editor stays open so the number can be typed");

  form = openEditor($("sections"));
  inputs(form)[0].value = "1999";
  inputs(form)[2].value = "";
  await clickNode(buttonNamed(form, "Save"));
  assert.ok(heads().includes("\u00a7 1999. Renamed"));
});

test("editing a section onto an existing designation is refused", async () => {
  await clickNode(buttonNamed(sectByHead("\u00a7 1999. Renamed"), "Edit"));
  const form = openEditor($("sections"));
  inputs(form)[0].value = "1983";
  await clickNode(buttonNamed(form, "Save"));

  assert.match($("toast").textContent, /Section 1983 is already in Title 42/);
  const stillOpen = openEditor($("sections"));
  assert.ok(stillOpen, "editor stays open so the clash can be fixed");
  await clickNode(buttonNamed(stillOpen, "Cancel"));
});

test("a chapter's organizational levels can be edited after the fact", async () => {
  await clickNode(buttonNamed(chapterRow("Title 42 \u2014 Civil Rights \u00b7 Chapter 21"), "Edit"));
  const form = openEditor($("chapters"));
  const host = byClass(form, "org-tree")[0];
  assert.deepEqual(orgLevels(host),
    ["Title", "Subtitle", "Division", "Chapter", "Subchapter", "Part", "Subpart"],
    "Section and Subsection belong to a section, not the chapter");
  assert.equal(orgValue("Title", host).value, "42");
  assert.equal(orgCheck("Subchapter", host).checked, false);

  orgValue("Chapter", host).value = "1234567890123";
  await clickNode(buttonNamed(form, "Save"));
  assert.match($("toast").textContent, /The Chapter can only use up to 12/);
  assert.ok(openEditor($("chapters")), "the editor stays open so the value can be fixed");

  const reopen = openEditor($("chapters"));
  orgValue("Chapter", reopen).value = "21";
  orgValue("Title", reopen).value = "15";
  await clickNode(buttonNamed(reopen, "Save"));

  assert.ok(clLabels().includes("Title 15 \u2014 Civil Rights \u00b7 Chapter 21"));
  assert.equal(clLabels().includes("Title 42 \u2014 Civil Rights \u00b7 Chapter 21"), false,
    "the path moved, it was not copied");
});

test("editing a chapter onto an existing path is refused", async () => {
  await clickNode(buttonNamed(chapterRow("Title 42 \u2014 Civil Rights \u00b7 Chapter 21 \u00b7 Subchapter IV"), "Edit"));
  const form = openEditor($("chapters"));
  const host = byClass(form, "org-tree")[0];
  orgValue("Title", host).value = "15";
  const sub = orgCheck("Subchapter", host);
  sub.checked = false;
  await dispatch(sub, "change");
  await clickNode(buttonNamed(form, "Save"));

  assert.match($("toast").textContent, /That organization path already exists in this jurisdiction\./);
  const stillOpen = openEditor($("chapters"));
  assert.ok(stillOpen, "the editor stays open so the clash can be fixed");
  await clickNode(buttonNamed(stillOpen, "Cancel"));
  assert.ok(clLabels().includes("Title 42 \u2014 Civil Rights \u00b7 Chapter 21 \u00b7 Subchapter IV"));
});

/* ---------- states ---------- */

test("a state files under whatever levels it has — no Title required", async () => {
  await addSection({
    kind: "state", state: "kentucky",
    off: ["Title", "Subchapter"],
    levels: { Chapter: ["7", "Public Utilities"], Section: ["7-1", "Application"] },
    paste: "This chapter applies to every public utility."
  });

  assert.equal(chapterOf("7-1").jurisdiction, "kentucky");
  assert.ok(clLabels().includes("Chapter 7 \u2014 Public Utilities"));
  assert.equal(chapterAt("Chapter", "7").partValues.Title, undefined, "no Title for a state");

  // A Title is still available if a state happens to use one.
  await addSection({ off: ["Chapter"], levels: { Title: "12", Section: "12-1" }, paste: "A tax is imposed." });
  assert.equal(chapterAt("Title", "12").jurisdiction, "kentucky");

  await setKind("federal");
});

/* ---------- export ---------- */

test("export chapter: standalone, styled and free of editing chrome", async () => {
  await clickNode(chapterBtn("Chapter 7 \u2014 Public Utilities"));
  await click("xOne");
  assert.equal(dom.downloads.at(-1).download, "kentucky-7.html");

  const html = dom.exportedHtml();
  assert.match(html, /^<!doctype html>/);
  assert.ok(html.includes("<title>Chapter 7 \u2014 Public Utilities</title>"), "titles the page by its path");
  assert.ok(html.includes(":root{ --bg:#efece6;"), "inlines styles/doc.css");
  assert.ok(html.includes('<div class="doc"><div class="page">'));
  assert.ok(html.includes('<h3 class="chapter-head">Chapter 7 \u2014 Public Utilities</h3>'));
  assert.ok(html.includes("Kentucky \u00b7 1 section"), "names the jurisdiction");
  assert.ok(!html.includes("<script") && !html.includes("<link"), "self-contained: no external refs");
  assert.ok(!html.includes("edit-form") && !html.includes("org-tree"), "no editor markup leaks into the export");
  assert.ok(!html.includes(">Edit</button>"), "no edit buttons leak into the export");
});

test("export all writes one file per chapter, named by jurisdiction and path", async () => {
  const before = dom.downloads.length;
  await click("xAll");
  assert.deepEqual(dom.downloads.slice(before).map((d) => d.download).sort(),
    ["federal-15-21.html", "federal-42-21-IV.html", "kentucky-12.html", "kentucky-7.html"]);
});

/* ---------- persistence ---------- */

test("persisted state keeps raw bodies and the seeded jurisdictions", () => {
  assert.equal(saved().jurisdictions.length, 51);
  assert.ok(saved().chapters.every((c) => c.sections.every((s) => !s.body.includes("<mark"))),
    "bodies stay raw");
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
  await addSection({
    levels: { Title: "9", Chapter: "1", Section: "9-1" },
    paste: "The authority shall review each application within 60 days\n" +
      "of receipt of a complete filing. It shall then\n" +
      "issue a decision.\n\n" +
      "(a) The board shall act.\n" +
      "    (1) Records shall be kept."
  });

  assert.equal(chapterAt("Title", "9").sections[0].body,
    "The authority shall review each application within 60 days of receipt of a complete filing. " +
    "It shall then issue a decision.\n\n" +
    "(a) The board shall act.\n" +
    "    (1) Records shall be kept.",
    "prose wraps joined, paragraph break and indented item kept");
});

/* ---------- definitions ---------- */

test("definitions highlight across a chapter, in order independent of insertion", async () => {
  await addSection({
    levels: { Section: ["1101", "Definitions"] },
    paste: "\u201CAuthority\u201D means the board.\n\u201CFee\u201D means a charge set by the Authority."
  });
  await addSection({
    levels: { Section: ["1102", "Application"] },
    paste: "The Fee applies to every utility, and the Authority shall collect it."
  });

  // The defining section does not highlight its own definitions, except inside
  // a different definition.
  assert.deepEqual(marksIn(sectByHead("\u00a7 1101. Definitions")), ["Authority"]);
  const application = marksIn(sectByHead("\u00a7 1102. Application"));
  assert.ok(application.includes("Fee") && application.includes("Authority"));
});
