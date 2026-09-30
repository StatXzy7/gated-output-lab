// 无第三方依赖的最小 DOM 垫片，把 public/app.js 放进模拟页面运行，
// 真实模拟“输入错误 → 修正恢复 → 切换粒度 → 暂停门控 → 重置”的控件交互。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  toggle(c, force) {
    const has = this.set.has(c);
    const want = force === undefined ? !has : !!force;
    want ? this.set.add(c) : this.set.delete(c);
    return want;
  }
  contains(c) { return this.set.has(c); }
}

let activeElement = null;

class El {
  constructor(tag, id) {
    this.tagName = tag.toUpperCase();
    this.id = id || '';
    this.classList = new ClassList();
    this.attrs = {};
    this.children = [];
    this.parent = null;
    this.listeners = {};
    this._textContent = '';
    this._value = '';
    this._innerHTML = '';
    this.hidden = false;
    this.checked = false;
    this.type = tag === 'textarea' ? 'textarea' : '';
    this.rows = 1;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  fire(t, ev = {}) {
    ev.target ||= this;
    // 模拟冒泡：目标 -> 祖先（app.js 在容器上做事件委托）
    const chain = [];
    let node = this;
    while (node) { chain.push(node); node = node.parent; }
    for (const el of chain) (el.listeners[t] || []).forEach((fn) => fn(ev));
  }
  fireClick() { this.fire('click', { target: this }); }
  set textContent(v) {
    this._textContent = String(v);
    if (v === '') this.children = [];
  }
  get textContent() {
    return this.children.length ? this.children.map((c) => c.textContent).join('') : this._textContent;
  }
  set value(v) { this._value = String(v); }
  get value() { return this._value; }
  set innerHTML(html) {
    this._innerHTML = String(html);
    this.children = [];
    this._textContent = '';
    if (this.id === 'editors') buildEditorsFromHtml(this, html);
    if (this.id === 'mode-prompt') buildPromptFromHtml(this, html);
  }
  get innerHTML() { return this._innerHTML; }
  _walk(cb) {
    for (const c of this.children) {
      cb(c);
      c._walk(cb);
    }
  }
  _match(token) {
    // 支持复合 token：.editor[data-key="Q"]、div.editor 等
    const parts = token.match(/[.#]?[\w-]+|\[[^\]]+\]/g) || [];
    for (const part of parts) {
      if (part.startsWith('#')) {
        if (this.id !== part.slice(1)) return false;
      } else if (part.startsWith('.')) {
        if (!this.classList.contains(part.slice(1))) return false;
      } else if (part.startsWith('[')) {
        const m = part.match(/^\[([\w-]+)(?:=["']?([^"'\]]+?)["']?)?\]$/);
        if (!m || !Object.prototype.hasOwnProperty.call(this.attrs, m[1])) return false;
        if (m[2] !== undefined && this.attrs[m[1]] !== m[2]) return false;
      } else {
        if (this.tagName !== part.toUpperCase()) return false;
      }
    }
    return parts.length > 0;
  }
  _find(tokens) {
    let roots = this ? [this] : [];
    let all = [];
    this._walk((el) => all.push(el));
    let pool = all;
    for (const tok of tokens) {
      pool = pool.filter((el) => el._match(tok));
    }
    return pool;
  }
  querySelector(sel) { return this._find(sel.trim().split(/\s+/).filter(Boolean)).filter((el) => el !== this)[0] || null; }
  querySelectorAll(sel) {
    if (sel === 'input[name="mode"]') return this._modeRadios || [];
    return this._find(sel.trim().split(/\s+/).filter(Boolean)).filter((el) => el !== this);
  }
  focus() { activeElement = this; }
}

// 极小模板解析：只处理 app.js 生成的编辑器结构
function buildEditorsFromHtml(host, html) {
  const blocks = html.split('data-key="').slice(1);
  for (const block of blocks) {
    const key = block.slice(0, block.indexOf('"'));
    const wrap = new El('div');
    wrap.setAttribute('data-key', key);
    wrap.classList.add('editor');
    const ta = new El('textarea');
    ta.setAttribute('id', `ta-${key}`);
    const err = new El('div');
    err.classList.add('editor-err');
    wrap.appendChild(ta);
    wrap.appendChild(err);
    host.appendChild(wrap);
  }
}
function buildPromptFromHtml(host, html) {
  host.hidden = html.trim() === '';
  if (!html.trim()) return;
  for (const act of ['rebuild', 'preserve', 'cancel']) {
    if (html.includes(`data-act="${act}"`)) {
      const b = new El('button');
      b.setAttribute('data-act', act);
      b._textContent = act;
      host.appendChild(b);
    }
  }
}

async function loadApp() {
  const byId = new Map();
  const mk = (tag, id) => { const e = new El(tag, id); byId.set(id, e); return e; };
  const editors = mk('div', 'editors');
  const results = mk('div', 'results');
  const status = mk('div', 'status');
  const prompt = mk('div', 'mode-prompt');
  const gated = mk('input', 'gated');
  gated.type = 'checkbox';
  const reset = mk('button', 'reset');
  const radios = ['scalar', 'vector'].map((v) => {
    const r = new El('input');
    r.type = 'radio';
    r.setAttribute('name', 'mode');
    r.setAttribute('value', v);
    r._value = v; // 原生 input 的 value 属性初始等于 value attribute
    return r;
  });

  const documentStub = {
    getElementById: (id) => byId.get(id) || null,
    querySelectorAll: (sel) => (sel === 'input[name="mode"]' ? radios : []),
    get activeElement() { return activeElement; },
  };

  const context = { console };
  context.window = context;
  context.document = documentStub;

  vm.createContext(context);
  const linker = async (spec, referencing) => {
    let fileUrl;
    if (spec.startsWith('/src/')) {
      fileUrl = pathToFileURL(path.join(ROOT, spec)).href;
    } else {
      fileUrl = new URL(spec, referencing.identifier).href;
    }
    const file = fileURLToPath(fileUrl);
    const code = readFileSync(file, 'utf8');
    const m = new vm.SourceTextModule(code, { identifier: fileUrl, context });
    await m.link(linker);
    await m.evaluate();
    return m;
  };

  const appCode = readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
  const app = new vm.SourceTextModule(appCode, {
    identifier: pathToFileURL(path.join(ROOT, 'public/app.js')).href,
    context,
  });
  await app.link(linker);
  await app.evaluate();

  const ta = (key) => editors.querySelector(`#ta-${key}`);
  return { editors, results, status, prompt, gated, reset, radios, ta };
}

test('UI 冒烟：初始渲染包含完整区块', async () => {
  const ui = await loadApp();
  assert.match(ui.results.innerHTML, /最终投影/);
  assert.match(ui.results.innerHTML, /注意力权重/);
  assert.ok(ui.ta('Q'));
  assert.equal(ui.gated.checked, true);
});

test('UI 交互：错误标红且保留旧结果，修复后恢复（真实 input 事件）', async () => {
  const ui = await loadApp();
  const qWrap = ui.editors.querySelector('.editor[data-key="Q"]');
  const before = ui.results.innerHTML;

  ui.ta('Q').value = '1 2 3\n4 5 6\n7 8 9'; // 缺一列
  ui.ta('Q').fire('input');
  assert.ok(qWrap.classList.contains('invalid'));
  assert.match(ui.status.innerHTML, /输入错误/);
  assert.match(ui.status.innerHTML, /上次有效结果/);
  assert.equal(ui.results.innerHTML, before); // 结果未被错误覆盖
  assert.match(ui.ta('Q').value, /1 2 3/);    // 错误文本保留

  // 边输入边聚焦：syncEditors 不得覆盖正在编辑的文本
  ui.ta('Q').focus();
  ui.ta('Q').value = '1 2';
  ui.ta('Q').fire('input');
  assert.equal(ui.ta('Q').value, '1 2');

  ui.ta('Q').value = '2 0 0 1\n0 1 1 0\n0.5 -0.5 0.5 0.5';
  ui.ta('Q').fire('input');
  assert.ok(!qWrap.classList.contains('invalid'));
  assert.match(ui.status.innerHTML, /门控：开启/);
  assert.notEqual(ui.results.innerHTML, before);
});

test('UI 交互：切到向量门出现选择条，选“重建”后图表分块；暂停门控显示基线；重置还原', async () => {
  const ui = await loadApp();

  ui.radios.find((r) => r.attrs.value === 'vector').fire('change');
  assert.equal(ui.prompt.hidden, false);
  assert.match(ui.prompt.innerHTML, /重建/);
  assert.match(ui.results.innerHTML, /整头标量门/); // 切换前结果仍是标量

  ui.prompt.querySelector('[data-act="rebuild"]').fireClick();
  assert.equal(ui.prompt.hidden, true);
  assert.match(ui.results.innerHTML, /逐元素向量门/);
  assert.match(ui.results.innerHTML, /h1\.f1/);

  // 选择“保留”路径：vector -> scalar 截断提示
  ui.radios.find((r) => r.attrs.value === 'scalar').fire('change');
  ui.prompt.querySelector('[data-act="preserve"]').fireClick();
  assert.match(ui.status.innerHTML, /截断|前 /);

  // 暂停门控
  ui.gated.checked = false;
  ui.gated.fire('change');
  assert.match(ui.results.innerHTML, /门控已暂停/);
  assert.match(ui.status.innerHTML, /暂停/);

  // 重置
  ui.reset.fireClick();
  assert.equal(ui.gated.checked, true);
  assert.match(ui.results.innerHTML, /整头标量门/);
  assert.equal(ui.prompt.hidden, true);
});
