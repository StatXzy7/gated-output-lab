// 稳定（softmax 前减最大值）缩放点积注意力，逐头计算。
// mask[i][j] 为 1 表示允许查询 i 关注键 j，为 0 表示屏蔽。

import { ModelError, validateMatrix, validateVector, zeros, dotRange } from './matmul.js';

function validateMask(mask, numQueries, numKeys, name) {
  validateMatrix(mask, name);
  if (mask.length !== numQueries || mask[0].length !== numKeys) {
    throw new ModelError(
      `${name} 形状必须为 ${numQueries}x${numKeys}，实际 ${mask.length}x${mask[0].length}。`,
      'SHAPE'
    );
  }
  for (let i = 0; i < numQueries; i++) {
    for (let j = 0; j < numKeys; j++) {
      if (mask[i][j] !== 0 && mask[i][j] !== 1) {
        throw new ModelError(`${name}[${i + 1}][${j + 1}]=${mask[i][j]}，只允许 0（屏蔽）或 1（允许）。`, 'MASK_VALUE');
      }
    }
  }
}

// 输入已在 validateMatrix 阶段保证有限。scores 做有限钳制，保证极端值下结果仍有限。
const SCORE_LIMIT = 60;

function softmaxRows(scores, mask) {
  const n = scores.length;
  const kv = scores[0].length;
  const weights = zeros(n, kv);
  const allMasked = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    let max = -Infinity;
    for (let j = 0; j < kv; j++) {
      if (mask[i][j] === 1 && scores[i][j] > max) max = scores[i][j];
    }
    if (!Number.isFinite(max)) {
      allMasked[i] = true; // 全屏蔽行：权重行保持全 0
      continue;
    }
    let sum = 0;
    let maxJ = -1;
    let maxExp = -1;
    for (let j = 0; j < kv; j++) {
      if (mask[i][j] !== 1) continue;
      let e = Math.exp(scores[i][j] - max);
      if (!Number.isFinite(e)) e = Number.MAX_VALUE;
      weights[i][j] = e;
      sum += e;
      if (e > maxExp) {
        maxExp = e;
        maxJ = j;
      }
    }
    if (!Number.isFinite(sum) || sum <= 0) {
      // 极端情况：所有指数下溢/溢出。把质量放回权重最大的允许键，避免 NaN。
      for (let j = 0; j < kv; j++) weights[i][j] = 0;
      weights[i][maxJ] = 1;
      sum = 1;
    }
    for (let j = 0; j < kv; j++) weights[i][j] = weights[i][j] / sum;
  }
  return { weights, allMasked };
}

export function attentionHeads({ Q, K, V, mask, numHeads }) {
  validateMatrix(Q, 'Q');
  validateMatrix(K, 'K');
  validateMatrix(V, 'V');
  const [nq, dModel] = Q.length ? [Q.length, Q[0].length] : [0, 0];
  const [nk, dk] = K.length ? [K.length, K[0].length] : [0, 0];
  if (!Number.isInteger(numHeads) || numHeads <= 0) {
    throw new ModelError('头数 numHeads 必须为正整数。', 'SHAPE');
  }
  if (dModel % numHeads !== 0) {
    throw new ModelError(`模型维度 ${dModel} 不能被头数 ${numHeads} 整除。`, 'SHAPE');
  }
  if (dk !== dModel) {
    throw new ModelError(`K 维度 ${dk} 与 Q 维度 ${dModel} 不一致。`, 'SHAPE');
  }
  if (V.length !== nk) {
    throw new ModelError(`V 行数 ${V.length} 与 K 行数 ${nk} 不一致。`, 'SHAPE');
  }
  if (V[0].length !== dModel) {
    throw new ModelError(`V 维度 ${V[0].length} 与模型维度 ${dModel} 不一致。`, 'SHAPE');
  }
  validateMask(mask, nq, nk, 'mask');

  const dh = dModel / numHeads;
  const scale = 1 / Math.sqrt(dh);
  const heads = [];
  let allMasked = new Array(nq).fill(false);

  for (let h = 0; h < numHeads; h++) {
    const off = h * dh;
    const scores = zeros(nq, nk);
    for (let i = 0; i < nq; i++) {
      for (let j = 0; j < nk; j++) {
        let s = dotRange(Q[i], K[j], off, dh) * scale;
        if (!Number.isFinite(s)) s = s > 0 ? SCORE_LIMIT : -SCORE_LIMIT;
        s = Math.max(-SCORE_LIMIT, Math.min(SCORE_LIMIT, s));
        scores[i][j] = s;
      }
    }
    const sm = softmaxRows(scores, mask);
    allMasked = sm.allMasked.map((v, i) => v || allMasked[i]);

    const output = zeros(nq, dh);
    for (let i = 0; i < nq; i++) {
      if (sm.allMasked[i]) continue; // 全屏蔽行该头输出为零
      for (let j = 0; j < nk; j++) {
        const w = sm.weights[i][j];
        if (w === 0) continue;
        for (let f = 0; f < dh; f++) {
          output[i][f] += w * V[j][off + f];
        }
      }
    }
    heads.push({ scores, weights: sm.weights, output });
  }

  return { heads, allMasked, dh, dModel };
}
