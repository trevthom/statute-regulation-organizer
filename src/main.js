/* Bootstrap: load persisted state, wire events, first render. */

import { load, save } from "./storage/local.js";
import { emptyState } from "./core/model.js";
import { renderActive } from "./ui/render.js";
import { initEvents } from "./ui/events.js";

const saved = load();
let state = (saved && Array.isArray(saved.chapters)) ? saved : emptyState();

function render() {
  renderActive(state, selectChapter);
}

function selectChapter(key) {
  state.activeKey = key;
  save(state);
  render();
}

initEvents({
  getState: () => state,
  setState: (next) => { state = next; },
  render
});

render();
