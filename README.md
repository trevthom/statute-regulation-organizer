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
groups everything by jurisdiction, and comes prepopulated with **Federal law and
all 50 states** — pick one from the *Jurisdiction* drop-down, or *Add
jurisdiction* for anything else. A jurisdiction's name and kind (State or
Federal) can be changed later with the *Edit* button on its group header.

Statutes are filed through one fixed hierarchy, from the outermost level down:

```
Title
  └─ [Subtitle]
       └─ [Division]
            └─ [Chapter]
                 └─ [Subchapter]
                      └─ [Part]
                           └─ [Subpart]
                                └─ [Section]
                                     └─ [Subsection]
```

- **Only the Title and the section number are required.** The Title is a
  drop-down that offers exactly the numbers **1 to 50** (a state's required
  level is its Chapter, typed in); the section number is typed in below.
- Every bracketed level is optional: **tick the box** for the levels that apply
  and give each one its code — **up to 2 letters or numbers** (`21`, `IV`, `A`).
  The codes are what organizes the statute, and a chapter is identified by its
  full path, so `Title 42, Chapter 21` and `Title 15, Chapter 21` are separate
  chapters while `Title 42, Chapter 21, Subchapter IV` is a third.
- The Title and the codes stay in the form after a section is added, so a
  further statute in the same place only needs its number and wording.
- **Everything else is optional** — the section title and the chapter's own
  title. **If you leave a title blank it defaults to `UNKNOWN`** (fill it in
  later with *Edit*).
- The paste box takes *only* the wording of the statute or regulation — no
  section number, no section title, no chapter heading. Nothing is detected or
  parsed out of the paste; all of it is stored as this section's text, cleaned
  up on **Add section**.
- **Edit a chapter** with the *Edit* button next to it in the sidebar — that
  changes its organization (the same tree) and its title.
- **Edit a section** with the *Edit* button on its heading — that changes its
  number and title. The chapter re-sorts automatically.
- **Enter** saves an inline editor, **Escape** (or *Cancel*) discards it.
- A section cannot be added without a Title and a section number: *Add section*
  names what is missing and adds nothing. A change that would collide with an
  existing chapter or section number is refused too, and the editor stays open so
  it can be fixed.
- **Export chapter** / **Export all** download standalone, styled HTML files
  (named by jurisdiction and organization path, e.g. `federal-42-21-IV.html`).
  **Load sample** loads demo data; **Clear all** empties the library.

## What it does with the text

- **Term highlighting.** Definitions are collected across the whole chapter, so
  a definitions section added later retroactively highlights the term in earlier
  sections. Matching is case-insensitive but whole-word, and a section never
  highlights a term inside its own definition.
- **Clause nesting.** Each nesting level is indented one step further than the
  one it sits in — the clause in the body's own margin, a subclause one step in,
  a subclause inside that two — following the paste's own indentation when
  present and the clause markers when it is not. A marker (`(a)`, `(ii)`) is
  printed once and always followed by a space.
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
