// 浏览器 DOM 绑定。所有数学/渲染逻辑来自可被 Node 直接测试的 core 模块。

import { createStore } from '/src/core/store.js';
import { editorSpecs, resultsHtml, statusHtml } from '/src/core/view.js';

const store = createStore();
const editorsEl = document.getElementById('editors');
const resultsEl = document.getElementById('results');
const statusEl = document.getElementById('status');
const promptEl = document.getElementById('mode-prompt');
const gatedEl = document.getElementById('gated');

// 构建编辑器（一次）；之后仅同步 value/错误态，保留撤销栈与焦点
const textareas = new Map();
function buildEditors() {
  const specs = editorSpecs(store.getState());
  editorsEl.innerHTML = specs.map((s) => `
    <div class="editor" data-key="${s.key}">
      <div class="editor-head"><label for="ta-${s.key}">${s.label}</label><span class="want">期望 ${s.want}</span></div>
      <textarea id="ta-${s.key}" rows="${s.kind === 'vector' ? 1 : Math.min(6, s.text.split('\n').length)}" spellcheck="false"></textarea>
      <div class="editor-err"></div>
    </div>`).join('');
  for (const spec of specs) {
    const ta = editorsEl.querySelector(`#ta-${spec.key}`);
    ta.value = spec.text;
    textareas.set(spec.key, ta);
    ta.addEventListener('input', () => store.edit(spec.key, ta.value));
  }
}

function syncEditors(state) {
  for (const spec of editorSpecs(state)) {
    const wrap = editorsEl.querySelector(`.editor[data-key="${spec.key}"]`);
    const ta = textareas.get(spec.key);
    if (document.activeElement !== ta) ta.value = spec.text; // 不打断正在输入
    wrap.classList.toggle('invalid', !!spec.error);
    wrap.classList.toggle('gate-off', spec.gatedOnly && !state.gated);
    wrap.querySelector('.editor-err').textContent = spec.error || '';
  }
}

function renderPrompt(state) {
  const pm = state.pendingMode;
  if (!pm) {
    promptEl.hidden = true;
    promptEl.innerHTML = '';
    return;
  }
  const label = pm.mode === 'scalar' ? '整头标量门' : '逐元素向量门';
  promptEl.hidden = false;
  promptEl.innerHTML = `切换到「${label}」需要改变 Wg/bg 形状（${state.mode} → ${pm.mode}）。请明确选择参数处理方式：
    <button class="primary" data-act="rebuild">重建：固定种子生成新参数</button>
    <button data-act="preserve">保留：复用可容纳的前缀，其余补 0 / 截断</button>
    <button class="danger" data-act="cancel">取消</button>`;
}

function render(state) {
  statusEl.innerHTML = statusHtml(state);
  resultsEl.innerHTML = resultsHtml(state);
  syncEditors(state);
  gatedEl.checked = state.gated;
  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.checked = radio.value === state.mode;
  }
  renderPrompt(state);
}

document.querySelectorAll('input[name="mode"]').forEach((radio) => {
  radio.addEventListener('change', () => store.requestMode(radio.value));
});
gatedEl.addEventListener('change', () => store.setGated(gatedEl.checked));
document.getElementById('reset').addEventListener('click', () => store.reset());
promptEl.addEventListener('click', (e) => {
  const act = e.target.getAttribute('data-act');
  const pm = store.getState().pendingMode;
  if (!act || !pm) return;
  if (act === 'cancel') store.cancelMode();
  else store.applyMode(pm.mode, act);
});

buildEditors();
store.subscribe(render);
render(store.getState());
