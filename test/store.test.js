import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, makeInitialState, randomGateParams } from '../src/core/store.js';
import { matrixToText } from '../src/core/parse.js';
import { CONFIG } from '../src/core/schema.js';

test('固定种子默认数据确定，且包含一个全屏蔽查询行', () => {
  const a = makeInitialState();
  const b = makeInitialState();
  assert.equal(matrixToText(a.params.Q), matrixToText(b.params.Q));
  assert.equal(matrixToText(a.params.Wg), matrixToText(a.params.Wg));
  assert.deepEqual(a.params.mask[CONFIG.numQueries - 1], new Array(CONFIG.numKeys).fill(0));
  // 其余行至少有一个允许键
  for (let i = 0; i < CONFIG.numQueries - 1; i++) {
    assert.ok(a.params.mask[i].some((v) => v === 1));
  }
});

test('非法编辑不覆盖上次有效结果，修复后自动恢复（模拟控件输入）', () => {
  const store = createStore();
  const events = [];
  store.subscribe((s) => events.push(s));

  const good = store.getState().result.projected;
  assert.ok(good);

  // 用户把 Q 改成形状错误（删了一列）
  const badText = '1 0 0\n0 1 1\n0.5 -0.5 0.5';
  store.edit('Q', badText);
  let s = store.getState();
  assert.match(s.errors.Q.message, /形状/);
  assert.equal(s.stale, true);
  // 上次有效结果仍在，且 Q 参数未被覆盖
  assert.deepEqual(s.result.projected, good);
  assert.equal(s.params.Q[0].length, CONFIG.dModel);

  // 文本框保留错误内容（用户可继续编辑）
  assert.equal(s.drafts.Q, badText);

  // 再输入非有限 token
  store.edit('Q', '1 NaN 0 1\n0 1 1 0\n0.5 -0.5 0.5 0.5');
  s = store.getState();
  assert.match(s.errors.Q.message, /有限/);
  assert.deepEqual(s.result.projected, good);

  // 修正：结果更新且错误清除
  const newText = '2 0 0 1\n0 1 1 0\n0.5 -0.5 0.5 0.5';
  store.edit('Q', newText);
  s = store.getState();
  assert.deepEqual(s.errors, {});
  assert.equal(s.stale, false);
  assert.notDeepEqual(s.result.projected, good);
  assert.equal(s.params.Q[0][0], 2);
  assert.ok(events.length >= 3);
});

test('mask 非法值（0/1 之外）报错且不覆盖', () => {
  const store = createStore();
  const before = store.getState().params.mask;
  store.edit('mask', '1 1 1 1\n1 1 1 1\n9 0 0 0');
  const s = store.getState();
  assert.match(s.errors.mask.message, /0.*1|屏蔽/);
  assert.deepEqual(s.params.mask, before);
  assert.equal(s.result.allMasked[2], true);
});

test('暂停门控：差值为零且门编辑器停用；恢复后差值回来', () => {
  const store = createStore();
  store.setGated(false);
  let s = store.getState();
  assert.equal(s.gated, false);
  for (const row of s.result.diff) for (const d of row) assert.equal(d, 0);
  assert.equal(s.result.gateProbs, null);
  store.setGated(true);
  s = store.getState();
  const someDiff = s.result.diff.flat().some((d) => Math.abs(d) > 1e-9);
  assert.ok(someDiff);
});

test('切换粒度需显式选择：重建用固定种子；保留按前缀补零/截断', () => {
  const store = createStore();
  // scalar(4x2, bg 长度2) -> vector(4x4)
  store.requestMode('vector');
  let s = store.getState();
  assert.ok(s.pendingMode);
  assert.equal(s.pendingMode.mode, 'vector');
  assert.equal(s.mode, 'scalar'); // 尚未真正切换

  // 取消则维持原状
  store.cancelMode();
  assert.equal(store.getState().pendingMode, null);
  assert.equal(store.getState().mode, 'scalar');

  // 保留策略
  store.requestMode('vector');
  const scalarWg = store.getState().params.Wg.map((r) => [...r]);
  const scalarBg = [...store.getState().params.bg];
  store.applyMode('vector', 'preserve');
  s = store.getState();
  assert.equal(s.mode, 'vector');
  assert.equal(s.params.Wg[0].length, 4);
  for (let r = 0; r < 4; r++) {
    assert.equal(s.params.Wg[r][0], scalarWg[r][0]);
    assert.equal(s.params.Wg[r][1], scalarWg[r][1]);
    assert.equal(s.params.Wg[r][2], 0);
    assert.equal(s.params.Wg[r][3], 0);
  }
  assert.deepEqual(s.params.bg.slice(0, 2), scalarBg);
  assert.deepEqual(s.params.bg.slice(2), [0, 0]);
  assert.match(s.modeNote, /置 0/);
  // 补零的门 sigmoid=0.5
  for (let i = 0; i < CONFIG.numQueries; i++) {
    assert.ok(Math.abs(s.result.gateProbs[i][2] - 0.5) < 1e-12);
  }

  // 重建策略：与固定种子生成一致
  store.requestMode('scalar');
  store.applyMode('scalar', 'rebuild');
  s = store.getState();
  const g = randomGateParams('scalar', CONFIG.numHeads);
  assert.deepEqual(s.params.Wg, g.Wg);
  assert.deepEqual(s.params.bg, g.bg);

  // scalar -> vector 重建
  store.requestMode('vector');
  store.applyMode('vector', 'rebuild');
  s = store.getState();
  const gv = randomGateParams('vector', CONFIG.numHeads);
  assert.deepEqual(s.params.Wg, gv.Wg);
  assert.equal(s.params.Wg[0].length, CONFIG.dModel);
  assert.match(s.modeNote, /重建/);
});

test('重置恢复初始固定数据与标量模式', () => {
  const store = createStore();
  store.edit('Q', '2 2 2 2\n2 2 2 2\n2 2 2 2');
  store.requestMode('vector');
  store.applyMode('vector', 'rebuild');
  assert.equal(store.getState().mode, 'vector');
  store.reset();
  const s = store.getState();
  const init = makeInitialState();
  assert.equal(s.mode, 'scalar');
  assert.deepEqual(s.params.Q, init.params.Q);
  assert.deepEqual(s.params.Wg, init.params.Wg);
  assert.deepEqual(s.errors, {});
  assert.equal(s.pendingMode, null);
});
