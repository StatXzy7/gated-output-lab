// 纯视图函数：把 forward 结果渲染为 SVG 字符串与表格 HTML，无 DOM 依赖，便于测试。
// 所有展示数值统一四舍五入到 4 位小数；NaN/Infinity 不会被静默吞掉，显示为文字状态。

import { CONFIG, EDITORS, expectedShape } from './schema.js';

export function fmt(x, digits = 4) {
  if (typeof x !== 'number' || Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? 'Inf' : '-Inf';
  if (Object.is(x, -0)) x = 0;
  const factor = 10 ** digits;
  return String(Math.round(x * factor) / factor);
}

function escapeText(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function divergingColor(v, maxAbs) {
  // 负蓝、零白、正红；屏蔽（null）灰色
  if (v === null) return '#d7d7d7';
  if (maxAbs <= 0 || !Number.isFinite(v)) return '#ffffff';
  const t = Math.max(-1, Math.min(1, v / maxAbs));
  const light = 96 - Math.round(Math.abs(t) * 38); // 96% -> 58%
  const hue = t >= 0 ? 8 : 222;
  return `hsl(${hue} 70% ${light}%)`;
}

function probColor(p) {
  if (!Number.isFinite(p)) return '#d7d7d7';
  // 0.5 中性浅灰，接近 0 蓝，接近 1 红
  const t = Math.max(0, Math.min(1, p));
  const light = 92 - Math.round(Math.abs(t - 0.5) * 2 * 40);
  const hue = t >= 0.5 ? 8 : 222;
  return `hsl(${hue} 72% ${light}%)`;
}

// 通用热力图：matrix 为 number[][]；mask 可把格位置画成“屏蔽”
export function heatmapSvg(matrix, { rowLabels, colLabels, mask = null, title = '', digits = 3, cell = 52, h = 26 } = {}) {
  const rows = matrix.length;
  const cols = matrix[0].length;
  const padL = 46;
  const padT = 30;
  const width = padL + cols * cell + 8;
  const height = padT + rows * h + 8;
  let maxAbs = 0;
  for (const row of matrix) for (const v of row) if (Number.isFinite(v)) maxAbs = Math.max(maxAbs, Math.abs(v));
  const parts = [];
  parts.push(`<svg class="hm" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeText(title)}">`);
  if (title) parts.push(`<text x="6" y="16" class="hm-title">${escapeText(title)}</text>`);
  for (let j = 0; j < cols; j++) {
    parts.push(`<text x="${padL + j * cell + cell / 2}" y="${padT - 10}" text-anchor="middle" class="hm-axis">${escapeText(colLabels ? colLabels[j] : j + 1)}</text>`);
  }
  for (let i = 0; i < rows; i++) {
    parts.push(`<text x="${padL - 6}" y="${padT + i * h + h / 2 + 4}" text-anchor="end" class="hm-axis">${escapeText(rowLabels ? rowLabels[i] : `q${i + 1}`)}</text>`);
    for (let j = 0; j < cols; j++) {
      const blocked = mask && mask[i] && mask[i][j] === 0;
      const v = blocked ? null : matrix[i][j];
      const fill = divergingColor(v, maxAbs);
      const x = padL + j * cell;
      const y = padT + i * h;
      parts.push(`<rect x="${x}" y="${y}" width="${cell - 2}" height="${h - 2}" rx="3" fill="${fill}" stroke="#9aa3ad"/>`);
      parts.push(`<text x="${x + cell / 2 - 1}" y="${y + h / 2 + 4}" text-anchor="middle" class="hm-num">${blocked ? '屏蔽' : escapeText(fmt(v, digits))}</text>`);
    }
  }
  parts.push('</svg>');
  return parts.join('');
}

// 门分数图：每行一个查询，每列一个门；条长=概率，标注 logit 与 p
export function gateSvg({ gateProbs: probs, gateLogits: logits, numHeads: heads, mode, gated }, { cell = 132, rowH = 24 } = {}) {
  if (!gated || !probs) return '<div class="muted">门控已暂停：所有门分数视为 1（无门基线）。</div>';
  const nq = probs.length;
  const cols = probs[0].length;
  const padL = 46;
  const padT = 26;
  const width = padL + cols * cell + 6;
  const height = padT + nq * rowH + 8;
  const p = [];
  p.push(`<svg class="hm" viewBox="0 0 ${width} ${height}" role="img" aria-label="门分数">`);
  p.push(`<text x="6" y="14" class="hm-title">${mode === 'scalar' ? '整头标量门 sigmoid 分数' : '逐元素向量门 sigmoid 分数（按头分块）'}</text>`);
  for (let c = 0; c < cols; c++) {
    let label;
    if (mode === 'scalar') label = `h${c + 1}`;
    else {
      const dh = cols / heads;
      label = `h${Math.floor(c / dh) + 1}.f${(c % dh) + 1}`;
    }
    p.push(`<text x="${padL + c * cell + cell / 2}" y="${padT - 8}" text-anchor="middle" class="hm-axis">${label}</text>`);
  }
  for (let i = 0; i < nq; i++) {
    const y = padT + i * rowH;
    p.push(`<text x="${padL - 6}" y="${y + rowH / 2 + 4}" text-anchor="end" class="hm-axis">q${i + 1}</text>`);
    for (let c = 0; c < cols; c++) {
      const prob = probs[i][c];
      const x = padL + c * cell;
      p.push(`<rect x="${x}" y="${y + 3}" width="${cell - 8}" height="${rowH - 8}" rx="3" fill="#eef1f4" stroke="#c3cad2"/>`);
      p.push(`<rect x="${x}" y="${y + 3}" width="${Math.round((cell - 8) * prob)}" height="${rowH - 8}" rx="3" fill="${probColor(prob)}"/>`);
      p.push(`<text x="${x + (cell - 8) / 2}" y="${y + rowH / 2 + 4}" text-anchor="middle" class="hm-num">${escapeText(fmt(logits[i][c], 2))}→${escapeText(fmt(prob, 3))}</text>`);
    }
  }
  p.push('</svg>');
  return p.join('');
}

// matrix 数值表；rowName/colName 给出行列含义；rowBadges 给行加状态标记
export function tableHtml(matrix, { title = '', rowPrefix = 'q', colPrefix = 'c', rowBadges = null, mask = null, digits = 4 } = {}) {
  const rows = matrix.length;
  const cols = matrix[0].length;
  const out = [];
  if (title) out.push(`<div class="table-title">${escapeText(title)}</div>`);
  out.push('<table class="num"><thead><tr><th></th>');
  for (let j = 0; j < cols; j++) out.push(`<th>${escapeText(typeof colPrefix === 'function' ? colPrefix(j) : `${colPrefix}${j + 1}`)}</th>`);
  out.push('</tr></thead><tbody>');
  for (let i = 0; i < rows; i++) {
    const badge = rowBadges && rowBadges[i] ? ' class="badgerow"' : '';
    out.push(`<tr${badge}><th>${escapeText(`${rowPrefix}${i + 1}`)}${rowBadges && rowBadges[i] ? ' <span class="tag">全屏蔽=0</span>' : ''}</th>`);
    for (let j = 0; j < cols; j++) {
      const blocked = mask && mask[i] && mask[i][j] === 0;
      out.push(`<td class="${blocked ? 'blocked' : ''}">${blocked ? '屏蔽' : escapeText(fmt(matrix[i][j], digits))}</td>`);
    }
    out.push('</tr>');
  }
  out.push('</tbody></table>');
  return out.join('');
}

function headBlockHtml(result, h) {
  const dh = result.dh;
  const colLabels = (j) => `f${j + 1}`;
  const keyLabels = (j) => `k${j + 1}`;
  return [
    `<section class="head-card"><h3>头 ${h + 1}（维度 f1..f${dh}）</h3>`,
    heatmapSvg(result.heads[h].weights, { title: `注意力权重（h${h + 1}，与门无关）`, colLabels: result.heads[h].weights[0].map((_, j) => `k${j + 1}`), mask: result.mask, digits: 3 }),
    tableHtml(result.heads[h].weights, { title: '权重数值表', rowPrefix: 'q', colPrefix: keyLabels, mask: result.mask, digits: 4 }),
    tableHtml(result.heads[h].scores, { title: 'softmax 前缩放分数（屏蔽位置不参与 softmax）', rowPrefix: 'q', colPrefix: keyLabels, mask: result.mask, digits: 3 }),
    tableHtml(result.heads[h].output, { title: '门前头输出（注意力 @ V 子块）', rowPrefix: 'q', colPrefix: colLabels, rowBadges: result.allMasked, digits: 4 }),
    tableHtml(result.gatedHeads[h], { title: '门后头输出', rowPrefix: 'q', colPrefix: colLabels, rowBadges: result.allMasked, digits: 4 }),
    '</section>',
  ].join('');
}

export function statusHtml(state) {
  const issues = Object.values(state.errors || {});
  if (issues.length) {
    return `<div class="status error"><strong>输入错误（${issues.length}）：</strong>${escapeText(issues.map((e) => e.message).join(' ｜ '))}
    ${state.result ? '<div class="stale-note">下表仍为上次有效结果；修正输入后自动恢复，错误内容不会覆盖它。</div>' : '<div class="stale-note">尚无有效结果。</div>'}</div>`;
  }
  const bits = [];
  bits.push(state.gated ? '门控：开启' : '门控：暂停（无门基线，门分数=1）');
  bits.push(`粒度：${state.mode === 'scalar' ? '整头标量门' : '逐元素向量门'}`);
  bits.push(`头数 ${state.numHeads}，d_model=${CONFIG.dModel}`);
  if (state.modeNote) bits.push(escapeText(state.modeNote));
  const masked = (state.result?.allMasked || []).filter(Boolean).length;
  if (masked) bits.push(`全屏蔽查询行 ${masked} 行（输出强制为 0）`);
  return `<div class="status ok">${bits.join(' ｜ ')}</div>`;
}

export function resultsHtml(state) {
  const r = state.result;
  if (!r) return '<div class="muted">当前没有可显示的有效结果。</div>';
  const out = ['<div class="results">'];
  out.push('<section class="panel"><h2>门分数</h2>');
  out.push(gateSvg(r));
  if (r.gateProbs) {
    out.push(tableHtml(r.gateProbs, {
      title: '门 sigmoid 分数数值表',
      rowPrefix: 'q',
      colPrefix: (j) => r.mode === 'scalar' ? `h${j + 1}` : `g${j + 1}`,
      digits: 4,
    }));
  }
  out.push('</section>');

  out.push('<section class="panel heads"><h2>各头注意力（权重不随门参数变化）</h2>');
  for (let h = 0; h < r.numHeads; h++) out.push(headBlockHtml(r, h));
  out.push('</section>');

  out.push('<section class="panel"><h2>拼接与投影</h2>');
  out.push(tableHtml(r.concatBaseline, { title: '头拼接（无门基线）', rowPrefix: 'q', colPrefix: (j) => `c${j + 1}`, rowBadges: r.allMasked }));
  out.push(tableHtml(r.concatGated, { title: '头拼接（门后）', rowPrefix: 'q', colPrefix: (j) => `c${j + 1}`, rowBadges: r.allMasked }));
  out.push(heatmapSvg(r.projected, { title: '最终投影结果 y（Wo/bo）', digits: 4, cell: 64 }));
  out.push(tableHtml(r.projected, { title: '最终投影数值表', rowPrefix: 'q', colPrefix: (j) => `y${j + 1}`, rowBadges: r.allMasked }));
  out.push(tableHtml(r.baselineProjected, { title: '无门基线投影 y₀', rowPrefix: 'q', colPrefix: (j) => `y0_${j + 1}`, rowBadges: r.allMasked }));
  out.push(heatmapSvg(r.diff, { title: '差值 Δ = y − y₀（暂停门控时为 0）', digits: 4, cell: 64 }));
  out.push(tableHtml(r.diff, { title: '差值数值表', rowPrefix: 'q', colPrefix: (j) => `d${j + 1}`, rowBadges: r.allMasked }));
  out.push('</section>');
  out.push('</div>');
  return out.join('');
}

export function editorSpecs(state) {
  return EDITORS.map((ed) => {
    const want = expectedShape(ed.key, state);
    return {
      key: ed.key,
      label: ed.label,
      kind: ed.kind,
      gatedOnly: ed.gatedOnly,
      want: Array.isArray(want) ? `${want[0]}×${want[1]}` : `长度 ${want}`,
      text: state.drafts[ed.key],
      error: state.errors[ed.key] ? state.errors[ed.key].message : null,
    };
  });
}
