// 无打包器构建：校验全部 JS 语法 -> 输出 dist/（public 副本 + 同构 core 副本）+ 构建元数据。
import { spawnSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'src/core/matmul.js', 'src/core/attention.js', 'src/core/gate.js',
  'src/core/forward.js', 'src/core/parse.js', 'src/core/schema.js',
  'src/core/store.js', 'src/core/view.js',
  'src/server/server.js', 'public/app.js',
];

let failed = false;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`语法检查失败: ${f}\n${r.stderr}`);
    failed = true;
  }
}
if (failed) process.exit(1);

rmSync(path.join(ROOT, 'dist'), { recursive: true, force: true });
mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
cpSync(path.join(ROOT, 'public'), path.join(ROOT, 'dist'), { recursive: true });
cpSync(path.join(ROOT, 'src', 'core'), path.join(ROOT, 'dist', 'src', 'core'), { recursive: true });
writeFileSync(
  path.join(ROOT, 'dist', 'build-meta.json'),
  JSON.stringify({ name: 'gated-output-lab', filesChecked: files.length, builtAt: 'deterministic-build' }, null, 2) + '\n'
);
console.log(`build ok: 语法检查 ${files.length} 个文件，输出到 dist/`);
