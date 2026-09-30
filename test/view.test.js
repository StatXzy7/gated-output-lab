import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/core/store.js';
import { resultsHtml, statusHtml, editorSpecs, heatmapSvg, gateSvg, tableHtml, fmt } from '../src/core/view.js';

test('fmt 对非有限值显示明确文字而非静默渲染', () => {
  assert.equal(fmt(NaN), 'NaN');
  assert.equal(fmt(Infinity), 'Inf');
  assert.equal(fmt(-Infinity), '-Inf');
  assert.equal(fmt(-0), '0');
  assert.equal(fmt(0.123456), '0.1235');
});

test('热力图 SVG 标记屏蔽格，普通格显示数值', () => {
  const svg = heatmapSvg([[0.1, -0.2], [0, 0.3]], { mask: [[1, 1], [1, 0]] });
  assert.match(svg, /^<svg/);
  assert.match(svg, /屏蔽/);
  assert.match(svg, /0\.1/);
  assert.match(svg, /hsl\(222/); // 负值蓝色相
});

test('完整结果页包含权重/门分数/门前门后/投影/基线/差值各区块', () => {
  const store = createStore();
  const html = resultsHtml(store.getState());
  assert.match(html, /注意力权重/);
  assert.match(html, /门 sigmoid 分数/);
  assert.match(html, /门前头输出/);
  assert.match(html, /门后头输出/);
  assert.match(html, /最终投影/);
  assert.match(html, /无门基线/);
  assert.match(html, /差值/);
  // 全屏蔽行标记
  assert.match(html, /全屏蔽=0/);
});

test('门暂停时门图显示基线说明且差值表为 0', () => {
  const store = createStore();
  store.setGated(false);
  const s = store.getState();
  assert.match(gateSvg(s.result), /门控已暂停/);
  assert.match(statusHtml(s), /暂停/);
  assert.match(resultsHtml(s), /门控已暂停/);
});

test('错误状态页给出明确中文状态与“上次有效结果”说明', () => {
  const store = createStore();
  store.edit('Q', '1 2 3\n4 5 6\n7 8 9');
  const s = store.getState();
  const html = statusHtml(s);
  assert.match(html, /输入错误/);
  assert.match(html, /上次有效结果/);
  const specs = editorSpecs(s);
  const q = specs.find((e) => e.key === 'Q');
  assert.ok(q.error);
  assert.match(q.error, /形状/);
  // Wg/bg 标记为门专用
  assert.ok(specs.find((e) => e.key === 'Wg').gatedOnly);
});

test('tableHtml 屏蔽格与全屏蔽行徽标渲染', () => {
  const html = tableHtml([[1, 2], [3, 4]], { mask: [[1, 0], [1, 1]], rowBadges: [false, true] });
  assert.match(html, /屏蔽/);
  assert.match(html, /全屏蔽=0/);
  assert.match(html, /badgerow/);
});

test('逐元素模式门图按头分块标注 h1.f1 等', () => {
  const store = createStore();
  store.requestMode('vector');
  store.applyMode('vector', 'rebuild');
  const svg = gateSvg(store.getState().result);
  assert.match(svg, /逐元素向量门/);
  assert.match(svg, /h1\.f1/);
  assert.match(svg, /h2\.f2/);
});
