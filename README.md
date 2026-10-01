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
all 50 states**. Jurisdictions are a fixed list — a state's name and whether it
is State or Federal can't be changed, and there is nothing to add.

The composer is one **organization layer**: first a jurisdiction picker —
*Federal*, or *State* plus which state — then the fixed hierarchy, one row per
level, from the outermost down:

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

- **Every level is opt-in**, including **Section** — nothing is preselected.
  Section is the one you must tick, because it carries the section number.
  Nothing else is automatic — a federal **Title is not required**, because not
  every state has one. Tick the checkbox for the levels that apply, type their
  value, and optionally a title in the box beside it.
- A **value** may be up to **12 characters**: letters, numbers, parentheses and
  hyphens (`42`, `IV`, `12-1`, `(a)`). A ticked level must have one; a level you
  leave unticked contributes nothing.
- The levels you tick are how the statute is filed. Within a jurisdiction a
  chapter is identified by its chapter levels, so `Title 42, Chapter 21` and
  `Title 15, Chapter 21` are separate chapters, `Title 42, Chapter 21,
  Subchapter IV` is a third — and another statute with the same levels and
  values joins the same one. Drafted values stay in the form after a section is
  added, so a run of sections in one place only needs its number and wording.
- **Section** holds the section number (required) and its title; **Subsection**
  is an optional deeper designation, so `§ 1983(a)` and `§ 1983(b)` can live in
  the same chapter.
- The paste box takes *only* the wording of the statute or regulation — no
  section number, no section title, no heading. Nothing is detected or parsed
  out of the paste; all of it is stored as this section's text, cleaned up on
  **Add section**.
- **Edit** (next to a chapter in the sidebar) fixes the chapter levels after
  the fact — for instance if you forgot one.
- **Edit a section** with the *Edit* button on its heading — that changes its
  number, title and subsection. The chapter re-sorts automatically.
- **Enter** saves an inline editor, **Escape** (or *Cancel*) discards it.
- A section cannot be added without a section number (or its wording, or the
  state when the statute is filed under a state): *Add section* names what is
  missing and adds nothing. A change that would collide with an existing chapter
  path or section designation is refused too, and the editor stays open so it can
  be fixed.
- **Export chapter** / **Export all** download standalone, styled HTML files
  (named by jurisdiction and organization path, e.g. `federal-42-21-IV.html`).
  **Clear all** empties the library.

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
