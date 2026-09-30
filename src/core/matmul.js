// 基本线性代数工具：矩阵用 number[][]（每行等长），向量用 number[]。
// 所有运算对维度严格校验，绝不静默广播；并对大值做点积溢出保护。

export class ModelError extends Error {
  constructor(message, code = 'MODEL_ERROR') {
    super(message);
    this.name = 'ModelError';
    this.code = code;
  }
}

export function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

export function shape(matrix) {
  if (!Array.isArray(matrix) || matrix.length === 0 || !Array.isArray(matrix[0])) {
    throw new ModelError('期望一个非空矩阵（行数组）。', 'SHAPE');
  }
  const rows = matrix.length;
  const cols = matrix[0].length;
  if (cols === 0) throw new ModelError('矩阵至少需要一列。', 'SHAPE');
  return [rows, cols];
}

export function validateMatrix(matrix, name) {
  if (!Array.isArray(matrix) || matrix.length === 0) {
    throw new ModelError(`${name} 必须是非空行数组。`, 'NON_FINITE');
  }
  const cols = Array.isArray(matrix[0]) ? matrix[0].length : -1;
  if (cols <= 0) throw new ModelError(`${name} 至少需要一列。`, 'NON_FINITE');
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i];
    if (!Array.isArray(row) || row.length !== cols) {
      throw new ModelError(
        `${name} 第 ${i + 1} 行长度异常：期望 ${cols} 列，实际 ${Array.isArray(row) ? row.length : '非数组'}（不允许参差形状/静默广播）。`,
        'SHAPE'
      );
    }
    for (let j = 0; j < cols; j++) {
      if (!isFiniteNumber(row[j])) {
        throw new ModelError(`${name}[${i + 1}][${j + 1}] 不是有限数值（NaN/Infinity/-Infinity 不允许）。`, 'NON_FINITE');
      }
    }
  }
  return [matrix.length, cols];
}

export function expectShape(matrix, rows, cols, name) {
  const [r, c] = shape(matrix);
  if (r !== rows || c !== cols) {
    throw new ModelError(`${name} 形状必须为 ${rows}x${cols}，实际 ${r}x${c}。`, 'SHAPE');
  }
  return matrix;
}

export function validateVector(vec, len, name) {
  if (!Array.isArray(vec)) throw new ModelError(`${name} 必须是数组。`, 'SHAPE');
  if (vec.length !== len) {
    throw new ModelError(`${name} 长度必须为 ${len}，实际 ${vec.length}（不允许静默广播）。`, 'SHAPE');
  }
  for (let i = 0; i < len; i++) {
    if (!isFiniteNumber(vec[i])) {
      throw new ModelError(`${name}[${i + 1}] 不是有限数值。`, 'NON_FINITE');
    }
  }
  return vec;
}

export function zeros(rows, cols) {
  return Array.from({ length: rows }, () => new Array(cols).fill(0));
}

// 对单个点积分项做钳制，避免 +/-1e308 * +/-1e308 直接变 Infinity。
const PRODUCT_LIMIT = 1e200;
const ACC_LIMIT = 1e250;

function safeProduct(a, b) {
  const p = a * b;
  if (Number.isFinite(p)) return p;
  return (a > 0) === (b > 0) ? PRODUCT_LIMIT : -PRODUCT_LIMIT;
}

function bumpAcc(acc, term) {
  const s = acc + term;
  if (Number.isFinite(s)) return s;
  return s > 0 ? ACC_LIMIT : -ACC_LIMIT;
}

// a[start..start+len) · b[start..start+len)
export function dotRange(a, b, start, len) {
  let acc = 0;
  for (let k = 0; k < len; k++) {
    if (!isFiniteNumber(a[start + k]) || !isFiniteNumber(b[start + k])) {
      return NaN;
    }
    acc = bumpAcc(acc, safeProduct(a[start + k], b[start + k]));
  }
  return acc;
}

export function matmul(a, b) {
  const [ar, ac] = shape(a);
  const [br, bc] = shape(b);
  if (ac !== br) {
    throw new ModelError(`矩阵乘法维度不匹配：(${ar}x${ac}) @ (${br}x${bc})。`, 'SHAPE');
  }
  const out = zeros(ar, bc);
  for (let i = 0; i < ar; i++) {
    for (let j = 0; j < bc; j++) {
      let acc = 0;
      for (let k = 0; k < ac; k++) {
        acc = bumpAcc(acc, safeProduct(a[i][k], b[k][j]));
      }
      out[i][j] = acc;
    }
  }
  return out;
}

export function addBias(matrix, bias) {
  const [r, c] = shape(matrix);
  validateVector(bias, c, '偏置');
  return matrix.map((row) => row.map((x, j) => x + bias[j]));
}

export function transpose(matrix) {
  const [r, c] = shape(matrix);
  const out = zeros(c, r);
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < c; j++) out[j][i] = matrix[i][j];
  }
  return out;
}
