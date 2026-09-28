# Chapter Builder

Paste the wording of statutes/regulations and get one clean, sorted HTML
"document" per chapter — with automatic highlighting of defined terms and
automatic clause nesting. Vanilla JavaScript, ES modules, **no framework, no
bundler, no npm, no build step**.

## Run it

ES modules do not load over `file://` (CORS), so serve the folder statically.
Any static server works; with Python installed, one line is enough:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

Other equivalents: `npx serve .`, `php -S localhost:8000`, or any static host.

> Opening `index.html` directly with `file://` will **not** work — the module
> imports are blocked. If you need a double-clickable file, you must add a
> separate legacy single-file build; this project intentionally has none.

## Using it

- **Chapter, chapter title, section number and section title are entered by
  hand** and all four are required. The paste box takes *only* the wording of
  the statute or regulation — no section number, no section title, no chapter
  heading. Nothing is detected or parsed out of the paste; all of it is stored
  as this section's text.
- The paste is cleaned up on **Add section** (see *Normalization* below).
- **Edit a chapter** with the *Edit* button next to it in the sidebar — that
  renames the chapter (e.g. `7` → `7A`) and changes its title.
- **Edit a section** with the *Edit* button on its heading — that changes its
  number and title. The chapter re-sorts automatically, so the document order
  stays correct.
- **Enter** saves an inline editor, **Escape** (or *Cancel*) discards it.
- A rename that would collide with an existing chapter or section number is
  refused with a message, and the editor stays open so it can be fixed.

## Layout

```
index.html                  App shell: markup + <script type="module" src="src/main.js">
styles/app.css              Chrome / layout / sidebar / composer styles
styles/doc.css              Document styles (screen + exported files, one source)
src/main.js                 Bootstrap: load state, wire events, first render
src/core/model.js           State mutations: add, rename chapter, update section, sort-on-add
src/core/text.js            normalizeBody: unwrap soft line wraps, repair hyphen splits, collapse spacing
src/core/sort.js            naturalKey, naturalCmp
src/core/definitions.js     definition units, term extraction, suppression, highlight runs
src/core/nesting.js         indent/marker depth analysis plus clause body offsets
src/ui/render.js            All DOM building: sidebar, chapter, section, body, editors
src/ui/events.js            All addEventListener wiring
src/storage/local.js        load/save + STORE_KEY
src/export/html.js          exportChapter + download; inlines doc.css into standalone HTML
tests/core.test.js          Node tests against the pure core/ modules
tests/dom.test.js           Headless end-to-end test (real modules + real index.html)
tests/dom-shim.js           Minimal DOM shim so the UI layer runs in Node
```

## Dependency direction

Acyclic, layers point inward:

```
main -> events -> { core, ui/render, storage, export }
ui/render -> core        export -> core (and -> ui/render, for the shared page markup)
```

Everything under `src/core/**` is pure: no `document`, `window`, `localStorage`,
`Blob`, or `URL`. Only `src/ui/*`, `src/storage/local.js`, and
`src/export/html.js` touch browser APIs.

## Invariants

- **Normalize once, then store raw.** `normalizeBody` runs on *Add section*
  and the result is stored. It fixes formatting artifacts only — never wording,
  punctuation, capitalization or citations — and joins soft line wraps back into
  sentences (see *Text normalization*). Highlighting is never baked into stored
  state; it happens at render. Indentation is preserved because clause nesting
  depends on it.
- **Definitions are chapter-wide.** On every render, `chapterDefinitions(chapter)`
  is computed from *all* sections and applied to *every* section, so a
  definitions section pasted later retroactively highlights earlier sections.
  Insertion order is irrelevant.
- **A defining section does not highlight its own definitions.** Inside the
  section that defines a term, that term is suppressed — *except* where it
  appears inside a **different** definition in the same section. So in
  `"Authority" means the board.` / `"Fee" means a charge set by the Authority.`,
  the first `Authority` stays plain and the second is highlighted.
- **Matching is case-insensitive but whole-word.** Statutes define `"Bread"` and
  then write `bread`; both highlight. `breadth` and `breads` do not.
- **A clause marker is printed once.** `(a)`, `(32)`, … is rendered as a bold
  label and sliced off the body by matched length (not by string replace), which
  fixes the old double-numbering bug.
- **Highlighting is built from the raw text, not by walking text nodes**, so a
  per-match decision (own definition or not) is possible and no term can be lost
  at a text-node boundary.
- **Pasted text is never `innerHTML`.** It renders through `textContent` / text
  nodes; HTML escaping exists only for the export template. Editor chrome is
  rendered only on screen, so exports stay clean.
- **Nesting follows the source.** Real leading whitespace wins
  (`depth = round((indent − base) / unit)`, `unit = gcd` of positive indents and
  must be `≥ 2`). Only when the paste has no usable indentation does it fall back
  to clause-marker inference (`markerDepth`).
- **One source for document styles.** `styles/doc.css` is linked on screen and
  read back from the CSSOM (same-origin, already loaded) to be inlined into every
  export, so preview == export without a second copy and without an extra
  request. Keeping it synchronous means the download still happens inside the
  user's click.

## Text normalization

Pasting out of a PDF or a page brings CRLF newlines, hard spaces, stray tabs,
runs of spaces, piles of blank lines and hard line wraps mid-sentence.
`normalizeBody` (`src/core/text.js`) repairs the formatting without touching the
wording, and **joins a single newline between two lines of ordinary prose into a
space**. It does not simply replace every newline: a break is kept when either
side of it looks intentional.

Kept as a real break when:

- either line is blank (paragraph break),
- the previous line is a heading (ALL CAPS, or short and led by
  Article/Section/Sec./Chapter/Part/Rule/Title/§),
- the previous line ends in `. : ! ?` (end of a sentence or a lead-in),
- the next line starts a numbered/lettered item or bullet
  (`(a)`, `(12)`, `iv.`, `A.`, `•`, `-`, `§`),
- the next line opens a quotation (a new definition entry),
- the next line is indented deeper than the paste's base indent.

A deeper-indented line *is* still joined when it plainly continues a sentence
(it starts lowercase) — that is what a hanging indent looks like.

A hyphen at the break is resolved rather than blindly deleted:

- fragment is a word ending (`establish-` + `ment` → `establishment`,
  `regula-` + `tion` → `regulation`) → the hyphen is dropped and the word glued;
- otherwise the hyphen is a real compound hyphen and is kept
  (`well-` + `known` → `well-known`, `state-` + `owned` → `state-owned`);
- an invisible soft hyphen (`U+00AD`) is always removed.

Excessive spaces are then collapsed (interior runs, trailing whitespace) and
runs of blank lines are reduced to a single blank line.

## Definition extraction rules

A **definition unit** is one clause (split on `. ; : ! ?` and newlines) that
contains a definitional verb (`means`, `shall mean`, `mean`, `includes`,
`include`, `refers to`, `has the meaning`). Every *quoted* phrase that appears
**before** that verb in the same clause is a defined term, so:

```
"Bread" and "enriched bread" mean only the foods commonly known ...
```

yields both `Bread` and `enriched bread`. A later clause in the same section can
define the same term again, and becomes its own unit:

```
For the purposes of KRS 217.136 and 217.137, "bread" or "enriched bread" also means ...
```

Quotes must be paired (`"…"`, `“…”`, `‘…’`); a lone apostrophe is never treated
as an opening quote. Sections whose title contains "definition", or which have
two or more units, additionally pick up unquoted `Capitalized X means` forms.

## Tests

Node's built-in test runner, no dependencies:

```sh
node --test tests/core.test.js tests/dom.test.js
```

- `tests/core.test.js` unit-tests the pure core: natural sorting
  (`7-1 < 7-2 < 7-10`), normalization (soft wraps joined, paragraphs, headings,
  numbering, bullets, indentation and hyphenated splits preserved, citations
  untouched, idempotent), multi-term and repeated definitions, case-insensitive
  whole-word matching, the self-highlighting rule, clause depth for indented and
  marker-only fixtures, and the add/rename/update mutations.
- `tests/dom.test.js` boots the real `src/main.js` against the real `index.html`
  through a tiny DOM shim and drives it like a user: required fields, wording-only
  paste, normalization, duplicate guards, inline editing of chapter and section,
  Enter/Escape, sample loading, highlighting rules, and export. It is a smoke
  test, not a browser — it does not render pixels.

## Known limitations / dev notes

- **Definition extraction is heuristic.** It will miss valid forms and can
  produce false positives (for example a quoted phrase followed by "includes" in
  ordinary prose). Keep it conservative, or add a manual review/edit path.
- **Marker nesting is approximate** for single letters that are also Roman
  numerals (`c d i l m v x`). The predecessor/sequence-continuation logic
  disambiguates most cases but not all.
- **Unwrapping has two known approximations.** A title-case heading sitting on
  the very next line after prose (no blank line, not ALL CAPS, no structural
  keyword) is indistinguishable from a wrapped line and gets joined; and a
  hyphen split whose fragment is not a recognizable word ending
  (`ex-pected`) keeps the hyphen instead of being glued, because guessing wrong
  there would silently corrupt a real compound. Both are deliberately biased
  toward not altering the wording.
- **Exports are client-side downloads** (Blob + `<a download>`); one page cannot
  write sibling files on disk. The realistic upgrade is a tiny static/local
  server that writes one file per chapter.
- **Exported CSS is the browser's CSSOM serialization** of `styles/doc.css`
  (comments dropped, whitespace normalized) rather than the raw file bytes. It
  is the same stylesheet the screen uses, so the export is styled identically;
  if you ever need byte-identical CSS in exports, switch `docCss()` in
  `src/export/html.js` to `fetch()` the file (that makes export asynchronous).
- **All four fields are required on every add**, including the chapter and
  chapter title when the chapter already exists. That is deliberate, but if
  retyping the chapter for each section gets tedious, pre-filling those two
  fields from the active chapter is the obvious relaxation.
- **Storage schema is versioned** by the centralized `STORE_KEY`. Bump the
  version and add a migration in `load()` when the shape changes.
