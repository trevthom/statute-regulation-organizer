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
import { migrate } from "../src/storage/local.js";
import {
  ORG_LEVELS, STATES, UNKNOWN, addJurisdiction, addSection, anchorOf, chapterNumber,
  chapterSignature, chaptersInOrder, compareSections, currentChapter, emptyState,
  findJurisdiction, isValidCode, isValidTitle, makeJurisdiction, orgLevel, partPath,
  partValuesOf, sampleData, seedJurisdictions, sortedJurisdictions, updateChapter,
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

const clausesOf = (body) => analyzeBody(body).filter((i) => i.type === "clause");

test("clause depth follows real indentation when present", () => {
  const body = [
    "This chapter applies to every public utility.",
    "(a) The authority shall review each application.",
    "    (1) The authority may request additional information.",
    "        (i) A request must be in writing.",
    "    (2) A decision must issue within the period stated.",
    "(b) An applicant may appeal a denial."
  ].join("\n");

  const clauses = clausesOf(body);
  assert.deepEqual(clauses.map((c) => c.depth), [0, 0, 1, 2, 1, 0],
    "one step of indentation per nesting level");
  assert.deepEqual(clauses.map((c) => c.marker), [null, "(a)", "(1)", "(i)", "(2)", "(b)"]);
  assert.equal(clauses[1].text, "The authority shall review each application.");
  assert.ok(!clauses[2].text.includes("(1)"), "marker is sliced off the body, not repeated");
});

test("without indentation the depth comes from the markers, starting at the outermost", () => {
  const body = "(a) Every utility shall file.\n(1) A filing must state the net income.\n(i) The filing is sworn.\n(2) The authority shall accept it.\n(b) An appeal lies.";
  const clauses = clausesOf(body);
  assert.deepEqual(clauses.map((c) => c.depth), [0, 1, 2, 1, 0],
    "a clause under the prose is not indented, its subclause is indented once");
  assert.deepEqual(clauses.map((c) => c.marker), ["(a)", "(1)", "(i)", "(2)", "(b)"]);
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

const FEDERAL_VALUES = { Title: "42" };

function addIn(state, jurisdiction, partValues, number, extra = {}) {
  return addSection(state, {
    jurisdiction,
    partValues,
    checked: extra.checked || Object.keys(partValues),
    number,
    body: "b",
    ...extra
  });
}

test("the organization hierarchy is fixed and outermost level first", () => {
  assert.deepEqual(ORG_LEVELS, ["Title", "Subtitle", "Division", "Chapter", "Subchapter",
    "Part", "Subpart", "Section", "Subsection"]);
});

test("emptyState seeds Federal and every state, each with no chapters", () => {
  const state = emptyState();
  assert.deepEqual(state.chapters, []);
  assert.equal(state.activeId, null);

  const federal = state.jurisdictions.filter((j) => j.kind === "federal");
  const states = state.jurisdictions.filter((j) => j.kind === "state");
  assert.deepEqual(federal.map((j) => j.name), ["Federal"]);
  assert.deepEqual(states.map((j) => j.name), STATES);
  assert.equal(states.length, 50);
  assert.equal(new Set(state.jurisdictions.map((j) => j.key)).size, 51, "keys are unique");
  assert.ok(state.jurisdictions.every((j) => !("parts" in j) && !("dividers" in j)));
});

test("anchorOf is Title for federal, Chapter for a state", () => {
  assert.equal(anchorOf({ kind: "federal" }), "Title");
  assert.equal(anchorOf({ kind: "state" }), "Chapter");
  assert.equal(anchorOf(null), "Chapter");
});

test("orgLevel canonicalizes a level name and rejects anything else", () => {
  assert.equal(orgLevel(" subchapter "), "Subchapter");
  assert.equal(orgLevel("Subpart"), "Subpart");
  assert.equal(orgLevel("Paragraph"), null);
  assert.equal(orgLevel(""), null);
});

test("isValidTitle accepts only whole numbers from 1 to 50", () => {
  assert.ok(isValidTitle("1") && isValidTitle(50) && isValidTitle(" 42 "));
  assert.ok(!isValidTitle("0") && !isValidTitle("51") && !isValidTitle("4A"));
  assert.ok(!isValidTitle("") && !isValidTitle("1.5"));
});

test("isValidCode accepts one or two letters or digits", () => {
  assert.ok(isValidCode("A") && isValidCode("21") && isValidCode("iv") && isValidCode(" 7 "));
  assert.ok(!isValidCode("") && !isValidCode("ABC") && !isValidCode("2A3") && !isValidCode("2-1"));
});

test("seedJurisdictions tops the list up and keeps what is already there", () => {
  const out = seedJurisdictions([{ key: "kentucky", name: "Kentucky", kind: "state", parts: ["Chapter"] }]);
  assert.equal(out.length, 51);
  assert.equal(out.find((j) => j.key === "kentucky").name, "Kentucky");
  assert.ok(!("parts" in out.find((j) => j.key === "kentucky")));
});

test("jurisdictions list Federal first, then states alphabetically", () => {
  const state = emptyState();
  const names = sortedJurisdictions(state).map((j) => j.name);
  assert.equal(names[0], "Federal");
  assert.deepEqual(names.slice(1), STATES);
});

test("partValuesOf keeps the hierarchy's levels that have a value", () => {
  assert.deepEqual(
    partValuesOf(makeJurisdiction({ name: "Federal", kind: "federal" }),
      { Title: " 42 ", Chapter: "21", Subchapter: "", Paragraph: "X" }),
    { Title: "42", Chapter: "21" });
});

test("a chapter's path and signature follow the hierarchy order", () => {
  const j = makeJurisdiction({ name: "Federal", kind: "federal" });
  assert.equal(partPath(j, { Subchapter: "IV", Chapter: "21", Title: "42" }),
    "Title 42 \u00b7 Chapter 21 \u00b7 Subchapter IV");
  assert.equal(partPath(j, { Title: "42" }), "Title 42");
  assert.equal(partPath(j, {}), "");
  assert.equal(chapterSignature(j, { Chapter: "21", Title: "42" }), "title=42|chapter=21");
});

/* ---------- sections ---------- */

test("addSection needs the anchor: a federal Title from 1 to 50", () => {
  const state = emptyState();
  assert.equal(addIn(state, "federal", { Title: "" }, "1983").status, "invalid");
  assert.equal(addIn(state, "federal", { Title: "42" }, "1983").status, "added");

  const outOfRange = addIn(state, "federal", { Title: "51" }, "1985");
  assert.equal(outOfRange.status, "invalid");
  assert.equal(outOfRange.field, "anchor");
  assert.equal(outOfRange.reason, "range");
  assert.equal(addIn(state, "federal", { Title: "4A" }, "1985").reason, "range");
  assert.equal(state.chapters.length, 1);
});

test("a checked level must carry a 1-2 character code", () => {
  const state = emptyState();
  const missing = addIn(state, "federal", { Title: "42", Chapter: "" }, "1983", { checked: ["Title", "Chapter"] });
  assert.equal(missing.status, "invalid");
  assert.equal(missing.field, "level");
  assert.deepEqual([missing.level, missing.reason], ["Chapter", "missing"]);

  const tooLong = addIn(state, "federal", { Title: "42", Chapter: "217" }, "1983", { checked: ["Title", "Chapter"] });
  assert.deepEqual([tooLong.level, tooLong.reason], ["Chapter", "format"]);

  assert.equal(state.chapters.length, 0, "nothing is stored until the path is valid");
});

test("the section number is required", () => {
  const state = emptyState();
  const blank = addIn(state, "federal", FEDERAL_VALUES, "");
  assert.equal(blank.status, "invalid");
  assert.equal(blank.field, "number");
  assert.equal(addIn(state, "federal", FEDERAL_VALUES, "   ").status, "invalid");
  assert.equal(state.chapters.length, 0, "nothing is stored without a number");

  addIn(state, "federal", FEDERAL_VALUES, "1990");
  addIn(state, "federal", FEDERAL_VALUES, "1983");
  assert.deepEqual(state.chapters[0].sections.map((s) => s.number), ["1983", "1990"]);
});

test("blank chapter and section titles default to UNKNOWN", () => {
  const state = emptyState();
  const r = addIn(state, "federal", FEDERAL_VALUES, "1983", { chapterTitle: "  ", title: "" });
  assert.equal(r.status, "added");
  assert.equal(r.chapter.title, UNKNOWN);
  assert.equal(r.chapter.sections[0].title, UNKNOWN);
  assert.equal(chapterNumber(r.chapter), "42");
  assert.equal(state.activeId, r.chapter.id);
});

test("addSection sorts on add, backfills the chapter title and rejects duplicates", () => {
  const state = emptyState();
  addIn(state, "federal", FEDERAL_VALUES, "1990", { chapterTitle: "Civil Rights", title: "Ten" });
  addIn(state, "federal", FEDERAL_VALUES, "1983", { title: "Two" });

  assert.equal(state.chapters.length, 1);
  assert.deepEqual(state.chapters[0].sections.map((s) => s.number), ["1983", "1990"]);
  assert.equal(state.chapters[0].title, "Civil Rights");

  const dup = addIn(state, "federal", FEDERAL_VALUES, "1983", { title: "Dup" });
  assert.equal(dup.status, "duplicate");
  assert.equal(state.chapters[0].sections.length, 2);
});

test("chapters with different organization paths stay distinct and merge by path", () => {
  const state = emptyState();
  addIn(state, "federal", { Title: "42", Chapter: "21", Subchapter: "IV" }, "1983");
  addIn(state, "federal", { Title: "42", Chapter: "21", Subchapter: "I" }, "1983");
  assert.equal(state.chapters.length, 2,
    "the same section number under a different path is a different chapter");

  addIn(state, "federal", { Title: "42", Chapter: "21", Subchapter: "IV" }, "1985");
  assert.equal(state.chapters.length, 2, "the matching path merges");

  const j = findJurisdiction(state, "federal");
  assert.deepEqual(chaptersInOrder(state, "federal").map((c) => partPath(j, c.partValues)), [
    "Title 42 \u00b7 Chapter 21 \u00b7 Subchapter I",
    "Title 42 \u00b7 Chapter 21 \u00b7 Subchapter IV"
  ]);
});

test("a state jurisdiction anchors on Chapter", () => {
  const state = emptyState();
  assert.equal(addIn(state, "kentucky", { Chapter: "7" }, "7-1").status, "added");
  assert.equal(addIn(state, "kentucky", { Chapter: "" }, "7-2").status, "invalid");
  assert.equal(addIn(state, "kentucky", { Chapter: "7" }, "7-2").status, "added");

  const ky = findJurisdiction(state, "kentucky");
  assert.equal(addIn(state, "kentucky", { Chapter: "7", Subchapter: "abc" }, "7-3",
    { checked: ["Chapter", "Subchapter"] }).status, "invalid");
  assert.equal(addIn(state, "kentucky", { Chapter: "7", Title: "12" }, "7-3").status, "added",
    "a state may still file under a Title, which is optional there");
  assert.equal(chapterNumber(state.chapters[0]), "7");
  assert.equal(partPath(ky, state.chapters[0].partValues), "Chapter 7");
  assert.deepEqual(state.chapters.map((c) => chapterSignature(ky, c.partValues)),
    ["chapter=7", "title=12|chapter=7"]);
});

test("compareSections keeps numbered sections natural, a blank number (legacy data) last", () => {
  const list = [{ number: "7-10" }, { number: "" }, { number: "7-2" }].sort(compareSections);
  assert.deepEqual(list.map((s) => s.number), ["7-2", "7-10", ""]);
});

test("updateChapter edits the organization and title, refusing a bad path", () => {
  const state = emptyState();
  addIn(state, "federal", FEDERAL_VALUES, "1983");
  const id = state.chapters[0].id;

  const ok = updateChapter(state, id, {
    partValues: { Title: "15", Chapter: "21" }, checked: ["Title", "Chapter"], title: "Rights"
  });
  assert.equal(ok.status, "ok");
  assert.equal(chapterNumber(state.chapters[0]), "15");
  assert.equal(state.chapters[0].title, "Rights");

  assert.equal(updateChapter(state, id, { partValues: { Title: "  " }, checked: ["Title"], title: "x" }).status, "invalid");
  assert.equal(updateChapter(state, id, { partValues: { Title: "99" }, checked: ["Title"], title: "x" }).reason, "range");
  assert.equal(updateChapter(state, id, {
    partValues: { Title: "15", Chapter: "217" }, checked: ["Title", "Chapter"], title: "x"
  }).reason, "format");
  assert.equal(updateChapter(state, id, {
    partValues: { Title: "15", Chapter: "" }, checked: ["Title", "Chapter"], title: "x"
  }).reason, "missing");

  assert.equal(updateChapter(state, id, { partValues: { Title: "15" }, checked: ["Title"], title: "" }).status, "ok");
  assert.equal(state.chapters[0].title, UNKNOWN, "a blank title falls back to UNKNOWN");

  addIn(state, "federal", { Title: "12" }, "1201");
  const other = state.chapters.find((c) => chapterNumber(c) === "12").id;
  assert.equal(updateChapter(state, other, { partValues: { Title: "15" }, checked: ["Title"], title: "clash" }).status,
    "duplicate");
  assert.equal(updateChapter(state, "missing-id", { partValues: { Title: "1" }, checked: ["Title"], title: "" }).status,
    "missing");
});

test("updateSection edits the number and title and re-sorts the chapter", () => {
  const state = emptyState();
  addIn(state, "federal", FEDERAL_VALUES, "1990", { title: "Ten" });
  addIn(state, "federal", FEDERAL_VALUES, "1983", { title: "One" });

  const id = state.chapters[0].sections.find((s) => s.number === "1990").id;
  assert.equal(updateSection(state, id, { number: "1984", title: "Two" }).status, "ok");
  assert.deepEqual(state.chapters[0].sections.map((s) => s.number), ["1983", "1984"]);
  assert.equal(state.chapters[0].sections[1].title, "Two");

  const blank = updateSection(state, id, { number: "  ", title: "Three" });
  assert.equal(blank.status, "invalid");
  assert.equal(blank.field, "number");
  assert.deepEqual(state.chapters[0].sections.map((s) => s.number), ["1983", "1984"],
    "a blank number is refused and nothing changes");
  assert.equal(state.chapters[0].sections[1].title, "Two");
});

test("updateSection refuses a duplicate number", () => {
  const state = emptyState();
  addIn(state, "federal", FEDERAL_VALUES, "1983");
  addIn(state, "federal", FEDERAL_VALUES, "1984");

  const id = state.chapters[0].sections.find((s) => s.number === "1984").id;
  assert.equal(updateSection(state, id, { number: "1983", title: "clash" }).status, "duplicate");
  assert.deepEqual(state.chapters[0].sections.map((s) => s.number), ["1983", "1984"]);
});

test("currentChapter follows activeId then falls back to the first chapter", () => {
  const state = emptyState();
  addIn(state, "federal", { Title: "42" }, "1983");
  addIn(state, "federal", { Title: "15" }, "1501");
  const us42 = state.chapters.find((c) => chapterNumber(c) === "42");

  state.activeId = us42.id;
  assert.equal(chapterNumber(currentChapter(state)), "42");
  state.activeId = "gone";
  assert.equal(chapterNumber(currentChapter(state)), "42");
  assert.equal(currentChapter(emptyState()), null);
});

/* ---------- jurisdiction edits ---------- */

test("addJurisdiction slugifies the name and refuses duplicates", () => {
  const state = emptyState();
  assert.equal(addJurisdiction(state, { name: "Puerto Rico", kind: "state" }).status, "ok");
  assert.deepEqual(findJurisdiction(state, "puerto-rico").name, "Puerto Rico");
  assert.equal(addJurisdiction(state, { name: "Puerto Rico", kind: "state" }).status, "duplicate");
  assert.equal(addJurisdiction(state, { name: "Kentucky", kind: "state" }).status, "duplicate",
    "the seeded states are already there");
  assert.equal(addJurisdiction(state, { name: "   ", kind: "state" }).status, "invalid");
});

test("updateJurisdiction renames and re-kinds without touching chapters", () => {
  const state = emptyState();
  addIn(state, "kentucky", { Chapter: "7" }, "7-1");

  const result = updateJurisdiction(state, "kentucky", { name: "Commonwealth of Kentucky", kind: "state" });
  assert.equal(result.status, "ok");
  assert.equal(findJurisdiction(state, "kentucky").name, "Commonwealth of Kentucky");
  assert.equal(updateJurisdiction(state, "kentucky", { name: "", kind: "state" }).status, "invalid");
  assert.equal(updateJurisdiction(state, "nope", { name: "x" }).status, "missing");
  assert.equal(state.chapters.length, 1);
  assert.equal(state.chapters[0].jurisdiction, "kentucky");
});

/* ---------- persistence ---------- */

test("migrate drops the old organization fields and tops up the jurisdiction list", () => {
  const v2 = {
    jurisdictions: [
      { key: "federal", name: "Federal", kind: "federal", parts: ["Title", "Chapter"], dividers: [{ type: "Chapter", value: "21" }] },
      { key: "kentucky", name: "Kentucky", kind: "state", parts: ["Chapter"], dividers: [] }
    ],
    chapters: [
      { id: "c1", jurisdiction: "federal", partValues: { Title: "42", Chapter: "21" }, title: "X", sections: [] }
    ],
    activeId: "c1"
  };
  const out = migrate(v2);
  assert.equal(out.jurisdictions.length, 51, "Federal plus every state");
  assert.deepEqual(out.jurisdictions.map((j) => j.key).slice(0, 2), ["federal", "kentucky"]);
  assert.ok(out.jurisdictions.every((j) => !("parts" in j) && !("dividers" in j)));
  assert.deepEqual(out.chapters, v2.chapters, "chapter values survive untouched");
  assert.equal(out.activeId, "c1");
  assert.equal(migrate(null), null);
});

/* ---------- sample data ---------- */

test("sampleData exercises both jurisdictions and the sample's organization paths", () => {
  const state = sampleData();
  assert.equal(state.jurisdictions.length, 51);
  assert.deepEqual(chaptersInOrder(state, "federal").map((c) => partPath(findJurisdiction(state, "federal"), c.partValues)),
    ["Title 42 \u00b7 Chapter 21 \u00b7 Subchapter IV"]);
  assert.deepEqual(chaptersInOrder(state, "kentucky").map((c) => chapterNumber(c)), ["7", "12"]);
  assert.equal(state.activeId, chaptersInOrder(state, "kentucky")[0].id);
});
