// 可编辑矩阵文本解析：空白/逗号分隔，换行分行。
// 严格报错：空文本、token 非法、参差行、非有限值，均给出行列定位。

import { ModelError } from './matmul.js';

export function parseMatrixText(text, name) {
  if (typeof text !== 'string') throw new ModelError(`${name} 内容必须是文本。`, 'PARSE');
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].trim();
    if (!line) continue;
    const tokens = line.split(/[\s,]+/).filter((t) => t.length > 0);
    const row = [];
    for (const tok of tokens) {
      const v = Number(tok);
      if (tok === '' || !Number.isFinite(v)) {
        throw new ModelError(`${name} 第 ${li + 1} 行的“${tok}”不是有限数值（不接受 NaN/Infinity）。`, 'NON_FINITE');
      }
      row.push(v);
    }
    if (row.length) rows.push(row);
  }
  if (rows.length === 0) throw new ModelError(`${name} 为空：至少需要一行数字。`, 'PARSE');
  const cols = rows[0].length;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].length !== cols) {
      throw new ModelError(
        `${name} 第 ${i + 1} 行有 ${rows[i].length} 个数，第 1 行有 ${cols} 个（不允许参差形状）。`,
        'SHAPE'
      );
    }
  }
  return rows;
}

// 向量解析（偏置）：空白/逗号/换行分隔为单行
export function parseVectorText(text, name) {
  if (typeof text !== 'string') throw new ModelError(`${name} 内容必须是文本。`, 'PARSE');
  const tokens = text.split(/[\s,]+/).filter((t) => t.length > 0);
  if (tokens.length === 0) throw new ModelError(`${name} 为空：至少需要一个数。`, 'PARSE');
  const out = [];
  for (const tok of tokens) {
    const v = Number(tok);
    if (!Number.isFinite(v)) {
      throw new ModelError(`${name} 中的“${tok}”不是有限数值。`, 'NON_FINITE');
    }
    out.push(v);
  }
  return out;
}

function fmt(x) {
  // 紧凑且确定的格式，便于文本框展示与回归
  if (Object.is(x, -0)) return '0';
  const r = Math.round(x * 1e6) / 1e6;
  return String(r);
}

export function matrixToText(matrix) {
  return matrix.map((row) => row.map(fmt).join(' ')).join('\n');
}

export function vectorToText(vec) {
  return vec.map(fmt).join(' ');
}
