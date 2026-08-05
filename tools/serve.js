/**
 * Chronicle Atlas — ローカル確認用の静的ファイルサーバー(依存パッケージ不要、Node標準のみ)
 * 使い方: node tools/serve.js [port]  (デフォルト port は 8420)
 * 停止: Ctrl+C、または tools/stop-serve.bat
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2]) || 8420;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`404 Not Found: ${urlPath}`);
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use.`);
    console.error(`Run tools\\stop-serve.bat to stop it first.\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log('=========================================');
  console.log(' Chronicle Atlas - local server running');
  console.log('=========================================');
  console.log(`  http://localhost:${PORT}/index.html`);
  console.log('');
  console.log('  Stop with Ctrl+C, or close this window.');
  console.log('=========================================');
});
