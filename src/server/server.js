// 极简静态服务器（仅 Node 内置模块）。
// 用法：node src/server/server.js [--host 127.0.0.1] [--port 8080]
// --port 0 表示由操作系统分配动态端口，启动后打印实际监听地址。

import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../..');
const PUBLIC = path.join(ROOT, 'public');
const DIST = path.join(ROOT, 'dist');

function parseArgs(argv) {
  const args = { host: process.env.HOST || '127.0.0.1', port: process.env.PORT || '8080' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--host') args.host = argv[++i];
    else if (argv[i] === '--port') args.port = argv[++i];
    else if (argv[i].startsWith('--host=')) args.host = argv[i].slice(7);
    else if (argv[i].startsWith('--port=')) args.port = argv[i].slice(7);
  }
  const port = Number(args.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`非法端口：${args.port}`);
  }
  return { host: args.host, port };
}

const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);

function tryFiles(urlPath) {
  // 构建产物优先；其次 public；/src/* 直接映射源码（供浏览器 import 同构核心）
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  if (clean.includes('\0')) return null;
  const candidates = [];
  const rel = clean === '/' ? 'index.html' : clean.replace(/^\/+/, '');
  for (const base of [DIST, PUBLIC]) {
    // /src/* 在构建产物中位于 dist/src/*；开发时映射到源码根 src/*
    const suffix = clean.startsWith('/src/') && base === DIST ? clean : '/' + rel;
    const p = path.normalize(path.join(base, suffix));
    if (p.startsWith(base + path.sep)) candidates.push(p);
  }
  // 开发兜底：直接读源码根目录（即使 dist 尚未构建）
  if (clean.startsWith('/src/')) {
    const p = path.normalize(path.join(ROOT, clean));
    if (p.startsWith(ROOT + path.sep)) candidates.push(p);
  }
  for (const p of candidates) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

export function createServer() {
  return http.createServer((req, res) => {
    const file = tryFiles(req.url || '/');
    if (!file || !existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES.get(path.extname(file)) || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
}

function main() {
  const { host, port } = parseArgs(process.argv);
  const server = createServer();
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`端口 ${port} 已被占用，可改用 --port 0 获取动态端口。`);
    } else {
      console.error(err.message);
    }
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    const a = server.address();
    const shownHost = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`多头注意力门控调试台已启动: http://${shownHost}:${a.port}`);
    console.log(`(实际监听 ${host}:${a.port}; Ctrl+C 停止)`);
  });
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  main();
}
