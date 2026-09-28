/* State mutations over plain data. No DOM, no storage: callers own persistence
   and rendering so this module stays easy to unit-test. */

import { naturalCmp } from "./sort.js";

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function emptyState() {
  return { chapters: [], activeKey: null };
}

export function currentChapter(state) {
  return state.chapters.find((c) => c.key === state.activeKey) || state.chapters[0] || null;
}

/* Add a section. Creates the chapter when new, backfills a missing chapter
   title, rejects a duplicate section number, and keeps sections sorted by
   natural order (insertion order is irrelevant). Sets activeKey to the
   affected chapter in both outcomes. Returns a small result description. */
export function addSection(state, { chapterNumber, chapterTitle, number, title, body }) {
  let ch = state.chapters.find((c) => c.key === chapterNumber);
  if (!ch) {
    ch = { key: chapterNumber, title: chapterTitle, sections: [] };
    state.chapters.push(ch);
  } else if (chapterTitle && !ch.title) {
    ch.title = chapterTitle;
  }

  if (number && ch.sections.some((s) => s.number === number)) {
    state.activeKey = ch.key;
    return { status: "duplicate", chapter: ch, number };
  }

  ch.sections.push({ id: uid(), number, title, body });
  ch.sections.sort((a, b) => naturalCmp(a.number, b.number));
  state.activeKey = ch.key;
  return { status: "added", chapter: ch, number };
}

/* Remove a section by id. Exposed as a model primitive; the current UI does
   not wire a delete control, so behavior is unchanged. */
export function removeSection(state, chapterKey, id) {
  const ch = state.chapters.find((c) => c.key === chapterKey);
  if (!ch) return false;
  const i = ch.sections.findIndex((s) => s.id === id);
  if (i === -1) return false;
  ch.sections.splice(i, 1);
  return true;
}

/* Demo data that exercises both fixes: out-of-order sections and definition
   highlighting that applies across sections. */
export function sampleData() {
  return {
    activeKey: "7",
    chapters: [
      {
        key: "7", title: "Public Utilities", sections: [
          {
            id: uid(), number: "7-4", title: "Certificates",
            body: "The authority may issue a certificate of public convenience and necessity only after notice and a hearing."
          },
          {
            id: uid(), number: "7-1", title: "Application",
            body: "This chapter applies to every public utility that receives a certificate of public convenience and necessity.\n(a) The authority shall review each application within 60 days.\n    (1) The authority may request additional information.\n    (2) A decision must issue within the period stated.\n(b) An applicant may appeal a denial as provided in section 7-9."
          },
          {
            id: uid(), number: "7-3", title: "Rate filings",
            body: "(a) Every public utility shall file its rates with the authority.\n(1) A filing must state the net income for the preceding year.\n(2) The authority shall accept or reject each filing within 90 days."
          },
          {
            id: uid(), number: "7-2", title: "Definitions",
            body: "As used in this chapter:\n\u201CAuthority\u201D means the Department of Public Utilities.\n\u201CNet income\u201D means gross income less allowable deductions.\n\u201CCertificate of public convenience and necessity\u201D means an authorization issued under section 7-4."
          }
        ]
      },
      {
        key: "12", title: "Taxation", sections: [
          { id: uid(), number: "12-1", title: "Imposition", body: "A tax is imposed on the net income of every resident." }
        ]
      }
    ]
  };
}
