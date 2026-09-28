/* Client-side export. A page cannot write sibling files on disk, so each
   chapter becomes a Blob download. The exported file inlines styles/doc.css —
   the same stylesheet the screen links — and the same DOM serialization used
   for preview, so the export is styled identically to what is on screen. */

import { renderChapterContent } from "../ui/render.js";

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* Read the document stylesheet out of the CSSOM. It is same-origin and already
   loaded for the preview, so this needs no request and keeps exportChapter
   synchronous (the download stays inside the user's click). */
export function docCss() {
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      if (sheet.href && /\/styles\/doc\.css(\?|$)/.test(sheet.href)) {
        return Array.from(sheet.cssRules).map((r) => r.cssText).join("\n");
      }
    }
  } catch (e) { /* stylesheet not readable (cross-origin) */ }
  return "";
}

export function exportChapter(ch) {
  const page = renderChapterContent(ch);
  const docTitle = "Chapter " + ch.key + (ch.title ? " — " + ch.title : "");
  const html = "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">\n" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>" + escapeHtml(docTitle) + "</title>\n" +
    "<style>\n" + docCss() + "\n</style></head>\n<body class=\"doc-export\">\n<div class=\"doc\">" + page.outerHTML + "</div>\n</body></html>";
  download(html, "chapter-" + String(ch.key).replace(/[^A-Za-z0-9._-]/g, "_") + ".html");
}

export function download(html, name) {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
