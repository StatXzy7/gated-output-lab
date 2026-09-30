// 固定的小型调试配置与参数元数据。所有默认数据来自固定种子 PRNG（mulberry32）。

export const CONFIG = {
  numQueries: 3,
  numKeys: 4,
  dModel: 4,
  numHeads: 2, // dh = 2
  dOut: 3,
  seed: 20240917,
};

// 矩阵返回 [rows, cols]；向量（bo/bg）返回长度数字。
export function expectedShape(key, { numHeads = CONFIG.numHeads, mode = 'scalar' } = {}) {
  const c = CONFIG;
  switch (key) {
    case 'Q': return [c.numQueries, c.dModel];
    case 'K': return [c.numKeys, c.dModel];
    case 'V': return [c.numKeys, c.dModel];
    case 'mask': return [c.numQueries, c.numKeys];
    case 'Wo': return [c.dModel, c.dOut];
    case 'bo': return c.dOut;
    case 'Wg': return [c.dModel, mode === 'vector' ? c.dModel : numHeads];
    case 'bg': return mode === 'vector' ? c.dModel : numHeads;
    default:
      throw new Error('unknown key ' + key);
  }
}

export const EDITORS = [
  { key: 'Q', label: 'Q 查询（行=查询）', kind: 'matrix', gatedOnly: false },
  { key: 'K', label: 'K 键（行=键）', kind: 'matrix', gatedOnly: false },
  { key: 'V', label: 'V 值（行=键）', kind: 'matrix', gatedOnly: false },
  { key: 'mask', label: 'mask 屏蔽（1 允许 / 0 屏蔽）', kind: 'matrix', gatedOnly: false },
  { key: 'Wo', label: 'Wo 输出投影', kind: 'matrix', gatedOnly: false },
  { key: 'bo', label: 'bo 输出偏置', kind: 'vector', gatedOnly: false },
  { key: 'Wg', label: 'Wg 门投影权重', kind: 'matrix', gatedOnly: true },
  { key: 'bg', label: 'bg 门偏置', kind: 'vector', gatedOnly: true },
];
