/* Splits one pasted blob into its chapter/section header parts and raw body.
   The body is returned exactly as pasted (minus the header line and stray
   blank lines) so it can be stored raw and highlighted at render time. */

export const CHAPTER_RE = /^\s*(?:CHAPTER|Chapter|CH\.|Ch\.)\s+([0-9IVXLCivxlc][0-9A-Za-z.\-]*)\b\s*[—–\-:.]?\s*(.*)$/;
export const SECTION_RE = /^\s*(?:§+\s*|Section\s+|Sec\.\s+)?([0-9]+[A-Za-z]*(?:[.\-][0-9A-Za-z]+)*)\s*[.):]?\s*(.*)$/;

export function parseSection(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  let chapterNumber = "", chapterTitle = "";
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*(?:CHAPTER|Chapter|CH\.|Ch\.)/.test(lines[i])) continue;
    const m = lines[i].match(CHAPTER_RE);
    if (m) {
      chapterNumber = m[1];
      chapterTitle = (m[2] || "").replace(/\s*[.]\s*$/, "").trim();
      lines.splice(i, 1);
      break;
    }
  }

  let number = "", title = "";
  for (let i = 0; i < Math.min(lines.length, 3); i++) {
    const m = lines[i].match(SECTION_RE);
    if (m && m[1]) {
      number = m[1];
      title = (m[2] || "").replace(/\s*[.]?\s*$/, "").trim();
      lines.splice(i, 1);
      break;
    }
  }
  const body = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { chapterNumber, chapterTitle, number, title, body };
}
