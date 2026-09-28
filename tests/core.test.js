/* Tests for the pure core/. Run with: node --test tests/
   No dependencies — Node's built-in test runner only. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { naturalKey, naturalCmp } from "../src/core/sort.js";
import { parseSection } from "../src/core/parse.js";
import { extractTerms, isDefinitionSection, chapterDefinitions } from "../src/core/definitions.js";
import { analyzeBody } from "../src/core/nesting.js";
import { addSection, currentChapter, emptyState } from "../src/core/model.js";

test("natural ordering: 7-1 < 7-2 < 7-10", () => {
  const sorted = ["7-10", "7-2", "7-1"].slice().sort(naturalCmp);
  assert.deepEqual(sorted, ["7-1", "7-2", "7-10"]);
  assert.ok(naturalCmp("7-2", "7-10") < 0);
  assert.ok(naturalCmp("2", "10") < 0);
  assert.ok(naturalCmp("Chapter 7", "Chapter 12") < 0);
  assert.equal(naturalCmp("7-1", "7-1"), 0);
  assert.deepEqual(naturalKey("7-10"), ["000000000007", "-", "000000000010"]);
});

test("parseSection pulls the header off and keeps the body raw", () => {
  const p = parseSection("\u00a7 7-12. Rate filings\n(a) Every public utility shall file its rates.\n    (1) A filing must state net income.");
  assert.equal(p.number, "7-12");
  assert.equal(p.title, "Rate filings");
  assert.equal(p.body, "(a) Every public utility shall file its rates.\n    (1) A filing must state net income.");
});

test("parseSection reads a chapter header", () => {
  const p = parseSection("CHAPTER 7 \u2014 Public Utilities\n\u00a7 7-1. Application\nThis chapter applies.");
  assert.equal(p.chapterNumber, "7");
  assert.equal(p.chapterTitle, "Public Utilities");
  assert.equal(p.number, "7-1");
  assert.equal(p.title, "Application");
  assert.equal(p.body, "This chapter applies.");
});

test("extractTerms handles quoted and capitalized definitions", () => {
  const terms = extractTerms("\u201CAuthority\u201D means the Department of Public Utilities.\n\u201CNet income\u201D means gross income less deductions.");
  assert.ok(terms.includes("Authority"));
  assert.ok(terms.includes("Net income"));
});

test("isDefinitionSection", () => {
  assert.equal(isDefinitionSection({ title: "Definitions", body: "x" }), true);
  assert.equal(isDefinitionSection({
    title: "",
    body: "\u201CA\u201D means one thing.\n\u201CB\u201D means another thing."
  }), true);
  assert.equal(isDefinitionSection({ title: "Rate filings", body: "Every utility shall file its rates." }), false);
});

test("chapter definitions are chapter-wide and insertion-order independent", () => {
  const plain = { number: "7-1", title: "Application", body: "This chapter applies to every public utility." };
  const defs = {
    number: "7-2", title: "Definitions",
    body: "\u201CAuthority\u201D means the Department.\n\u201CNet income\u201D means gross income."
  };
  const forward = chapterDefinitions({ key: "7", sections: [plain, defs] });
  const backward = chapterDefinitions({ key: "7", sections: [defs, plain] });
  assert.deepEqual(forward.slice().sort(), backward.slice().sort());
  assert.ok(forward.includes("Authority"));
  assert.ok(forward.includes("Net income"));
});

test("clause depth follows real indentation when present", () => {
  const body = [
    "This chapter applies to every public utility.",
    "(a) The authority shall review each application.",
    "    (1) The authority may request additional information.",
    "    (2) A decision must issue within the period stated.",
    "(b) An applicant may appeal a denial."
  ].join("\n");

  const items = analyzeBody(body);
  const clauses = items.filter((i) => i.type === "clause");
  assert.deepEqual(clauses.map((c) => c.depth), [0, 0, 1, 1, 0]);
  assert.deepEqual(clauses.map((c) => c.marker), [null, "(a)", "(1)", "(2)", "(b)"]);
  // markers are sliced off the body, so they cannot be printed twice
  assert.equal(clauses[1].text, "The authority shall review each application.");
  assert.ok(!clauses[2].text.includes("(1)"));
});

test("clause depth falls back to marker inference without indentation", () => {
  const body = [
    "(a) Every public utility shall file its rates.",
    "(1) A filing must state the net income.",
    "(2) The authority shall accept or reject each filing."
  ].join("\n");

  const clauses = analyzeBody(body).filter((i) => i.type === "clause");
  assert.deepEqual(clauses.map((c) => c.depth), [1, 2, 2]);
  assert.deepEqual(clauses.map((c) => c.marker), ["(a)", "(1)", "(2)"]);
});

test("blank lines survive as their own items", () => {
  const items = analyzeBody("first\n\nsecond");
  assert.deepEqual(items.map((i) => i.type), ["clause", "blank", "clause"]);
});

test("addSection sorts on add, rejects duplicates and creates the chapter", () => {
  const state = emptyState();
  addSection(state, { chapterNumber: "7", chapterTitle: "Public Utilities", number: "7-10", title: "Ten", body: "b" });
  addSection(state, { chapterNumber: "7", chapterTitle: "", number: "7-2", title: "Two", body: "b" });

  assert.deepEqual(state.chapters[0].sections.map((s) => s.number), ["7-2", "7-10"]);
  assert.equal(state.chapters[0].title, "Public Utilities");
  assert.equal(state.activeKey, "7");

  const dup = addSection(state, { chapterNumber: "7", chapterTitle: "", number: "7-2", title: "Dup", body: "b" });
  assert.equal(dup.status, "duplicate");
  assert.equal(state.chapters[0].sections.length, 2);
});

test("currentChapter prefers activeKey then the first chapter", () => {
  const state = emptyState();
  addSection(state, { chapterNumber: "7", chapterTitle: "", number: "7-1", title: "", body: "b" });
  addSection(state, { chapterNumber: "12", chapterTitle: "", number: "12-1", title: "", body: "b" });
  state.activeKey = "7";
  assert.equal(currentChapter(state).key, "7");
  state.activeKey = null;
  assert.equal(currentChapter(state).key, "7");
  assert.equal(currentChapter(emptyState()), null);
});
