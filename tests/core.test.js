/* Tests for the pure core/. Run with: node --test tests/core.test.js
   No dependencies — Node's built-in test runner only. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { naturalKey, naturalCmp } from "../src/core/sort.js";
import { normalizeBody } from "../src/core/text.js";
import {
  buildTermRegex, chapterDefinitions, definitionUnits, highlightRuns, sectionTerms, termSuppressor
} from "../src/core/definitions.js";
import { analyzeBody } from "../src/core/nesting.js";
import {
  ANCHOR, UNKNOWN, addJurisdiction, addSection, chapterNumber, chaptersInOrder, currentChapter,
  emptyState, findJurisdiction, normalizeParts, partPath, sortedJurisdictions, updateChapter,
  updateJurisdiction, updateSection
} from "../src/core/model.js";

/* ---------- sorting ---------- */

test("natural ordering: 7-1 < 7-2 < 7-10", () => {
  const sorted = ["7-10", "7-2", "7-1"].slice().sort(naturalCmp);
  assert.deepEqual(sorted, ["7-1", "7-2", "7-10"]);
  assert.ok(naturalCmp("7-2", "7-10") < 0);
  assert.ok(naturalCmp("2", "10") < 0);
  assert.ok(naturalCmp("Chapter 7", "Chapter 12") < 0);
  assert.equal(naturalCmp("7-1", "7-1"), 0);
  assert.deepEqual(naturalKey("7-10"), ["000000000007", "-", "000000000010"]);
});

/* ---------- text cleanup ---------- */

test("normalizeBody fixes newlines, hard spaces and stray whitespace", () => {
  const messy = "(a)  Every   public utility shall file.\r\n\r\n\r\n    (1) A filing must state.\t \r\n\u00A0(b) Done.";
  assert.equal(normalizeBody(messy),
    "(a) Every public utility shall file.\n\n    (1) A filing must state.\n (b) Done.");
});

test("normalizeBody keeps indentation so clause nesting still works", () => {
  assert.equal(normalizeBody("(a) parent\n\t(1) child"), "(a) parent\n    (1) child");
});

test("normalizeBody trims the paste and never joins lines", () => {
  assert.equal(normalizeBody("  \n\n  (a) one\n\n\n\n(b) two  \n\n  "), "(a) one\n\n(b) two");
});

/* ---------- soft line wraps ---------- */

test("soft line wraps inside prose are joined with a space", () => {
  assert.equal(
    normalizeBody("The authority shall review each application\nwithin 60 days of receipt\nof a complete filing."),
    "The authority shall review each application within 60 days of receipt of a complete filing.");
});

test("blank lines stay as paragraph breaks", () => {
  assert.equal(normalizeBody("First line\nwraps here.\n\nSecond paragraph\nwraps too."),
    "First line wraps here.\n\nSecond paragraph wraps too.");
});

test("a line that ends a sentence or a lead-in keeps its own line", () => {
  assert.equal(normalizeBody("Every definition ends here.\nA charge is a fee."),
    "Every definition ends here.\nA charge is a fee.");
  assert.equal(normalizeBody("As used in this chapter:\nA charge is a fee."),
    "As used in this chapter:\nA charge is a fee.");
});

test("a line opening a quotation starts a new definition entry", () => {
  const input = "As used in this chapter\n\u201CBoard\u201D means the commission.";
  assert.equal(normalizeBody(input), input);
});

test("headings, numbering and bullets keep their own lines", () => {
  const input = [
    "DEFINITIONS",
    "As used in this chapter:",
    "(a) The authority shall act",
    "(1) and shall keep records",
    "\u2022 a bullet",
    "- another bullet",
    "ARTICLE 5",
    "The board shall act."
  ].join("\n");
  assert.equal(normalizeBody(input), input);
});

test("indented structure is preserved, a hanging indent is joined", () => {
  const structured = "This chapter applies.\n    (1) A filing must state the net income.";
  assert.equal(normalizeBody(structured), structured);
  assert.equal(normalizeBody("(a) The authority shall act\n    Records shall be kept."),
    "(a) The authority shall act\n    Records shall be kept.");
  assert.equal(normalizeBody("(a) The authority shall act\n    on each application."),
    "(a) The authority shall act on each application.");
});

test("a word split by a wrapped hyphen is rejoined", () => {
  assert.equal(normalizeBody("The establish-\nment of the board."), "The establishment of the board.");
  assert.equal(normalizeBody("Any regula-\ntion adopted under this chapter"), "Any regulation adopted under this chapter");
});

test("a real compound hyphen is kept", () => {
  assert.equal(normalizeBody("a well-\nknown rule."), "a well-known rule.");
  assert.equal(normalizeBody("a state-\nowned bank."), "a state-owned bank.");
});

test("an invisible soft hyphen is removed", () => {
  assert.equal(normalizeBody("estab\u00ADlishment of the board"), "establishment of the board");
  assert.equal(normalizeBody("estab\u00AD\nlishment"), "establishment");
});

test("normalization never rewrites wording, punctuation or citations", () => {
  assert.equal(normalizeBody("See KRS 217.136  and  217.137;  42 U.S.C. \u00A7 1983."),
    "See KRS 217.136 and 217.137; 42 U.S.C. \u00A7 1983.");
});

test("normalization is stable when applied twice", () => {
  const messy = "The authority shall review each application\nwithin 60 days.\n\n(a) The board\n    shall act.";
  const once = normalizeBody(messy);
  assert.equal(normalizeBody(once), once);
});

/* ---------- definitions ---------- */

test("a definition may define several quoted terms at once", () => {
  const units = definitionUnits('"Bread" and "enriched bread" mean only the foods commonly known as white bread.');
  assert.equal(units.length, 1);
  assert.deepEqual(units[0].terms, ["Bread", "enriched bread"]);
});

test("a later clause can define the same term again", () => {
  const body = 'For the purposes of KRS 217.136 and 217.137, "bread" or "enriched bread" also means breads that may include fruit.';
  const units = definitionUnits(body);
  assert.equal(units.length, 1);
  assert.deepEqual(units[0].terms, ["bread", "enriched bread"]);
});

test("only quoted phrases before the definitional verb are terms", () => {
  const units = definitionUnits('"Bread" means the foods labelled "enriched".');
  assert.deepEqual(units.map((u) => u.terms), [["Bread"]]);
});

test("a lone apostrophe is not treated as a quote", () => {
  assert.deepEqual(definitionUnits("The director's duty means the board's duty."), []);
});

test("curly and straight quotes both work", () => {
  assert.deepEqual(definitionUnits("\u201CFee\u201D means a charge.").map((u) => u.terms), [["Fee"]]);
  assert.deepEqual(definitionUnits('"Fee" means a charge.').map((u) => u.terms), [["Fee"]]);
});

test("term matching is case-insensitive but still whole-word", () => {
  assert.ok("white bread".match(buildTermRegex(["Bread"])));
  assert.ok("Bread".match(buildTermRegex(["bread"])));
  assert.equal("breadth".match(buildTermRegex(["Bread"])), null);
  assert.equal("breads".match(buildTermRegex(["bread"])), null);
});

test("a section does not highlight a term it defines, but does inside other definitions", () => {
  const body = "\u201CAuthority\u201D means the board.\n\u201CFee\u201D means a charge set by the Authority.";
  const units = definitionUnits(body);
  assert.equal(units.length, 2);
  assert.deepEqual(units[0].terms, ["Authority"]);
  assert.deepEqual(units[1].terms, ["Fee"]);

  const suppressed = termSuppressor(units);
  assert.equal(suppressed("Authority", body.indexOf("Authority")), false, "its own definition is not highlighted");
  assert.equal(suppressed("Authority", body.lastIndexOf("Authority")), true, "a different definition is highlighted");
  assert.equal(suppressed("Fee", body.indexOf("Fee")), false);
  assert.equal(suppressed("Elsewhere", 0), true, "terms this section does not define highlight normally");
});

test("a section that defines nothing highlights everything", () => {
  const suppressed = termSuppressor([]);
  assert.equal(suppressed("Authority", 0), true);
});

test("highlightRuns splits text into plain and marked runs", () => {
  assert.deepEqual(highlightRuns("The authority acts.", ["Authority"], () => true),
    [{ text: "The " }, { mark: "authority" }, { text: " acts." }]);
  assert.deepEqual(highlightRuns("The authority acts.", ["Authority"], () => false),
    [{ text: "The authority acts." }]);
  assert.deepEqual(highlightRuns("nothing here", [], () => true), [{ text: "nothing here" }]);
});

test("chapter definitions are chapter-wide and order independent", () => {
  const defs = { number: "7-2", title: "Definitions", body: '"Fee" means a charge.' };
  const plain = { number: "7-1", title: "Application", body: "The Fee applies to every utility." };
  const forward = chapterDefinitions({ key: "7", sections: [plain, defs] });
  const backward = chapterDefinitions({ key: "7", sections: [defs, plain] });
  assert.deepEqual(forward, backward);
  assert.deepEqual(forward, ["Fee"]);
  assert.deepEqual(sectionTerms(plain), []);
});

/* ---------- clause nesting ---------- */

test("clause depth follows real indentation when present", () => {
  const body = [
    "This chapter applies to every public utility.",
    "(a) The authority shall review each application.",
    "    (1) The authority may request additional information.",
    "    (2) A decision must issue within the period stated.",
    "(b) An applicant may appeal a denial."
  ].join("\n");

  const clauses = analyzeBody(body).filter((i) => i.type === "clause");
  assert.deepEqual(clauses.map((c) => c.depth), [0, 0, 1, 1, 0]);
  assert.deepEqual(clauses.map((c) => c.marker), [null, "(a)", "(1)", "(2)", "(b)"]);
  assert.equal(clauses[1].text, "The authority shall review each application.");
  assert.ok(!clauses[2].text.includes("(1)"), "marker is sliced off the body, not repeated");
});

test("clause depth falls back to marker inference without indentation", () => {
  const body = "(a) Every utility shall file.\n(1) A filing must state the net income.\n(2) The authority shall accept it.";
  const clauses = analyzeBody(body).filter((i) => i.type === "clause");
  assert.deepEqual(clauses.map((c) => c.depth), [1, 2, 2]);
  assert.deepEqual(clauses.map((c) => c.marker), ["(a)", "(1)", "(2)"]);
});

test("blank lines survive as their own items", () => {
  assert.deepEqual(analyzeBody("first\n\nsecond").map((i) => i.type), ["clause", "blank", "clause"]);
});

test("each clause reports where its text starts in the body", () => {
  const body = "Line one.\n    (a) indented clause.";
  for (const item of analyzeBody(body)) {
    if (item.type !== "clause") continue;
    assert.equal(body.slice(item.start, item.start + item.text.length), item.text,
      "start must point at the clause text inside the stored body");
  }
});

/* ---------- jurisdictions ---------- */

const addFed = (state, parts, number, extra = {}) => addSection(state, {
  jurisdiction: "federal", partValues: parts, number, body: "b", ...extra
});

test("emptyState seeds a single Federal jurisdiction with an ordered organization", () => {
  const state = emptyState();
  assert.deepEqual(state.chapters, []);
  assert.deepEqual(
    state.jurisdictions.map((j) => [j.key, j.kind, j.parts]),
    [["federal", "federal", ["Title", "Chapter", "Subchapter", "Part"]]]);
});

test("normalizeParts trims, de-duplicates case-insensitively and keeps the Chapter anchor", () => {
  assert.deepEqual(normalizeParts(["Title", " Chapter ", "title", ""]), ["Title", "Chapter"]);
  assert.deepEqual(normalizeParts(["Subchapter"]), ["Subchapter", "Chapter"], "Chapter is appended when missing");
  assert.deepEqual(normalizeParts([]), ["Chapter"]);
});

test("addJurisdiction slugifies the name, refuses duplicates and keeps the key stable", () => {
  const state = emptyState();
  assert.equal(addJurisdiction(state, { name: "Kentucky", kind: "state", parts: [] }).status, "ok");
  assert.deepEqual(findJurisdiction(state, "kentucky").parts, ["Chapter"]);
  assert.equal(addJurisdiction(state, { name: "Kentucky", kind: "state" }).status, "duplicate");
  assert.equal(addJurisdiction(state, { name: "   ", kind: "state" }).status, "invalid");
});

test("updateJurisdiction reorders parts and keeps the key while the name changes", () => {
  const state = emptyState();
  const result = updateJurisdiction(state, "federal", {
    name: "United States", kind: "federal", parts: ["Part", "Subchapter", "Chapter", "Title"]
  });
  assert.equal(result.status, "ok");
  const j = findJurisdiction(state, "federal");
  assert.equal(j.name, "United States");
  assert.deepEqual(j.parts, ["Part", "Subchapter", "Chapter", "Title"]);
  assert.equal(updateJurisdiction(state, "federal", { name: "", kind: "federal" }).status, "invalid");
  assert.equal(updateJurisdiction(state, "nope", { name: "x" }).status, "missing");
});

test("jurisdictions list Federal first, then states alphabetically", () => {
  const state = emptyState();
  addJurisdiction(state, { name: "Wyoming", kind: "state" });
  addJurisdiction(state, { name: "Alabama", kind: "state" });
  assert.deepEqual(sortedJurisdictions(state).map((j) => j.name), ["Federal", "Alabama", "Wyoming"]);
});

/* ---------- state mutations ---------- */

test("addSection needs only the chapter and section number", () => {
  const state = emptyState();
  assert.equal(addFed(state, { Chapter: "" }, "1").status, "invalid");
  assert.equal(addFed(state, { Chapter: "7" }, "").status, "invalid");
  assert.equal(state.chapters.length, 0);
});

test("blank chapter and section titles default to UNKNOWN", () => {
  const state = emptyState();
  const r = addFed(state, { Chapter: "7" }, "7-1", { chapterTitle: "  ", title: "" });
  assert.equal(r.status, "added");
  assert.equal(r.chapter.title, UNKNOWN);
  assert.equal(r.chapter.sections[0].title, UNKNOWN);
  assert.equal(chapterNumber(r.chapter), "7");
  assert.equal(state.activeId, r.chapter.id);
});

test("addSection sorts on add, backfills the chapter title and rejects duplicates", () => {
  const state = emptyState();
  addFed(state, { Chapter: "7" }, "7-10", { chapterTitle: "Public Utilities", title: "Ten" });
  addFed(state, { Chapter: "7" }, "7-2", { title: "Two" });

  assert.equal(state.chapters.length, 1);
  assert.deepEqual(state.chapters[0].sections.map((s) => s.number), ["7-2", "7-10"]);
  assert.equal(state.chapters[0].title, "Public Utilities");

  const dup = addFed(state, { Chapter: "7" }, "7-2", { title: "Dup" });
  assert.equal(dup.status, "duplicate");
  assert.equal(state.chapters[0].sections.length, 2);
});

test("federal chapters with different organization paths stay distinct and merge by path", () => {
  const state = emptyState();
  addFed(state, { Title: "42", Chapter: "21", Subchapter: "IV" }, "1983");
  addFed(state, { Title: "42", Chapter: "21", Subchapter: "I" }, "1983");
  assert.equal(state.chapters.length, 2, "same chapter number under different paths is a different chapter");

  addFed(state, { Title: "42", Chapter: "21", Subchapter: "IV" }, "1985");
  assert.equal(state.chapters.length, 2, "the matching path merges");

  const j = findJurisdiction(state, "federal");
  assert.deepEqual(chaptersInOrder(state, "federal").map((c) => partPath(j, c.partValues)), [
    "Title 42 \u00b7 Chapter 21 \u00b7 Subchapter I",
    "Title 42 \u00b7 Chapter 21 \u00b7 Subchapter IV"
  ]);
});

test("updateChapter edits the organization and title, refusing a blank number or a collision", () => {
  const state = emptyState();
  addFed(state, { Chapter: "7" }, "7-1");
  const id = state.chapters[0].id;

  assert.equal(updateChapter(state, id, { partValues: { Chapter: "7A" }, title: "Utilities" }).status, "ok");
  assert.equal(chapterNumber(state.chapters[0]), "7A");
  assert.equal(state.chapters[0].title, "Utilities");
  assert.equal(updateChapter(state, id, { partValues: { Chapter: "  " }, title: "x" }).status, "invalid");
  assert.equal(updateChapter(state, id, { partValues: { Chapter: "7A" }, title: "" }).status, "ok");
  assert.equal(state.chapters[0].title, UNKNOWN, "a blank title falls back to UNKNOWN");

  addFed(state, { Chapter: "12" }, "12-1");
  const other = state.chapters.find((c) => chapterNumber(c) === "12").id;
  assert.equal(updateChapter(state, other, { partValues: { Chapter: "7A" }, title: "clash" }).status, "duplicate");
  assert.equal(updateChapter(state, "missing-id", { partValues: { Chapter: "1" }, title: "" }).status, "missing");
});

test("updateSection edits the number and title and re-sorts the chapter", () => {
  const state = emptyState();
  addFed(state, { Chapter: "7" }, "7-10", { title: "Ten" });
  addFed(state, { Chapter: "7" }, "7-1", { title: "One" });

  const id = state.chapters[0].sections.find((s) => s.number === "7-10").id;
  assert.equal(updateSection(state, id, { number: "7-2", title: "Two" }).status, "ok");
  assert.deepEqual(state.chapters[0].sections.map((s) => s.number), ["7-1", "7-2"]);
  assert.equal(state.chapters[0].sections[1].title, "Two");
});

test("updateSection rejects an empty number or a duplicate", () => {
  const state = emptyState();
  addFed(state, { Chapter: "7" }, "7-1");
  addFed(state, { Chapter: "7" }, "7-2");

  const id = state.chapters[0].sections.find((s) => s.number === "7-2").id;
  assert.equal(updateSection(state, id, { number: "7-1", title: "clash" }).status, "duplicate");
  assert.equal(updateSection(state, id, { number: "  ", title: "" }).status, "invalid");
  assert.deepEqual(state.chapters[0].sections.map((s) => s.number), ["7-1", "7-2"]);
});

test("currentChapter follows activeId then falls back to the first chapter", () => {
  const state = emptyState();
  addFed(state, { Chapter: "7" }, "7-1");
  addFed(state, { Chapter: "12" }, "12-1");
  const seven = state.chapters.find((c) => chapterNumber(c) === "7");

  state.activeId = seven.id;
  assert.equal(chapterNumber(currentChapter(state)), "7");
  state.activeId = "gone";
  assert.equal(chapterNumber(currentChapter(state)), "7");
  assert.equal(currentChapter(emptyState()), null);
});
