// 前向编排：注意力 -> 门分数 -> 门后逐头输出 -> 头拼接 -> 输出投影。
// 基线（门全部视为 1）与当前门控在同一份注意力结果上计算，便于对比。

import { validateMatrix, validateVector, matmul, addBias, zeros, ModelError } from './matmul.js';
import { attentionHeads } from './attention.js';
import { clampScore, stableSigmoid } from './gate.js';

const SIGMOID_LIMIT = 60;

function computeGateColumns({ Q, Wg, bg, mode, numHeads, dModel }) {
  const nq = Q.length;
  const gateCols = mode === 'scalar' ? numHeads : dModel;
  const [wr, wc] = validateMatrix(Wg, 'Wg');
  validateVector(bg, gateCols, 'bg');
  if (wr !== dModel || wc !== gateCols) {
    throw new ModelError(
      `Wg 形状必须为 ${dModel}x${gateCols}（${mode === 'scalar' ? '整头标量门：每头 1 列' : `逐元素向量门：${dModel} 列`}），实际 ${wr}x${wc}。`,
      'SHAPE'
    );
  }
  const logits = zeros(nq, gateCols);
  const probs = zeros(nq, gateCols);
  for (let i = 0; i < nq; i++) {
    for (let c = 0; c < gateCols; c++) {
      let acc = 0;
      for (let k = 0; k < dModel; k++) acc += Q[i][k] * Wg[k][c];
      if (!Number.isFinite(acc)) acc = acc > 0 ? SIGMOID_LIMIT : -SIGMOID_LIMIT;
      const z = clampScore(acc + bg[c]);
      logits[i][c] = z;
      probs[i][c] = stableSigmoid(z);
    }
  }
  return { logits, probs, gateCols };
}

// params:
// { Q,K,V,mask,Wo,bo,Wg,bg, numHeads, mode:'scalar'|'vector', gated:boolean }
export function forward(params) {
  const { Q, K, V, mask, Wo, bo, Wg, bg, numHeads, mode, gated = true } = params;
  if (mode !== 'scalar' && mode !== 'vector') {
    throw new ModelError(`未知门控粒度：${mode}（只支持 scalar/vector）。`, 'SHAPE');
  }
  const attn = attentionHeads({ Q, K, V, mask, numHeads });
  const { heads, allMasked, dh, dModel } = attn;
  const nq = Q.length;
  const [wor, woc] = validateMatrix(Wo, 'Wo');
  validateVector(bo, woc, 'bo');
  if (wor !== dModel) {
    throw new ModelError(`Wo 行数必须为 ${dModel}（与头拼接维度一致），实际 ${wor}。`, 'SHAPE');
  }

  const gate = gated
    ? computeGateColumns({ Q, Wg, bg, mode, numHeads, dModel })
    : { logits: null, probs: null, gateCols: mode === 'scalar' ? numHeads : dModel };

  // 拼接门后/基线下各头输出
  const concatGated = zeros(nq, dModel);
  const concatBaseline = zeros(nq, dModel);
  const gatedHeads = [];
  for (let h = 0; h < numHeads; h++) {
    const gatedOut = zeros(nq, dh);
    for (let i = 0; i < nq; i++) {
      for (let f = 0; f < dh; f++) {
        const base = heads[h].output[i][f];
        concatBaseline[i][h * dh + f] = base;
        const p = gated
          ? (mode === 'scalar' ? gate.probs[i][h] : gate.probs[i][h * dh + f])
          : 1;
        const val = base * p;
        gatedOut[i][f] = val;
        concatGated[i][h * dh + f] = val;
      }
    }
    gatedHeads.push(gatedOut);
  }

  let projected = addBias(matmul(concatGated, Wo), bo);
  let baselineProjected = addBias(matmul(concatBaseline, Wo), bo);
  // 全屏蔽查询行：拼接为零，强制最终输出也为零（含偏置）。
  for (let i = 0; i < nq; i++) {
    if (allMasked[i]) {
      projected[i] = new Array(woc).fill(0);
      baselineProjected[i] = new Array(woc).fill(0);
    }
  }

  // 有限性自检：任何环节出现非有限值都视为失败（正常情况下不会发生）。
  const assertFinite = (m, label) => {
    for (const row of m) for (const x of row) if (!Number.isFinite(x)) {
      throw new ModelError(`${label} 出现非有限结果。`, 'NON_FINITE');
    }
  };
  assertFinite(projected, '投影输出');
  assertFinite(baselineProjected, '基线投影输出');

  return {
    mode,
    gated,
    mask,
    numHeads,
    dh,
    dModel,
    heads,            // [{ scores, weights, output(raw) }]
    gatedHeads,       // 门后逐头输出
    gateLogits: gate.logits,
    gateProbs: gate.probs,
    concatGated,
    concatBaseline,
    projected,
    baselineProjected,
    diff: projected.map((row, i) => row.map((x, j) => x - baselineProjected[i][j])),
    allMasked,
  };
}
