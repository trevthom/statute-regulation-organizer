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
  CHAPTER_LEVELS, LEVEL_MAX, ORG_LEVELS, SECTION_LEVELS, STATES, addSection, chapterSignature,
  chapterTitles, chapterValues, chaptersInOrder, compareSections, currentChapter, emptyState,
  findJurisdiction, isValidLevelValue, makeJurisdiction, orgLevel, partPath, removeSection,
  sectionKey, seedJurisdictions, sortedJurisdictions, updateChapter, updateSection
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

function addIn(state, jurisdiction, partValues, extra = {}) {
  return addSection(state, {
    jurisdiction,
    partValues,
    partTitles: extra.partTitles || {},
    checked: extra.checked || Object.keys(partValues),
    body: extra.body || "b"
  });
}

test("the organization hierarchy is fixed: the chapter levels, then the section's own", () => {
  assert.deepEqual(ORG_LEVELS, ["Title", "Subtitle", "Division", "Chapter", "Subchapter",
    "Part", "Subpart", "Section", "Subsection"]);
  assert.deepEqual(CHAPTER_LEVELS, ["Title", "Subtitle", "Division", "Chapter", "Subchapter",
    "Part", "Subpart"]);
  assert.deepEqual(SECTION_LEVELS, ["Section", "Subsection"]);
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

test("orgLevel canonicalizes a level name and rejects anything else", () => {
  assert.equal(orgLevel(" subchapter "), "Subchapter");
  assert.equal(orgLevel("Subpart"), "Subpart");
  assert.equal(orgLevel("Paragraph"), null);
  assert.equal(orgLevel(""), null);
});

test("LEVEL_MAX is 12 and a value may use letters, digits, parentheses and hyphens", () => {
  assert.equal(LEVEL_MAX, 12);
  assert.ok(isValidLevelValue("A") && isValidLevelValue("IV") && isValidLevelValue("7-12"));
  assert.ok(isValidLevelValue("(a)") && isValidLevelValue("123456789012") && isValidLevelValue(" 217 "));
  assert.ok(!isValidLevelValue(""));
  assert.ok(!isValidLevelValue("1234567890123"), "13 characters is too long");
  assert.ok(!isValidLevelValue("7 12"), "spaces are not allowed");
  assert.ok(!isValidLevelValue("sub/chapter"));
  assert.ok(!isValidLevelValue("\u00a7 12"));
});

test("seedJurisdictions tops the list up and keeps what is already there", () => {
  const out = seedJurisdictions([{ key: "kentucky", name: "Kentucky", kind: "state", parts: ["Chapter"] }]);
  assert.equal(out.length, 51);
  assert.equal(out.find((j) => j.key === "kentucky").name, "Kentucky");
  assert.ok(!("parts" in out.find((j) => j.key === "kentucky")));
});

test("jurisdictions list Federal first, then states alphabetically", () => {
  const names = sortedJurisdictions(emptyState()).map((j) => j.name);
  assert.equal(names[0], "Federal");
  assert.deepEqual(names.slice(1), STATES);
});

/* ---------- chapters ---------- */

test("chapterValues and chapterTitles keep only the chapter levels", () => {
  assert.deepEqual(
    chapterValues({ Title: " 42 ", Chapter: "21", Section: "1983", Subsection: "a" }),
    { Title: "42", Chapter: "21" });
  assert.deepEqual(
    chapterTitles({ Title: "Civil Rights", Section: "Civil action" }),
    { Title: "Civil Rights" });
});

test("the path and its signature follow the hierarchy and ignore the section itself", () => {
  assert.equal(chapterSignature({ Subchapter: "IV", Chapter: "21", Title: "42" }),
    "title=42|chapter=21|subchapter=iv");
  assert.equal(chapterSignature({ Title: "42", Section: "1983", Subsection: "a" }), "title=42");
  assert.equal(chapterSignature({}), "");
  assert.equal(partPath({ Subchapter: "IV", Title: "42" }, { Title: "Civil Rights" }),
    "Title 42 \u2014 Civil Rights \u00b7 Subchapter IV");
  assert.equal(partPath({}, {}), "");
});

/* ---------- sections ---------- */

test("a section is filed under the chapter-level path, not the Section row", () => {
  const state = emptyState();
  const r = addIn(state, "federal",
    { Title: "42", Chapter: "21", Section: "1983" },
    { partTitles: { Title: "Civil Rights", Section: "Civil action" } });

  assert.equal(r.status, "added");
  assert.deepEqual(r.chapter.partValues, { Title: "42", Chapter: "21" });
  assert.deepEqual(r.chapter.partTitles, { Title: "Civil Rights" });
  assert.equal(r.section.number, "1983");
  assert.equal(r.section.title, "Civil action");
  assert.deepEqual(state.chapters[0].sections.map(sectionKey), ["1983"]);
  assert.deepEqual(partPath(r.chapter.partValues, r.chapter.partTitles),
    "Title 42 \u2014 Civil Rights \u00b7 Chapter 21");
});

test("the Section row is always required, so a section number is required", () => {
  const state = emptyState();
  const blank = addIn(state, "federal", { Title: "42" }, { checked: ["Title"] });
  assert.equal(blank.status, "invalid");
  assert.equal(blank.field, "level");
  assert.equal(blank.level, "Section");
  assert.equal(blank.reason, "missing");
  assert.equal(state.chapters.length, 0, "nothing is stored without a section number");
});

test("a checked level needs a valid value; unchecked levels stay out of the path", () => {
  const state = emptyState();

  const missing = addIn(state, "federal", { Chapter: "", Section: "1" }, { checked: ["Chapter", "Section"] });
  assert.deepEqual([missing.level, missing.reason], ["Chapter", "missing"]);

  const bad = addIn(state, "federal", { Chapter: "21!", Section: "1" }, { checked: ["Chapter", "Section"] });
  assert.deepEqual([bad.level, bad.reason], ["Chapter", "format"]);

  const long = addIn(state, "federal", { Chapter: "1234567890123", Section: "1" }, { checked: ["Chapter", "Section"] });
  assert.deepEqual([long.level, long.reason], ["Chapter", "format"]);
  assert.equal(state.chapters.length, 0, "nothing is stored until the path is valid");

  const ok = addIn(state, "federal", { Chapter: "21", Subchapter: "IV", Section: "1" },
    { checked: ["Chapter", "Section"] });
  assert.equal(ok.status, "added");
  assert.deepEqual(ok.chapter.partValues, { Chapter: "21" }, "the unticked level is not part of the path");
});

test("the same path shares a chapter; an extra level starts a different one", () => {
  const state = emptyState();
  addIn(state, "federal", { Title: "42", Chapter: "21", Section: "1985" });
  addIn(state, "federal", { Title: "42", Chapter: "21", Section: "1983" });
  assert.equal(state.chapters.length, 1);
  assert.deepEqual(state.chapters[0].sections.map((s) => s.number), ["1983", "1985"], "sorted naturally");

  addIn(state, "federal", { Title: "42", Chapter: "21", Subchapter: "IV", Section: "1983" });
  assert.equal(state.chapters.length, 2, "an extra organization level is a different area");
  assert.deepEqual(chaptersInOrder(state, "federal").map((c) => partPath(c.partValues)),
    ["Title 42 \u00b7 Chapter 21", "Title 42 \u00b7 Chapter 21 \u00b7 Subchapter IV"]);
});

test("a subsection is part of the designation, so 1983(a) and 1983(b) coexist", () => {
  const state = emptyState();
  addIn(state, "federal", { Title: "42", Section: "1983", Subsection: "b" });
  addIn(state, "federal", { Title: "42", Section: "1983", Subsection: "a" });
  assert.equal(state.chapters.length, 1);
  assert.deepEqual(state.chapters[0].sections.map(sectionKey), ["1983(a)", "1983(b)"]);

  const dup = addIn(state, "federal", { Title: "42", Section: "1983", Subsection: "a" });
  assert.equal(dup.status, "duplicate");
  assert.equal(dup.number, "1983(a)");
  assert.equal(state.chapters[0].sections.length, 2);
});

test("a level title supplied later backfills the chapter", () => {
  const state = emptyState();
  addIn(state, "federal", { Title: "42", Chapter: "21", Section: "1983" });
  assert.deepEqual(state.chapters[0].partTitles, {});
  addIn(state, "federal", { Title: "42", Chapter: "21", Section: "1985" },
    { partTitles: { Title: "Civil Rights" } });
  assert.deepEqual(state.chapters[0].partTitles, { Title: "Civil Rights" });
});

test("compareSections keeps numbered sections natural, a blank number (legacy data) last", () => {
  const list = [{ number: "7-10" }, { number: "" }, { number: "7-2" }].sort(compareSections);
  assert.deepEqual(list.map((s) => s.number), ["7-2", "7-10", ""]);
});

test("addSection needs a real jurisdiction", () => {
  const state = emptyState();
  assert.equal(addIn(state, "atlantis", { Section: "1" }).status, "no-jurisdiction");
  assert.equal(state.chapters.length, 0);
});

test("updateChapter edits the organization path, refusing a bad or clashing one", () => {
  const state = emptyState();
  addIn(state, "federal", { Title: "42", Section: "1983" });
  const id = state.chapters[0].id;

  const ok = updateChapter(state, id, {
    partValues: { Title: "15", Chapter: "21" },
    partTitles: { Title: "Civil Rights" },
    checked: ["Title", "Chapter"]
  });
  assert.equal(ok.status, "ok");
  assert.deepEqual(state.chapters[0].partValues, { Title: "15", Chapter: "21" });
  assert.deepEqual(state.chapters[0].partTitles, { Title: "Civil Rights" });

  assert.equal(updateChapter(state, id, { partValues: { Chapter: "" }, checked: ["Chapter"] }).reason, "missing");
  assert.equal(updateChapter(state, id, { partValues: { Chapter: "21!" }, checked: ["Chapter"] }).reason, "format");
  assert.equal(updateChapter(state, id, {
    partValues: { Title: "15", Chapter: "21" }, partTitles: {}, checked: ["Title", "Chapter"]
  }).status, "ok");

  addIn(state, "federal", { Title: "12", Section: "1201" });
  const other = state.chapters.find((c) => (c.partValues || {}).Title === "12").id;
  assert.equal(updateChapter(state, other, {
    partValues: { Title: "15", Chapter: "21" }, checked: ["Title", "Chapter"]
  }).status, "duplicate");
  assert.equal(updateChapter(state, "nope", { partValues: {}, checked: [] }).status, "missing");
});

test("updateSection edits the number, title and subsection and re-sorts", () => {
  const state = emptyState();
  addIn(state, "federal", { Section: "1990" });
  addIn(state, "federal", { Section: "1983" });
  const id = state.chapters[0].sections.find((s) => s.number === "1990").id;

  assert.equal(updateSection(state, id, { number: "1984", title: "Two" }).status, "ok");
  assert.deepEqual(state.chapters[0].sections.map((s) => s.number), ["1983", "1984"]);
  assert.equal(state.chapters[0].sections[1].title, "Two");

  const blank = updateSection(state, id, { number: "  ", title: "x" });
  assert.equal(blank.status, "invalid");
  assert.equal(blank.field, "level");
  assert.equal(blank.level, "Section");
  assert.deepEqual(state.chapters[0].sections.map((s) => s.number), ["1983", "1984"],
    "a blank number is refused and nothing changes");

  const badSub = updateSection(state, id, { number: "1984", subsection: "sub/chapter" });
  assert.equal(badSub.status, "invalid");
  assert.equal(badSub.level, "Subsection");

  assert.equal(updateSection(state, id, { number: "1984", subsection: "a" }).status, "ok");
  assert.equal(sectionKey(state.chapters[0].sections[1]), "1984(a)");
});

test("updateSection refuses a duplicate designation", () => {
  const state = emptyState();
  addIn(state, "federal", { Section: "1983" });
  addIn(state, "federal", { Section: "1984" });
  const id = state.chapters[0].sections.find((s) => s.number === "1984").id;

  assert.equal(updateSection(state, id, { number: "1983" }).status, "duplicate");
  assert.deepEqual(state.chapters[0].sections.map((s) => s.number), ["1983", "1984"]);
});

test("removeSection drops a section by id", () => {
  const state = emptyState();
  addIn(state, "federal", { Section: "1983" });
  addIn(state, "federal", { Section: "1984" });
  const id = state.chapters[0].sections[0].id;
  assert.equal(removeSection(state, id), true);
  assert.deepEqual(state.chapters[0].sections.map((s) => s.number), ["1984"]);
  assert.equal(removeSection(state, "gone"), false);
});

test("currentChapter follows activeId then falls back to the first chapter", () => {
  const state = emptyState();
  addIn(state, "federal", { Title: "42", Section: "1983" });
  addIn(state, "federal", { Title: "15", Section: "1501" });
  const us42 = state.chapters.find((c) => (c.partValues || {}).Title === "42");

  state.activeId = us42.id;
  assert.equal(state.activeId, us42.id);
  assert.equal(currentChapter(state).id, us42.id);
  state.activeId = "gone";
  assert.equal(currentChapter(state).id, us42.id);
  assert.equal(currentChapter(emptyState()), null);
});

/* ---------- persistence ---------- */

test("migrate maps the older shapes onto the closed list and the new chapter fields", () => {
  const v3 = {
    jurisdictions: [
      { key: "federal", name: "Federal", kind: "federal", parts: ["Title"], dividers: [] },
      { key: "kentucky", name: "Kentucky", kind: "state" }
    ],
    chapters: [
      {
        id: "c1", jurisdiction: "federal",
        partValues: { Title: "42", Chapter: "21", Section: "1983" },
        title: "Civil Rights",
        sections: [{ id: "s1", number: "1983", title: "Civil action", body: "b" }]
      }
    ],
    activeId: "c1"
  };
  const out = migrate(v3);
  assert.equal(out.jurisdictions.length, 51, "Federal plus every state");
  assert.ok(out.jurisdictions.every((j) => !("parts" in j) && !("dividers" in j)));
  assert.deepEqual(out.chapters[0].partValues, { Title: "42", Chapter: "21" },
    "the Section row stays out of the chapter path");
  assert.deepEqual(out.chapters[0].partTitles, {});
  assert.deepEqual(out.chapters[0].sections[0],
    { id: "s1", number: "1983", title: "Civil action", subsection: "", subsectionTitle: "", body: "b" });
  assert.equal(out.activeId, "c1");
  assert.equal(migrate(null), null);
});
