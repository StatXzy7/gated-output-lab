import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forward } from '../src/core/forward.js';

// 2 头，dh=2；Q/K/V 均为 4 维。第 3 个查询整行屏蔽。
const base = () => ({
  Q: [[1, 0, 0, 1], [0, 1, 1, 0], [0.5, -0.5, 0.5, 0.5]],
  K: [[1, 0, 1, 0], [0, 1, 0, 1], [1, 1, 0, 0], [0, 0, 1, 1]],
  V: [[1, 2, 3, 4], [2, 1, 4, 3], [-1, 0, 1, 0], [0, -1, 0, 1]],
  mask: [[1, 1, 1, 1], [1, 1, 1, 1], [0, 0, 0, 0]],
  Wo: [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0]],
  bo: [0.1, 0.2, 0.3],
  numHeads: 2,
});

const scalarGate = () => ({
  Wg: [[0, 0], [0, 0], [0, 0], [0, 0]],
  bg: [0, 0],
  mode: 'scalar',
  gated: true,
});

test('无门基线：所有门=0.5 标量时头输出减半，暂停门控恢复基线', () => {
  const r = forward({ ...base(), ...scalarGate() });
  assert.equal(r.heads.length, 2);
  // sigmoid(0)=0.5：门后头输出恰为门前一半
  for (let h = 0; h < 2; h++) {
    for (let i = 0; i < 2; i++) {
      for (let f = 0; f < 2; f++) {
        assert.ok(Math.abs(r.gatedHeads[h][i][f] - 0.5 * r.heads[h].output[i][f]) < 1e-12);
      }
    }
  }
  // 暂停门控：门后 == 基线，差值全 0
  const paused = forward({ ...base(), ...scalarGate(), gated: false });
  assert.equal(paused.gateProbs, null);
  assert.deepEqual(paused.gatedHeads, paused.heads.map((hh) => hh.output));
  for (const row of paused.diff) for (const d of row) assert.equal(d, 0);
});

test('注意力权重逐行归一且非负，与门参数无关', () => {
  const a = forward({ ...base(), ...scalarGate() });
  const big = {
    Wg: [[1e6, -1e6], [-1e6, 1e6], [1e6, -1e6], [-1e6, 1e6]],
    bg: [5000, -5000],
    mode: 'scalar',
    gated: true,
  };
  const b = forward({ ...base(), ...big });
  for (let h = 0; h < 2; h++) {
    for (let i = 0; i < 3; i++) {
      let sum = 0;
      for (let j = 0; j < 4; j++) {
        const w = a.heads[h].weights[i][j];
        assert.ok(w >= 0 && w <= 1);
        if (i < 2) sum += w;
      }
      if (i < 2) assert.ok(Math.abs(sum - 1) < 1e-12);
      // 门参数剧变不改变权重
      assert.deepEqual(b.heads[h].weights[i], a.heads[h].weights[i]);
      assert.deepEqual(b.heads[h].output[i], a.heads[h].output[i]);
    }
  }
});

test('头间隔离：只改第 2 头门参数，第 1 头门后输出与投影中对应分量不变', () => {
  const a = forward({
    ...base(),
    Wg: [[0.1, 0.2], [-0.3, 0.4], [0.5, -0.6], [-0.2, 0.8]],
    bg: [0.1, -0.2],
    mode: 'scalar',
  });
  const b = forward({
    ...base(),
    Wg: [[0.1, 9.9], [-0.3, -8.8], [0.5, 7.7], [-0.2, -6.6]],
    bg: [0.1, 4.0],
    mode: 'scalar',
  });
  // 头 1（列 0）门分数与门后输出不变；头 2（列 1）改变
  for (let i = 0; i < 3; i++) {
    assert.equal(b.gateProbs[i][0], a.gateProbs[i][0]);
    assert.notEqual(b.gateProbs[i][1], a.gateProbs[i][1]);
    assert.deepEqual(b.gatedHeads[0][i], a.gatedHeads[0][i]);
  }
  // 权重完全不变
  for (let h = 0; h < 2; h++) assert.deepEqual(b.heads[h].weights, a.heads[h].weights);
});

test('逐元素向量门：每个特征位置独立缩放，标量门做不到', () => {
  // 让每个门取不同概率：构造 Wg 使查询相关得分，这里直接用极端 bg 控制
  const r = forward({
    ...base(),
    Wg: [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    bg: [500, 0, -500, 500], // h1.f1=1, h1.f2=.5, h2.f1=0, h2.f2=1
    mode: 'vector',
  });
  // 查询 0：q0 与零 Wg 点积=0，logit=bg 钳制后 sigmoid
  assert.ok(Math.abs(r.gateProbs[0][0] - 1) < 1e-12);
  assert.ok(Math.abs(r.gateProbs[0][1] - 0.5) < 1e-12);
  assert.ok(Math.abs(r.gateProbs[0][2] - 0) < 1e-12);
  assert.ok(Math.abs(r.gateProbs[0][3] - 1) < 1e-12);
  // h1 输出 [f1*1, f2*0.5]，h2 输出 [0, f2*1]
  for (let i = 0; i < 2; i++) {
    assert.ok(Math.abs(r.gatedHeads[0][i][0] - r.heads[0].output[i][0]) < 1e-10);
    assert.ok(Math.abs(r.gatedHeads[0][i][1] - 0.5 * r.heads[0].output[i][1]) < 1e-10);
    assert.ok(Math.abs(r.gatedHeads[1][i][0] - 0) < 1e-10);
    assert.ok(Math.abs(r.gatedHeads[1][i][1] - r.heads[1].output[i][1]) < 1e-10);
  }
});

test('极端门分数（大幅正负）仍产生有限结果', () => {
  const r = forward({
    ...base(),
    Wg: [[1e308, -1e308], [1e308, -1e308], [1e308, -1e308], [1e308, -1e308]],
    bg: [1e308, -1e308],
    mode: 'scalar',
  });
  for (const row of r.gateLogits) for (const z of row) assert.ok(Number.isFinite(z));
  for (const row of r.gateProbs) for (const p of row) assert.ok(p >= 0 && p <= 1);
  for (const row of r.projected) for (const x of row) assert.ok(Number.isFinite(x));
  // 正极端门=1，负极端门=0
  assert.ok(Math.abs(r.gateProbs[0][0] - 1) < 1e-12);
  assert.ok(Math.abs(r.gateProbs[0][1] - 0) < 1e-12);
});

test('全屏蔽查询行：权重全 0、各头输出与投影（含偏置）为 0', () => {
  const r = forward({ ...base(), ...scalarGate() });
  assert.deepEqual(r.allMasked, [false, false, true]);
  const h = 0;
  for (let j = 0; j < 4; j++) assert.equal(r.heads[h].weights[2][j], 0);
  for (const x of r.heads[h].output[2]) assert.equal(x, 0);
  for (const x of r.gatedHeads[h][2]) assert.equal(x, 0);
  for (const x of r.projected[2]) assert.equal(x, 0);
  for (const x of r.baselineProjected[2]) assert.equal(x, 0);
  for (const x of r.diff[2]) assert.equal(x, 0);
});

test('部分屏蔽：被屏蔽键权重为 0，softmax 只在允许键上归一', () => {
  const p = base();
  p.mask = [[0, 1, 0, 1], [1, 1, 1, 1], [1, 0, 0, 0]];
  const r = forward({ ...p, ...scalarGate() });
  assert.equal(r.heads[0].weights[0][0], 0);
  assert.equal(r.heads[0].weights[0][2], 0);
  assert.ok(Math.abs(r.heads[0].weights[0][1] + r.heads[0].weights[0][3] - 1) < 1e-12);
  assert.deepEqual(r.allMasked, [false, false, false]);
});

test('非有限值与维度冲突显式报错，绝不静默广播', () => {
  assert.throws(() => forward({
    ...base(), Q: [[1, NaN, 0, 1], [0, 1, 1, 0], [0.5, -0.5, 0.5, 0.5]], ...scalarGate(),
  }), /非有限|有限/);
  assert.throws(() => forward({
    ...base(), Q: [[1, 0, 0], [0, 1, 1], [0.5, -0.5, 0.5]], ...scalarGate(),
  }), /形状|一致|整除/);
  assert.throws(() => forward({
    ...base(), mask: [[1, 1, 1, 2], [1, 1, 1, 1], [0, 0, 0, 0]], ...scalarGate(),
  }), /0.*1|屏蔽/);
  assert.throws(() => forward({
    ...base(), mode: 'vector', Wg: [[0], [0], [0], [0]], bg: [0],
  }), /形状必须为 4x4|长度必须为 4/);
  assert.throws(() => forward({
    ...base(), mode: 'vector',
    Wg: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    bg: [0, 0, 0],
  }), /bg 长度必须为 4/);
});
