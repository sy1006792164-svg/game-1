'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
require('./build');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT) || 8765;
http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = pathname === '/' ? path.join(root, 'preview/index.html') : path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep) || !['.html', '.js', '.wav', '.svg', '.png', '.css'].includes(path.extname(file))) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); return res.end('Not found'); }
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.wav': 'audio/wav', '.svg': 'image/svg+xml', '.png': 'image/png', '.css': 'text/css' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:' + port));
