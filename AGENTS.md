# AGENTS.md — Chapter Builder engineering guide

Orientation for an agent (or a new developer) editing this codebase. Read this
before changing anything; it is the map of how the app is built and which rules
must not break. `README.md` is the user-facing overview.

## What it is

A browser app that turns pasted statute/regulation wording into clean, sorted,
highlighted HTML "documents", one per chapter. **Vanilla JavaScript ES modules.
No framework, no bundler, no npm, no build step, no dependencies.** Do not add a
package manager, a bundler, or a framework.

## Run and test

Serve the folder statically (ES modules do not load over `file://`):

```sh
python3 -m http.server 8000     # then open http://localhost:8000/
```

Tests use Node's built-in runner (Node 18+; developed on Node 22):

```sh
node --test tests/core.test.js tests/dom.test.js
```

Always run the tests after a change — they boot the real `index.html` + `main.js`.

## File map

```
index.html                  App shell (markup + <script type="module" src="src/main.js">)
styles/app.css              Chrome, sidebar, composer, toast, editor styles
styles/doc.css              Document styles (screen + exports, one source); theme tokens
src/main.js                 Bootstrap: load state, wire events, first render
src/core/model.js           State shape + all mutations (jurisdictions, chapters, sections)
src/core/text.js            normalizeBody: unwrap soft wraps, repair hyphen splits, tidy spacing
src/core/sort.js            naturalKey, naturalCmp (natural ordering)
src/core/definitions.js     Definition units, term extraction, suppression, highlight runs
src/core/nesting.js         Clause indent/marker depth analysis + clause body offsets
src/ui/render.js            All DOM building: sidebar, organization layer, chapter/section editors, body
src/ui/events.js            All addEventListener wiring and the render handlers
src/storage/local.js        load/save + STORE_KEY
src/export/html.js          exportChapter + download; inlines doc.css into standalone HTML
tests/core.test.js          Node tests for the pure core/
tests/dom.test.js           Headless end-to-end test (real modules + real index.html)
tests/dom-shim.js           Minimal DOM shim so the UI layer runs in Node
```

Dependency direction is acyclic and points inward:

```
main -> events -> { core, ui/render, storage, export }
ui/render -> core          export -> core (and -> ui/render, for the shared page markup)
```

Everything under `src/core/**` is pure: no `document`, `window`, `localStorage`,
`Blob`, or `URL`. Only `src/ui/*`, `src/storage/local.js` and
`src/export/html.js` touch browser APIs. Keep new logic in `core/` when it can
be pure, and test it in `core.test.js`.

## Data model

`state` (persisted under `chapterBuilder.v4`):

```js
{
  jurisdictions: [                    // Federal, or one of the 50 states
    { key: "federal", name: "Federal", kind: "federal" | "state" }
  ],
  chapters: [
    { id, jurisdiction: <jurisdiction.key>,
      partValues: { Title: "42", Chapter: "21" },   // the chapter levels that carry a value
      partTitles: { Title: "Civil Rights" },         // each level's optional title
      sections: [ { id, number: "1983", title: "…", subsection: "", subsectionTitle: "", body: "…" } ] }
  ],
  activeId: <chapter.id | null>       // which chapter the document pane shows
}
```

- **Organization hierarchy** (`ORG_LEVELS` in `model.js`) — the fixed, ordered
  levels every statute is filed under, outermost first: `Title`, `Subtitle`,
  `Division`, `Chapter`, `Subchapter`, `Part`, `Subpart`, `Section`,
  `Subsection`. These names are also the keys of a chapter's `partValues` /
  `partTitles`, so **renaming one is a data migration, not a rename**.
  `orgLevel(name)` canonicalizes a name (or returns `null` for an unknown one).
- **Chapter levels vs section levels** — `CHAPTER_LEVELS` is every level except
  `SECTION_LEVELS` (`Section`, `Subsection`). The chapter levels organize a
  chapter; the Section row carries the section's own number and the Subsection
  row an optional deeper designation (so `§ 1983(a)` and `§ 1983(b)` can both
  live in one chapter).
- **Values** — nothing is automatic: a federal Title is *not* required, because
  not every state has one. Every level the user ticks carries a value of up to
  `LEVEL_MAX` (12) characters, letters/digits/parentheses/hyphens only
  (`isValidLevelValue`). The composer sends exactly the levels that are ticked
  (`checked`) plus their values (`partValues`) and titles (`partTitles`), because
  "ticked but blank" is an error the model has to see; `pickChecked` keeps only
  the ticked levels, so an unticked row's leftover text never reaches the path.
- **Chapter** — the unit that groups sections. Its display designation is
  `partPath(partValues, partTitles)` (e.g. `"Title 42 — Civil Rights · Chapter
  21"`), and its identity within a jurisdiction is `chapterSignature` (the
  chapter-level path, in hierarchy order), so a section that fills in the same
  levels with the same values joins that chapter and a different path starts
  another one.
- **Section** — `{ id, number, title, subsection, subsectionTitle, body }`.
  `body` is the raw, normalized paste. `number` is **required** and the
  designation `sectionKey(section)` (`number`, or `number(subsection)`) must be
  unique within its chapter; `compareSections` keeps the order natural
  (`7-2 < 7-10`) and is defensive about a blank number in data migrated from an
  older store (it sorts last).
- **Jurisdiction** — the top-level grouping shown in the sidebar. It is a
  **closed list**: `emptyState()` and `seedJurisdictions(list)` produce Federal
  plus all 50 states (`STATES`). There is no add or edit control — a state's
  name and its `kind` are fixed.

Constants and helpers in `src/core/model.js`: `uid`, `ORG_LEVELS`,
`SECTION_LEVELS`, `CHAPTER_LEVELS`, `LEVEL_MAX`, `isValidLevelValue`, `orgLevel`,
`STATES`, `slugKey`, `makeJurisdiction`, `seedJurisdictions`, `emptyState`,
`findJurisdiction`, `sortedJurisdictions`, `chaptersOf`, `chapterValues`,
`chapterTitles`, `chapterSignature`, `partPath`, `compareChapters`,
`sectionKey`, `compareSections`, `chaptersInOrder`, `currentChapter`.

### Mutations (all pure, all return a `{ status }` result)

`addSection`, `updateChapter`, `updateSection`, `removeSection`. Validation lives
here (not only in the events layer): the shared `checkOrg`/`checkLevel` helpers
make `addSection`/`updateChapter`/`updateSection` return `invalid` with
`field: "level"`, `level` and `reason: "missing" | "format"` for a ticked level
whose value is blank or is not up to 12 letters/digits/parentheses/hyphens.
`addSection` always treats `Section` as ticked, so a section can never be added
without a number; a designation that already exists in the chapter returns
`duplicate`.

## Required fields and defaults

- **Only the Section row is required** — it carries the section number — plus
  non-empty paste, a value on every level the user ticked, and the state when
  the statute is filed under a state jurisdiction. Section and level titles are
  optional. `events.js` refuses an add that is missing a required field before
  it touches state (`missingRequired`), and the model refuses it too, so nothing
  can slip through.
- Every level's title is **free-form and optional**; a blank one simply is not
  stored. Titles supplied later backfill the chapter (`partTitles` is merged),
  so adding a second section never wipes a title already there.

## Invariants

- **Normalize once, then store raw.** `normalizeBody` runs on *Add section* and
  the result is stored. It fixes formatting artifacts only — never wording,
  punctuation, capitalization or citations — and joins soft line wraps back into
  sentences. Highlighting is never baked into stored state; it happens at render.
  Indentation is preserved because clause nesting depends on it.
- **Chapters are matched by the levels that were selected.** `addSection` looks
  for a chapter whose `chapterSignature` equals the path the user filled in and
  joins it, so a statute that uses the same levels and values as an earlier one
  is filed in the same area even if it is added much later.
- **Definitions are chapter-wide.** Every render recomputes
  `chapterDefinitions(chapter)` from *all* sections and applies it to *every*
  section, so a definitions section added later retroactively highlights earlier
  ones. Insertion order is irrelevant.
- **A defining section does not highlight its own definitions** — except where a
  term appears inside a **different** definition in the same section.
- **Matching is case-insensitive but whole-word.**
- **A clause marker is printed once and is followed by a literal space.**
  `(a)`, `(32)`, … is a bold label sliced off the body by matched length (never
  string-replace), and `renderBody` appends a `" "` text node after it, so the
  label and the wording never run together on screen, in an export, or when the
  text is copied out. The little `margin-right` in `doc.css` is gone for the same
  reason — one space, from the text, not from CSS.
- **Highlighting is built from the raw text, not by walking text nodes**, so a
  per-match decision is possible and no term is lost at a text-node boundary.
- **Pasted text is never `innerHTML`.** It renders through `textContent` / text
  nodes; HTML escaping exists only for the export template. Editor chrome is
  rendered only on screen, so exports stay clean.
- **Nesting follows the source, one indentation step per level.** Real leading
  whitespace wins (`depth = round((indent − base) / unit)`, `unit = gcd` of
  positive indents and must be `≥ 2`); without usable indentation it falls back
  to clause-marker inference (`markerDepth`), where the **outermost marker
  sequence is depth 0** and each marker nested in it is one deeper. `renderBody`
  indents `depth * 1.5rem`, so a clause in the body's own margin is flush, its
  subclause is indented once, a subclause inside that twice, and so on.
- **One source for document styles.** `styles/doc.css` is linked on screen and
  read back from the CSSOM to be inlined into every export, so preview == export
  without a second copy or an extra request. It stays synchronous so the
  download happens inside the user's click.
- **Section order is natural** (`7-1 < 7-2 < 7-10`); chapters sort by their
  organization values in hierarchy order, then by their level titles, within
  their jurisdiction. The section number is required, so no new section can be
  unnumbered.
- **Nothing is derived or guessed.** A chapter is filed under exactly the levels
  the user ticked and the values they typed — nothing is inferred, and there are
  no automatic levels. Ticking a level and leaving it blank is an error, not an
  omission.
- **The chapter and the section are keyed differently.** A chapter is
  `chapterSignature(partValues)` over the chapter levels only, so a statute that
  matches another statute's selected levels and values lands in the same area;
  the section's own number lives on the section, so several sections share the
  chapter and no number is reused.
- **Sidebar grouping:** Federal first, then states alphabetically.

## Text normalization (`src/core/text.js`)

Repairs CRLF, hard spaces, tabs, space runs, blank-line piles and hard line
wraps mid-sentence without touching wording. A single newline between two lines
of ordinary prose becomes a space; a break is kept when either side looks
structural: a blank line; an ALL-CAPS or keyword-led heading (Article/Section/
Sec./Chapter/Part/Rule/Title/§); the previous line ending in `. : ! ?`; the next
line starting a numbered/lettered item or bullet (`(a)`, `(12)`, `iv.`, `A.`,
`•`, `-`, `§`) or opening a quotation; or a line indented deeper (except a
lowercase continuation — a hanging indent — which is still joined). A hyphen at
the break is dropped only when the fragment is a known word ending
(`establish-` + `ment`), otherwise kept as a real compound hyphen (`well-` +
`known`).

## Definition extraction (`src/core/definitions.js`)

A **definition unit** is one clause (split on `. ; : ! ?` and newlines) that
contains a definitional verb (`means`, `shall mean`, `mean`, `includes`,
`include`, `refers to`, `has the meaning`). Every *quoted* phrase **before** that
verb is a defined term, so `"Bread" and "enriched bread" mean …` yields both. A
later clause can re-define a term as its own unit. Quotes must be paired; a lone
apostrophe never opens a quote. Sections whose title contains "definition", or
that have ≥ 2 units, also pick up unquoted `Capitalized X means` forms
(`capsTerms`). Keep it conservative — false positives are worse than misses.

## Clause nesting (`src/core/nesting.js`)

`analyzeBody(body)` returns `[{ type:"blank" } | { type:"clause", marker, text,
depth, start }]`. `depth` is the indentation step the renderer applies: 0 is a
clause in the body's own margin, 1 a subclause inside it, 2 a subclause inside
that. `start` is the offset of `text` within the raw body, which lets the
renderer ask location-aware questions (e.g. "is this match inside a different
definition?"). Marker-based depth is approximate for single letters that are also
Roman numerals (`c d i l m v x`).

## Persistence and export

- `src/storage/local.js` centralizes `STORE_KEY` (`chapterBuilder.v4`) and the
  `LEGACY_KEYS` it falls back to. **Bump the version and add a migration in
  `load()` when the stored shape changes.** `migrate()` drops the old
  jurisdiction fields (`parts`, `dividers`) and the old single chapter `title`,
  rebuilds the jurisdiction objects from `{ key, name, kind }`, tops the list up
  with Federal and all 50 states (`seedJurisdictions`), keeps only a chapter's
  chapter-level `partValues`, and gives every section the `subsection` /
  `subsectionTitle` fields. Both accessors swallow errors so a sandboxed origin
  still works.
- `src/export/html.js` builds each chapter via `renderChapterContent(ch,
  jurisdiction)` (the same code the preview uses) and downloads a Blob named
  `exportFileName(jurisdiction, ch)` (e.g. `federal-42-21-IV.html`). Exports are
  client-side downloads; one page cannot write sibling files.

## UI state and view conventions

`src/main.js` holds the app context: `getState/setState`, `getView`, `save`,
`render`. `view` is UI-only and never persisted:

- `view.editing = null` — nothing open
- `{ type: "chapter", id }`
- `{ type: "section", id }`

`#parts` is the composer's **organization layer**, built by `mountOrgTree(state)`:
first the jurisdiction picker (`org-kind` = Federal/State, and `org-state`, which
is only enabled for a state — the state is required once State is chosen),
then one row per `ORG_LEVELS` entry, indented a little at a time to show the
nesting: checkbox, level name, value input and title input. The `Section` row is
ticked and disabled — it is the required one. `readOrg()` returns
`{ kind, jurisdictionKey, values, titles, checked }` for the live layer, and
because a render would otherwise discard what the user typed, `mountOrgTree`
reads the rows back into `orgDraft` (and `orgJuris`) *before* rebuilding them.
`resetSectionRows()` clears just the section's own rows after a successful add.
The sidebar's chapter editor reuses the same row builder over `CHAPTER_LEVELS`
(its own `read()`), so the composer and the "Edit organizational levels" editor
cannot drift apart.

## Testing notes

- `tests/core.test.js` unit-tests the pure core: natural sorting, normalization,
  definition rules, clause depth, and every state mutation.
- `tests/dom.test.js` boots the real `main.js` against the real `index.html`
  through `tests/dom-shim.js` and drives it like a user. It runs **sequentially
  on one shared DOM**, so each test starts where the previous one left off.
- The shim implements only what the app uses. Notably `innerHTML` may only be
  set to `""` (clearing), there is no `querySelector*`, and inline `style` is a
  plain object. Add capability to the shim only when the app genuinely needs it.

## Known limitations / extension notes

- **Definition extraction is heuristic** (see above).
- **Marker nesting is approximate** for letter/Roman ambiguities, and it starts
  at depth 0, so a marker sequence that is really a subclause of the prose above
  it (with no indentation at all) is treated as the outermost level.
- **Indentation is an inline `padding-left`.** It survives into an export in a
  browser (serialized on the element) but the DOM shim does not serialize inline
  styles, so the tests assert it on the live DOM and on the sample's nesting
  depth instead of inside the exported HTML.
- **Unwrapping has two approximations**: a title-case heading on the line right
  after prose (no blank line, not ALL CAPS) is joined; a hyphen split whose
  fragment is not a recognized word ending (`ex-pected`) keeps the hyphen. Both
  are biased toward not altering wording.
- **Every level is limited to 12 characters**, letters/digits/parentheses/
  hyphens. The `maxLength` on the input is a convenience; the model's
  `isValidLevelValue` is the real rule.
- **Unchecking a level keeps its value in the input**, so ticking it again
  restores it; the value is only dropped when the section is read back (an
  unticked row contributes nothing).
- **Any jurisdiction may use any level.** For a state, Title, Subtitle and
  Division are simply further optional levels, because not every state has a
  Title.
- **The Section and Subsection rows are not editable from the sidebar's chapter
  editor** — they belong to a section and are edited from the section's own
  Edit button.
- **No delete control** for sections; `removeSection` exists as a model
  primitive only. Jurisdictions cannot be added, renamed or re-kinded at all.
- **No sample data.** The "Load sample" button and `sampleData()` are gone; the
  DOM tests build the fixtures they need through the UI.
