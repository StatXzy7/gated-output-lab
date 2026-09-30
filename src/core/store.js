// 状态管理：编辑文本 -> 解析 -> 形状校验 -> 前向。
// 关键约束：任何非法编辑都不会覆盖上次有效参数/结果；上次有效结果继续展示并标注陈旧。

import { CONFIG, expectedShape } from './schema.js';
import { parseMatrixText, parseVectorText, matrixToText, vectorToText } from './parse.js';
import { forward } from './forward.js';
import { ModelError } from './matmul.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 固定形状矩阵；mask 强制 0/1 且留出一个全屏蔽查询行用于边界演示
function genMatrix(rng, rows, cols, { asMask = false, forceAllMaskedRow = -1 } = {}) {
  const m = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (asMask) {
        let v = rng() < 0.72 ? 1 : 0;
        if (i === forceAllMaskedRow) v = 0;
        m[i][j] = v;
      } else {
        m[i][j] = Math.round((rng() * 2 - 1) * 100) / 100;
      }
    }
  }
  return m;
}

export function randomGateParams(mode, numHeads) {
  const rng = mulberry32(CONFIG.seed + (mode === 'vector' ? 77 : 13));
  const cols = mode === 'vector' ? CONFIG.dModel : numHeads;
  const Wg = genMatrix(rng, CONFIG.dModel, cols);
  const bg = Array.from({ length: cols }, () => Math.round((rng() * 1.6 - 0.8) * 100) / 100);
  return { Wg, bg };
}

export function makeInitialState() {
  const rng = mulberry32(CONFIG.seed);
  const { numQueries, numKeys, dModel, numHeads, dOut } = CONFIG;
  const params = {
    Q: genMatrix(rng, numQueries, dModel),
    K: genMatrix(rng, numKeys, dModel),
    V: genMatrix(rng, numKeys, dModel),
    mask: genMatrix(rng, numQueries, numKeys, { asMask: true, forceAllMaskedRow: numQueries - 1 }),
    Wo: genMatrix(rng, dModel, dOut),
    bo: Array.from({ length: dOut }, () => Math.round((rng() * 2 - 1) * 100) / 100),
    ...randomGateParams('scalar', numHeads),
  };
  const drafts = {};
  for (const [k, v] of Object.entries(params)) {
    drafts[k] = Array.isArray(v[0]) ? matrixToText(v) : vectorToText(v);
  }
  return {
    params,
    drafts,
    mode: 'scalar',
    numHeads,
    gated: true,
    errors: {},
    result: null,
    lastError: null,
    stale: false,
    pendingMode: null, // { mode } 等待用户选择“保留/重建”
  };
}

function shapeOf(key, value) {
  return Array.isArray(value[0]) ? [value.length, value[0].length] : value.length;
}

function checkExpected(key, value, state) {
  const want = expectedShape(key, state);
  const got = shapeOf(key, value);
  const wantText = Array.isArray(want) ? `${want[0]}x${want[1]}` : `长度 ${want}`;
  const gotText = Array.isArray(got) ? `${got[0]}x${got[1]}` : `长度 ${got}`;
  if (wantText !== gotText) {
    throw new ModelError(`${key} 形状应为 ${wantText}，当前为 ${gotText}（拒绝静默广播）。`, 'SHAPE');
  }
}

function validateParsed(key, value) {
  if (key === 'mask') {
    for (let i = 0; i < value.length; i++) {
      for (let j = 0; j < value[i].length; j++) {
        if (value[i][j] !== 0 && value[i][j] !== 1) {
          throw new ModelError(`mask 只允许 0 或 1，位置 [${i + 1}][${j + 1}] 为 ${value[i][j]}。`, 'MASK_VALUE');
        }
      }
    }
  }
}

function recompute(state) {
  try {
    const { Q, K, V, mask, Wo, bo, Wg, bg } = state.params;
    const result = forward({
      Q, K, V, mask, Wo, bo, Wg, bg,
      numHeads: state.numHeads,
      mode: state.mode,
      gated: state.gated,
    });
    state.result = result;
    state.lastError = null;
    state.stale = false;
    return result;
  } catch (err) {
    state.lastError = err instanceof ModelError ? err : new ModelError(String(err && err.message || err), 'RUNTIME');
    state.stale = true;
    return null;
  }
}

export function createStore() {
  let state = makeInitialState();
  const listeners = new Set();
  const notify = () => {
    for (const fn of listeners) fn(state);
  };

  recompute(state);

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getState() {
      return state;
    },

    edit(key, text) {
      state = { ...state, drafts: { ...state.drafts, [key]: text } };
      const parse = () => {
        const want = expectedShape(key, state);
        return Array.isArray(want) ? parseMatrixText(text, key) : parseVectorText(text, key);
      };
      try {
        const value = parse();
        checkExpected(key, value, state);
        validateParsed(key, value);
        state = {
          ...state,
          params: { ...state.params, [key]: value },
          errors: Object.fromEntries(Object.entries(state.errors).filter(([k]) => k !== key)),
        };
        recompute(state);
      } catch (err) {
        const e = err instanceof ModelError ? err : new ModelError(String(err), 'PARSE');
        state = {
          ...state,
          errors: { ...state.errors, [key]: e },
          lastError: e,
          stale: state.result != null,
          pendingMode: state.pendingMode,
        };
        if (state.result == null) state.stale = false;
      }
      notify();
    },

    setGated(gated) {
      state = { ...state, gated };
      if (gated && state.pendingMode) state.pendingMode = null;
      recompute(state);
      notify();
    },

    // 请求切换粒度；形状相同（本例不会发生）直接应用，否则挂起等待用户决策
    requestMode(mode) {
      if (mode === state.mode) {
        state = { ...state, pendingMode: null };
        notify();
        return;
      }
      const oldCols = expectedShape('Wg', state)[1];
      const newCols = expectedShape('Wg', { numHeads: state.numHeads, mode })[1];
      if (oldCols === newCols) {
        this.applyMode(mode, 'rebuild');
        return;
      }
      state = { ...state, pendingMode: { mode } };
      notify();
    },

    // strategy: 'preserve' 保留可复用前缀并明确补零/截断；'rebuild' 固定种子重建
    applyMode(mode, strategy) {
      let params = { ...state.params };
      let note = '';
      if (strategy === 'rebuild') {
        const g = randomGateParams(mode, state.numHeads);
        params.Wg = g.Wg;
        params.bg = g.bg;
        note = `已用固定种子重建${mode === 'scalar' ? '整头标量' : '逐元素向量'}门参数。`;
      } else {
        const oldCols = params.Wg[0].length;
        const newCols = expectedShape('Wg', { numHeads: state.numHeads, mode })[1];
        const rows = CONFIG.dModel;
        const Wg = Array.from({ length: rows }, (_, r) => {
          const row = new Array(newCols).fill(0);
          for (let c = 0; c < Math.min(oldCols, newCols); c++) row[c] = params.Wg[r][c];
          return row;
        });
        const bg = new Array(newCols).fill(0);
        for (let c = 0; c < Math.min(params.bg.length, newCols); c++) bg[c] = params.bg[c];
        params.Wg = Wg;
        params.bg = bg;
        note = newCols > oldCols
          ? `已保留前 ${oldCols} 列/项，新增列/项置 0（sigmoid=0.5，不静默伪造数据）。`
          : `已保留前 ${newCols} 列/项，其余截断丢弃。`;
      }
      const drafts = { ...state.drafts, Wg: matrixToText(params.Wg), bg: vectorToText(params.bg) };
      state = { ...state, params, drafts, mode, pendingMode: null, errors: {}, modeNote: note };
      recompute(state);
      notify();
    },

    cancelMode() {
      state = { ...state, pendingMode: null };
      notify();
    },

    reset() {
      const fresh = makeInitialState();
      recompute(fresh);
      state = fresh;
      notify();
    },
  };
}
