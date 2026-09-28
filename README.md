# Chapter Builder

Paste sections of statutes/regulations and get one clean, sorted HTML "document"
per chapter — with automatic highlighting of defined terms and automatic clause
nesting. Vanilla JavaScript, ES modules, **no framework, no bundler, no npm, no
build step**.

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

## Layout

```
index.html                  App shell: markup + <script type="module" src="src/main.js">
styles/app.css              Chrome / layout / sidebar / composer styles
styles/doc.css              Document styles (screen + exported files, one source)
src/main.js                 Bootstrap: load state, wire events, first render
src/core/model.js           State mutations: add section, duplicate check, remove, sort-on-add
src/core/parse.js           parseSection, CHAPTER_RE, SECTION_RE
src/core/sort.js            naturalKey, naturalCmp
src/core/definitions.js     isDefinitionSection, extractTerms, chapterDefinitions, buildTermRegex
src/core/nesting.js         indent/marker depth analysis (isRoman, romanVal, markerDepth, predecessor, analyzeBody)
src/ui/render.js            All DOM building: sidebar, chapter, section, body; highlightTerms
src/ui/events.js            All addEventListener wiring
src/storage/local.js        load/save + STORE_KEY
src/export/html.js          exportChapter + download; inlines doc.css into a standalone HTML file
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
`src/export/html.js` touch browser APIs. `src/export/html.js` reuses
`renderChapterContent` from `ui/render.js` so the export and the on-screen
preview come from exactly one markup implementation.

## Invariants

- **`body` is stored raw.** Highlighting happens at render time; highlighted HTML
  is never persisted.
- **Definitions are chapter-wide.** On every render, `chapterDefinitions(chapter)`
  is computed from *all* sections and applied to *every* section, so a
  definitions section pasted later retroactively highlights earlier sections.
  Insertion order is irrelevant.
- **A clause marker is printed once.** `(a)`, `(32)`, … is rendered as a bold
  label and sliced off the body by matched length (not by string replace), which
  fixes the old double-numbering bug.
- **Pasted text is never `innerHTML`.** It renders through `textContent` / text
  nodes. HTML escaping exists only for the export template.
- **Nesting follows the source.** Real leading whitespace wins
  (`depth = round((indent − base) / unit)`, `unit = gcd` of positive indents and
  must be `≥ 2`). Only when the paste has no usable indentation does it fall back
  to clause-marker inference (`markerDepth`).
- **One source for document styles.** `styles/doc.css` is linked on screen and
  read back from the CSSOM (same-origin, already loaded) to be inlined into every
  export, so preview == export without a second copy and without an extra
  request. Keeping it synchronous means the download still happens inside the
  user's click.

## Tests

Node's built-in test runner, no dependencies:

```sh
node --test tests/core.test.js tests/dom.test.js
```

- `tests/core.test.js` unit-tests the pure core: natural sorting
  (`7-1 < 7-2 < 7-10`), parsing, definition extraction, chapter-wide highlighting
  regardless of insertion order, and clause depth for both indented and
  marker-only fixtures.
- `tests/dom.test.js` boots the real `src/main.js` against the real `index.html`
  through a tiny DOM shim and drives it like a user: load sample, paste and add
  sections, reject duplicates, check nesting, export a chapter, export all. It is
  a smoke test, not a browser — it does not render pixels.

## Known limitations / dev notes

- **Exported CSS is the browser's CSSOM serialization** of `styles/doc.css`
  (comments dropped, whitespace normalized) rather than the raw file bytes. It
  is the same stylesheet the screen uses, so the export is styled identically;
  if you ever need byte-identical CSS in exports, switch `docCss()` in
  `src/export/html.js` to `fetch()` the file (that makes export asynchronous).
- **ES modules need a server.** See *Run it* above; `file://` cannot load modules.
- **Definition extraction is heuristic.** Quoted `"X" means/includes` or
  capitalized `X means` only. It will miss valid forms and can produce false
  positives; the extractor is kept conservative. A manual review/edit path would
  be the next improvement.
- **Marker nesting is approximate** for single letters that are also Roman
  numerals (`c d i l m v x`). The predecessor/sequence-continuation logic
  disambiguates most cases but not all.
- **Exports are client-side downloads** (Blob + `<a download>`); one page cannot
  write sibling files on disk. The realistic upgrade is a tiny static/local
  server that writes one file per chapter.
- **Storage schema is versioned** by the centralized `STORE_KEY`. Bump the
  version and add a migration in `load()` when the shape changes.
