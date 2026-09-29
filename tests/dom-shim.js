/* Minimal DOM shim so the browser-only modules (src/ui/*, src/storage/local.js,
   src/export/html.js) and the real index.html can be exercised headlessly in
   Node with zero dependencies.

   It implements only what those modules use and is NOT a general-purpose DOM.
   Notable simplification: inline `style` is kept as a plain object and is not
   serialized into outerHTML (the tests read element.style directly instead). */

import { readFileSync } from "node:fs";

export const SHOW_TEXT = 4;

let store = new Map();
let blobs = [];
let downloads = [];

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

class ClassList {
  constructor(node) { this.node = node; }
  _list() { return String(this.node._className || "").split(/\s+/).filter(Boolean); }
  _set(list) { this.node._className = list.join(" "); }
  contains(c) { return this._list().includes(c); }
  add(c) { const l = this._list(); if (!l.includes(c)) l.push(c); this._set(l); }
  remove(c) { this._set(this._list().filter((x) => x !== c)); }
  get value() { return this.node._className; }
}

class TextNode {
  constructor(v) { this.nodeType = 3; this.nodeValue = String(v); this.parentNode = null; }
  get textContent() { return this.nodeValue; }
  set textContent(v) { this.nodeValue = String(v); }
}

class Fragment {
  constructor() { this.nodeType = 11; this.childNodes = []; this.parentNode = null; }
  appendChild(n) { if (n.parentNode) n.remove(); n.parentNode = this; this.childNodes.push(n); return n; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(""); }
}

class Element {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.style = {};
    this._className = "";
    this.classList = new ClassList(this);
    this.value = "";
    this._listeners = Object.create(null);
  }
  get className() { return this._className; }
  set className(v) { this._className = v == null ? "" : String(v); }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get innerHTML() { return this.childNodes.map((c) => (c.nodeType === 3 ? esc(c.nodeValue) : c.outerHTML)).join(""); }
  set innerHTML(v) {
    if (v !== "" && v != null) throw new Error('shim: innerHTML parsing is not implemented (only clearing with "")');
    this.childNodes = [];
  }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(v) { this.childNodes = []; if (v != null && v !== "") this.appendChild(new TextNode(v)); }
  appendChild(n) {
    if (n.nodeType === 11) { for (const k of n.childNodes.slice()) this.appendChild(k); n.childNodes = []; return n; }
    if (n.parentNode) n.remove();
    n.parentNode = this;
    this.childNodes.push(n);
    return n;
  }
  removeChild(n) { this.childNodes = this.childNodes.filter((c) => c !== n); n.parentNode = null; return n; }
  replaceChild(next, old) {
    const i = this.childNodes.indexOf(old);
    if (i === -1) throw new Error("replaceChild: node is not a child");
    if (next.nodeType === 11) {
      const kids = next.childNodes.slice();
      next.childNodes = [];
      for (const k of kids) k.parentNode = this;
      this.childNodes.splice(i, 1, ...kids);
    } else {
      if (next.parentNode) next.remove();
      next.parentNode = this;
      this.childNodes[i] = next;
    }
    old.parentNode = null;
    return old;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  focus() { globalThis.document.activeElement = this; }
  addEventListener(type, fn) { (this._listeners[type] || (this._listeners[type] = [])).push(fn); }
  dispatch(type, extra) {
    const event = { type, target: this, preventDefault() {}, ...extra };
    return (this._listeners[type] || []).slice().map((fn) => fn(event));
  }
  click() { if (this.tagName === "A") downloads.push({ href: this.href, download: this.download }); }
  get outerHTML() {
    const tag = this.tagName.toLowerCase();
    const cls = this._className ? ' class="' + this._className + '"' : "";
    const inner = this.childNodes.map((c) => (c.nodeType === 3 ? esc(c.nodeValue) : c.outerHTML)).join("");
    return "<" + tag + cls + ">" + inner + "</" + tag + ">";
  }
}

class TreeWalker {
  constructor(root) {
    this._nodes = [];
    const collect = (n) => {
      if (n.nodeType === 3) { this._nodes.push(n); return; }
      for (const c of n.childNodes || []) collect(c);
    };
    collect(root);
    this._i = -1;
    this.currentNode = null;
  }
  nextNode() {
    this._i++;
    if (this._i < this._nodes.length) { this.currentNode = this._nodes[this._i]; return this.currentNode; }
    return null;
  }
}

class Document {
  constructor() { this._byId = new Map(); this.body = new Element("body"); this.styleSheets = []; }
  createElement(tag) { return new Element(tag); }
  createTextNode(text) { return new TextNode(text); }
  createDocumentFragment() { return new Fragment(); }
  createTreeWalker(root) { return new TreeWalker(root); }
  register(id, tag) { const e = new Element(tag || "div"); e.id = id; this._byId.set(id, e); return e; }
  getElementById(id) {
    const e = this._byId.get(id);
    if (!e) throw new Error("getElementById(" + JSON.stringify(id) + "): no such id — is it missing from index.html?");
    return e;
  }
}

/* Install a fresh window-ish environment. Call this BEFORE importing src/main.js. */
export function installDom() {
  store = new Map();
  blobs = [];
  downloads = [];

  const document = new Document();
  const docCssUrl = new URL("../styles/doc.css", import.meta.url);
  document.styleSheets = [{ href: docCssUrl.href, cssRules: [{ cssText: readFileSync(docCssUrl, "utf8") }] }];

  const ids = [...readFileSync(new URL("../index.html", import.meta.url), "utf8")
    .matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const tags = {
    paste: "textarea", jurisdiction: "select", chNum: "input", chTitle: "input",
    secNum: "input", secTitle: "input", parts: "div"
  };
  for (const id of ids) document.register(id, tags[id]);

  globalThis.document = document;
  globalThis.NodeFilter = { SHOW_TEXT };
  globalThis.confirm = () => true;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear()
  };
  globalThis.Blob = class { constructor(parts, opts = {}) { this.parts = parts; this.type = opts.type; } };
  URL.createObjectURL = (b) => { blobs.push(b); return "blob:test-" + (blobs.length - 1); };
  URL.revokeObjectURL = () => {};

  return {
    document,
    ids,
    get store() { return store; },
    get blobs() { return blobs; },
    get downloads() { return downloads; },
    savedState() {
      const raw = store.get("chapterBuilder.v1");
      return raw ? JSON.parse(raw) : null;
    },
    exportedHtml(i) {
      const b = blobs[i == null ? blobs.length - 1 : i];
      return b ? b.parts.join("") : null;
    }
  };
}
