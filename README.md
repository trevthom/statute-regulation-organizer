# Chapter Builder

Paste the wording of statutes/regulations and get one clean, sorted HTML
"document" per chapter — with automatic highlighting of defined terms and
automatic clause nesting.

Vanilla JavaScript, ES modules, **no framework, no bundler, no npm, no build
step**. For how the code is put together, the data model, and the rules to keep
intact while editing, see [`AGENTS.md`](./AGENTS.md).

## Run it

ES modules do not load over `file://` (CORS), so serve the folder statically.
Any static server works; with Python installed, one line is enough:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

Other equivalents: `npx serve .`, `php -S localhost:8000`, or any static host.

> Opening `index.html` directly with `file://` will **not** work — the module
> imports are blocked.

## Using it

The library is organized as **jurisdiction → chapter → section**. The sidebar
groups everything by jurisdiction: **Federal law** is one group, and every
**state** you add is another.

- **Add a jurisdiction** with *Add jurisdiction* in the sidebar. Give it a name
  (e.g. `Kentucky`) and choose State or Federal. You can edit it later with the
  *Edit* button on its group header.
- **Federal organization.** Federal statutes are often filed under several
  levels. For a Federal jurisdiction, the editor lists its organization parts
  (by default `Title`, `Chapter`, `Subchapter`, `Part`) top to bottom. Add your
  own part (e.g. `Subtitle`, `Subpart`), remove one, or reorder them with the
  arrow buttons. `Chapter` is the anchor and cannot be removed. The order set
  here is the order used everywhere the parts are shown and sorted.
- **Add a section.** *Only the chapter number and the section number are
  required.* Chapter and section titles are optional — **if you leave a title
  blank it defaults to `UNKNOWN`** (you can fill it in later with *Edit*).
- Pick the jurisdiction, enter the chapter number, and fill in any organization
  parts the jurisdiction defines (e.g. `Title 42`, `Subchapter IV`). Federal
  chapters are identified by their full path, so `Title 42, Chapter 21` and
  `Title 15, Chapter 21` are separate chapters.
- The paste box takes *only* the wording of the statute or regulation — no
  section number, no section title, no chapter heading. Nothing is detected or
  parsed out of the paste; all of it is stored as this section's text, cleaned
  up on **Add section**.
- **Edit a chapter** with the *Edit* button next to it in the sidebar — that
  changes its organization parts (chapter number, title, etc.) and its title.
- **Edit a section** with the *Edit* button on its heading — that changes its
  number and title. The chapter re-sorts automatically.
- **Enter** saves an inline editor, **Escape** (or *Cancel*) discards it.
- A change that would collide with an existing chapter or section number is
  refused with a message, and the editor stays open so it can be fixed.
- **Export chapter** / **Export all** download standalone, styled HTML files
  (named by jurisdiction and organization path, e.g. `federal-42-21-IV.html`).
  **Load sample** loads demo data; **Clear all** empties the library.

## What it does with the text

- **Term highlighting.** Definitions are collected across the whole chapter, so
  a definitions section added later retroactively highlights the term in earlier
  sections. Matching is case-insensitive but whole-word, and a section never
  highlights a term inside its own definition.
- **Clause nesting.** Numbered/lettered clauses are indented and their markers
  printed once, following the paste's own indentation when present.
- **Cleanup.** CRLF newlines, hard spaces, stray tabs, space runs, blank-line
  piles and mid-sentence line wraps are repaired on *Add section* — without ever
  altering wording, punctuation, capitalization or citations.

## Tests

Node's built-in test runner, no dependencies:

```sh
node --test tests/core.test.js tests/dom.test.js
```

`core.test.js` covers the pure logic; `dom.test.js` boots the real app against
the real `index.html` through a tiny DOM shim and drives it like a user. See
[`AGENTS.md`](./AGENTS.md) for details.
