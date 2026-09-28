/* Text cleanup, applied once when a section is added and before it is stored.

   Copy/pasting out of a PDF or a web page brings along CRLF newlines, hard
   spaces, stray tabs, runs of spaces and piles of blank lines. Fixing that here
   keeps the stored body — and therefore the nesting and the export — clean.

   Indentation is deliberately preserved: clause nesting follows real leading
   whitespace, so only *interior* runs of spaces are collapsed. */

const UNICODE_SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;

export function normalizeBody(raw) {
  let text = String(raw == null ? "" : raw);

  text = text.replace(/\r\n?/g, "\n");        // CRLF / lone CR -> LF
  text = text.replace(UNICODE_SPACES, " ");   // NBSP & friends -> plain space

  text = text.split("\n").map((line) => {
    const indent = line.match(/^[ \t]*/)[0];
    const rest = line.slice(indent.length);
    return indent.replace(/\t/g, "    ") + rest.replace(/\t/g, " ").replace(/ {2,}/g, " ");
  }).join("\n");

  text = text.replace(/[ \t]+$/gm, "");       // trailing whitespace per line
  text = text.replace(/\n{3,}/g, "\n\n");     // collapse runs of blank lines

  return text.trim();
}
