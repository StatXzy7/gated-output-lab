// 门分数：s = sigmoid(q · Wg + bg)。
// scalar 模式 Wg 为 nh 列（每个查询对每个头一个分数）；
// vector 模式 Wg 为 dModel 列（每个头 dh 个分数，按头块排列）。
// 大幅正/负 logit 经钳制后 sigmoid 严格落在 [0,1]，结果始终有限。

export const SIGMOID_LIMIT = 60;

export function stableSigmoid(z) {
  if (typeof z !== 'number' || Number.isNaN(z)) return 0.5; // 非有限输入给中性门
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  if (z >= SIGMOID_LIMIT) return 1;
  if (z <= -SIGMOID_LIMIT) return 0;
  return 1 / (1 + Math.exp(-z));
}

export function clampScore(z) {
  if (typeof z !== 'number' || Number.isNaN(z)) return 0;
  if (!Number.isFinite(z)) return z > 0 ? SIGMOID_LIMIT : -SIGMOID_LIMIT;
  return Math.max(-SIGMOID_LIMIT, Math.min(SIGMOID_LIMIT, z));
}
