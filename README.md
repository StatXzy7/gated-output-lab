# gated-output-lab — 多头注意力输出门控调试台

纯 Linux CPU / 浏览器内运行的小型多头注意力教学调试工具。**无第三方运行时依赖**（仅 Node.js 内置模块；package.json 中 dependencies/devDependencies 均为空）。

## 它做什么

- 在浏览器中对一组**可编辑的小型固定数据**（Q/K/V、0/1 屏蔽矩阵、输出投影 Wo/bo、门投影 Wg/bg）运行稳定（softmax 减最大值）缩放点积注意力。
- 每个查询的门分数由 `sigmoid(q · Wg + bg)` 得到，作用点严格位于**各头注意力输出之后、头拼接与最终 Wo 投影之前**。
- 两种门控粒度，切换时必须显式选择参数处理方式：
  - **整头标量门（scalar）**：Wg 形状 `d_model × num_heads`，每个头一个分数，乘遍该头所有特征。
  - **逐元素向量门（vector）**：Wg 形状 `d_model × d_model`，每个头内每个特征位置一个分数。
  - 切换可选择**重建**（固定种子重新生成）或**保留**（复用前缀，新增置 0 即 sigmoid=0.5，多余截断），绝不静默广播。
- **暂停门控**可查看同输入的无门基线（门分数恒为 1），页面同步展示：
  注意力权重（SVG 热力图 + 数值表）、softmax 前分数、门 logit/sigmoid 分数（SVG 条图 + 表）、
  各头门前/门后输出、头拼接、最终投影、无门基线投影以及二者差值 Δ。
- 调节某个头的门参数**只改变该头门后输出**，注意力权重保持不变（有测试保证）。

## 边界与错误处理

- 非有限输入（NaN/Infinity）、维度冲突、参差矩阵、mask 非 0/1：文本框标红并给出行列定位的中文错误。
- 非法编辑**不会覆盖上次有效结果**；结果区继续显示旧结果并标注“上次有效结果”，文本框保留错误内容，修正后自动恢复。
- 全屏蔽查询行：权重行全 0、各头输出为 0、最终投影（含偏置）强制为 0，并用“全屏蔽=0”标记。
- 极端门分数（±1e308 等）经稳定 sigmoid（钳制 ±60）处理，输出严格落在 [0,1] 且始终有限。

## 使用

```bash
npm run build   # 语法检查并产出 dist/（无打包器）
npm test        # 27 个自行结束的测试（数学语义 + 状态 + 视图 + UI 模拟 + HTTP 服务器）
npm start       # 默认 http://127.0.0.1:8080

# 自定义监听
node src/server/server.js --host 0.0.0.0 --port 9000
node src/server/server.js --port 0      # 0 = 操作系统分配动态端口，启动后打印实际地址
```

## 代码结构

- `src/core/matmul.js`：严格维度校验的矩阵/向量运算（拒绝静默广播、点积溢出保护）。
- `src/core/attention.js`：稳定 softmax 的逐头缩放点积注意力与屏蔽处理。
- `src/core/gate.js`：稳定 sigmoid / logit 钳制。
- `src/core/forward.js`：注意力 → 门 → 拼接 → Wo/bo 投影；同时产出无门基线与差值。
- `src/core/parse.js`、`schema.js`、`store.js`、`view.js`：文本解析、固定小数据、状态管理、SVG/表格渲染（纯函数，可直接在 Node 测试）。
- `public/`：原生 DOM/SVG 前端（`app.js` 复用同一套 core 模块）。
- `src/server/server.js`：Node 内置 `http` 静态服务器。
- `test/*.test.js`：`node --test` 测试，含一个零依赖最小 DOM 垫片驱动真实 `public/app.js` 的交互冒烟测试。
