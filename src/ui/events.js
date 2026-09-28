/* All addEventListener wiring. Reads and mutates the app state through the
   small context main.js hands us, and delegates to model / storage / render /
   export so the behavior matches the original single-file script. */

import { parseSection } from "../core/parse.js";
import { addSection, currentChapter, emptyState, sampleData } from "../core/model.js";
import { save } from "../storage/local.js";
import { exportChapter } from "../export/html.js";
import { toast } from "./render.js";

const $ = (id) => document.getElementById(id);

function onAdd(app) {
  const state = app.getState();
  const text = $("paste").value.trim();
  if (!text) { toast("Paste a section first.", "warn"); return; }
  const p = parseSection(text);

  const chapterNumber = ($("chNum").value.trim() || p.chapterNumber || state.activeKey || "Uncategorized");
  const chapterTitle = ($("chTitle").value.trim() || p.chapterTitle || "");
  const number = ($("secNum").value.trim() || p.number || "");
  const title = ($("secTitle").value.trim() || p.title || "");
  const body = p.body || text;

  const result = addSection(state, { chapterNumber, chapterTitle, number, title, body });
  save(state);

  if (result.status === "duplicate") {
    app.render();
    toast("Section " + number + " is already in Chapter " + result.chapter.key + ".", "warn");
    return;
  }

  $("paste").value = "";
  $("chNum").value = "";
  $("chTitle").value = "";
  $("secNum").value = "";
  $("secTitle").value = "";
  $("detect").textContent = "";
  app.render();
  toast("Added " + (number ? "§ " + number : "section") + " to Chapter " + result.chapter.key + ".", "ok");
}

function onDetect() {
  const v = $("paste").value.trim();
  if (!v) { $("detect").textContent = ""; return; }
  const p = parseSection(v);
  $("detect").textContent = "Detected — Chapter: " + (p.chapterNumber || "—") +
    " · Section: " + (p.number || "—") + " · Title: " + (p.title || "—");
}

export function initEvents(app) {
  $("add").addEventListener("click", () => onAdd(app));
  $("paste").addEventListener("input", onDetect);

  $("xOne").addEventListener("click", () => {
    const ch = currentChapter(app.getState());
    if (!ch) { toast("Nothing to export.", "warn"); return; }
    exportChapter(ch);
  });
  $("xAll").addEventListener("click", () => {
    const chapters = app.getState().chapters;
    if (!chapters.length) { toast("Nothing to export.", "warn"); return; }
    for (const ch of chapters) exportChapter(ch);
  });
  $("sample").addEventListener("click", () => {
    app.setState(sampleData());
    save(app.getState());
    app.render();
    toast("Sample loaded.", "ok");
  });
  $("clear").addEventListener("click", () => {
    if (!app.getState().chapters.length) return;
    if (!confirm("Delete all chapters and sections? This cannot be undone.")) return;
    app.setState(emptyState());
    save(app.getState());
    app.render();
  });
}
