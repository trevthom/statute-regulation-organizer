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
src/ui/render.js            All DOM building: sidebar, jurisdiction/parts editors, chapter, section, body
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

`state` (persisted under `chapterBuilder.v1`):

```js
{
  jurisdictions: [                    // a state (e.g. Kentucky) or the federal system
    { key: "federal", name: "Federal", kind: "federal" | "state",
      parts: ["Title", "Chapter", "Subchapter", "Part"] }   // ordered, see below
  ],
  chapters: [
    { id, jurisdiction: <jurisdiction.key>,
      partValues: { Title: "42", Chapter: "21", Subchapter: "IV", Part: "" },
      title: "Civil Rights",
      sections: [ { id, number: "1983", title: "…", body: "…" } ] }
  ],
  activeId: <chapter.id | null>       // which chapter the document pane shows
}
```

- **Jurisdiction** — the top-level grouping shown in the sidebar. `kind` is
  `"federal"` or `"state"`. `emptyState()` seeds one Federal jurisdiction.
- **Organization parts** (`jurisdiction.parts`) — the ordered levels a statute
  is filed under (Federal default: `Title, Chapter, Subchapter, Part`; states:
  just `Chapter`). The user adds / removes / reorders them for federal law in
  the sidebar editor. `normalizeParts` trims, de-duplicates case-insensitively,
  and guarantees the **`Chapter` anchor is always present** — it is the level
  that groups sections and cannot be removed.
- **Chapter** — the unit that groups sections. Its display designation is
  `partPath(jurisdiction, partValues)` (e.g. `"Title 42 · Chapter 21"`), and its
  identity within a jurisdiction is `chapterSignature` (the full part path), so
  `Title 42 Chapter 21` and `Title 15 Chapter 21` are different chapters. The
  Chapter part's value is the required "chapter number".
- **Section** — `{ id, number, title, body }`. `body` is the raw, normalized
  paste. `number` is required and unique within its chapter.

Constants and helpers in `src/core/model.js`: `ANCHOR` (`"Chapter"`), `UNKNOWN`,
`FEDERAL_PARTS`, `partValuesOf`, `chapterSignature`, `partPath`,
`compareChapters`, `chaptersInOrder`, `sortedJurisdictions`, `findJurisdiction`.

### Mutations (all pure, all return a `{ status }` result)

`addSection`, `updateChapter`, `updateSection`, `removeSection`,
`addJurisdiction`, `updateJurisdiction`. Validation lives here (not only in the
events layer): `addSection` returns `invalid` when the Chapter value or the
section number is blank, and `duplicate` when the section number already exists
in that chapter.

## Required fields and defaults

- **Only the chapter number and the section number are required** (plus non-empty
  paste). Chapter/section titles are optional.
- A blank chapter title or section title **defaults to `UNKNOWN`**
  (`cleanTitle` in `model.js`), on add *and* on edit. If a chapter already exists
  with a real title, adding another section never overwrites it — a title
  supplied later only backfills an `UNKNOWN` chapter.

## Invariants

- **Normalize once, then store raw.** `normalizeBody` runs on *Add section* and
  the result is stored. It fixes formatting artifacts only — never wording,
  punctuation, capitalization or citations — and joins soft line wraps back into
  sentences. Highlighting is never baked into stored state; it happens at render.
  Indentation is preserved because clause nesting depends on it.
- **Definitions are chapter-wide.** Every render recomputes
  `chapterDefinitions(chapter)` from *all* sections and applies it to *every*
  section, so a definitions section added later retroactively highlights earlier
  ones. Insertion order is irrelevant.
- **A defining section does not highlight its own definitions** — except where a
  term appears inside a **different** definition in the same section.
- **Matching is case-insensitive but whole-word.**
- **A clause marker is printed once.** `(a)`, `(32)`, … is a bold label sliced
  off the body by matched length (never string-replace).
- **Highlighting is built from the raw text, not by walking text nodes**, so a
  per-match decision is possible and no term is lost at a text-node boundary.
- **Pasted text is never `innerHTML`.** It renders through `textContent` / text
  nodes; HTML escaping exists only for the export template. Editor chrome is
  rendered only on screen, so exports stay clean.
- **Nesting follows the source.** Real leading whitespace wins
  (`depth = round((indent − base) / unit)`, `unit = gcd` of positive indents and
  must be `≥ 2`); without usable indentation it falls back to clause-marker
  inference (`markerDepth`).
- **One source for document styles.** `styles/doc.css` is linked on screen and
  read back from the CSSOM to be inlined into every export, so preview == export
  without a second copy or an extra request. It stays synchronous so the
  download happens inside the user's click.
- **Section order is natural** (`7-1 < 7-2 < 7-10`); chapters sort by part
  values then title within their jurisdiction.
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
depth, start }]`. `start` is the offset of `text` within the raw body, which lets
the renderer ask location-aware questions (e.g. "is this match inside a different
definition?"). Marker-based depth is approximate for single letters that are also
Roman numerals (`c d i l m v x`).

## Persistence and export

- `src/storage/local.js` centralizes `STORE_KEY`. **Bump the version and add a
  migration in `load()` when the stored shape changes.** Both accessors swallow
  errors so a sandboxed origin still works.
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
- `{ type: "jurisdiction", key: <key|null>, draft: { name, kind, parts, newPart } }`
  (`key: null` means "adding"; the editor renders at the top of the sidebar).
  Because reordering/adding a part re-renders the form, the live name/kind/new-part
  inputs are stashed on the editing object (`_name`, `_kind`, `_newPart`) so the
  handlers in `events.js` can flush what the user typed (`flushJurisdictionDraft`).

The composer's extra organization inputs (`#parts`) are rebuilt only when the
selected jurisdiction or its part list changes (`partSignature` guard), so an
unrelated re-render never wipes text mid-typing. Read them with `readPartFields()`
and clear with `clearPartFields()`.

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
- **Marker nesting is approximate** for letter/Roman ambiguities.
- **Unwrapping has two approximations**: a title-case heading on the line right
  after prose (no blank line, not ALL CAPS) is joined; a hyphen split whose
  fragment is not a recognized word ending (`ex-pected`) keeps the hyphen. Both
  are biased toward not altering wording.
- **Removed part types keep their values.** `updateJurisdiction` normalizes the
  part list but leaves orphaned `partValues` in place, so re-adding a type
  restores them. Two chapters can therefore show the same path if a type that
  distinguished them is removed.
- **States can technically hold extra parts** (the model allows it); the UI only
  exposes the organization editor for federal jurisdictions.
- **No delete control** for sections/jurisdictions; `removeSection` exists as a
  model primitive only.
