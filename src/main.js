/* Bootstrap: load persisted state, wire events, first render. */

import { load, save } from "./storage/local.js";
import { emptyState } from "./core/model.js";
import { renderActive } from "./ui/render.js";
import { initEvents } from "./ui/events.js";

const saved = load();
let state = (saved && Array.isArray(saved.chapters)) ? saved : emptyState();

/* UI-only state, never persisted: which inline editor is open, if any. */
const view = { editing: null };

const app = {
  getState: () => state,
  setState: (next) => { state = next; },
  getView: () => view,
  save: () => save(state),
  render: () => renderActive(state, view, handlers)
};

const handlers = initEvents(app);

app.render();
