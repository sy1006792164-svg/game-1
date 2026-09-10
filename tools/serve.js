'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function createPreviewServer() {
  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end('Method not allowed');
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname.includes('\0')) throw new Error('Invalid path');
    } catch (_) {
      res.writeHead(400); return res.end('Bad request');
    }
    const file = pathname === '/' ? path.join(root, 'preview/index.html') : path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep) || !['.html', '.js', '.wav', '.svg', '.png', '.css'].includes(path.extname(file))) {
      res.writeHead(403); return res.end('Forbidden');
    }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404); return res.end('Not found'); }
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.wav': 'audio/wav', '.svg': 'image/svg+xml', '.png': 'image/png', '.css': 'text/css' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Content-Length': data.length,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
}

if (require.main === module) {
  require('./build');
  const port = Number(process.argv[2]) || Number(process.env.PORT) || 8765;
  createPreviewServer().listen(port, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:' + port));
}

module.exports = { createPreviewServer };
