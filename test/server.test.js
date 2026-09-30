import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'src/server/server.js');

function get(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body, type: res.headers['content-type'] || '' }));
    });
    req.on('error', reject);
  });
}

function startServer(args, { onPort = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER, ...args], { cwd: ROOT });
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        child.kill('SIGKILL');
        reject(new Error('server start timeout'));
      }
    }, 5000);
    child.stdout.on('data', (d) => {
      const line = d.toString();
      const m = line.match(/http:\/\/[^:]+:(\d+)/);
      if (m && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ child, port: Number(m[1]), output: line.trim() });
      }
    });
    child.stderr.on('data', (d) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        child.kill('SIGKILL');
        reject(new Error(d.toString()));
      }
    });
    child.on('exit', (code) => {
      if (!settled) reject(new Error('server exited early: ' + code));
    });
  });
}

test('服务器：--port 0 动态分配并打印实际地址，页面/核心模块可访问', async () => {
  const { child, port, output } = await startServer(['--host', '127.0.0.1', '--port', '0']);
  after(() => child.kill('SIGTERM'));
  assert.ok(port > 0, '打印的端口应为临时端口: ' + output);
  assert.match(output, new RegExp(`http://127\\.0\\.0\\.1:${port}`));

  const home = await get(port, '/');
  assert.equal(home.status, 200);
  assert.match(home.type, /text\/html/);
  assert.match(home.body, /多头注意力/);

  const core = await get(port, '/src/core/forward.js');
  assert.equal(core.status, 200);
  assert.match(core.type, /javascript/);
  assert.match(core.body, /export function forward/);

  const app = await get(port, '/app.js');
  assert.equal(app.status, 200);
});

test('服务器：--host/--port 参数生效，未知路径 404，路径穿越被拒', async () => {
  const { child, port } = await startServer(['--port', '0']);
  after(() => child.kill('SIGTERM'));

  assert.equal((await get(port, '/nope.js')).status, 404);
  const trav = await get(port, '/../package.json');
  assert.ok(trav.status === 404 || !trav.body.includes('gated-output-lab'));
});

test('服务器：非法端口参数直接报错退出（自行结束）', async () => {
  const child = spawn(process.execPath, [SERVER, '--port', '99999'], { cwd: ROOT });
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.notEqual(code, 0);
});
