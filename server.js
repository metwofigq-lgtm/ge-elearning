import http from 'node:http';
import { readFile } from 'node:fs/promises';
const host = '127.0.0.1';
const port = Number(process.env.PORT || 4187);
const html = await readFile(new URL('./web/index.html', import.meta.url));
const server = http.createServer((req, res) => {
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  if (path === '/health') {
    res.writeHead(200, {'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({status:'ok',service:'ge-elearning',mode:'staging'}));
    return;
  }
  if (path !== '/') {
    res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'});
    res.end('Not found');
    return;
  }
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'none'; frame-ancestors 'none'"});
  res.end(html);
});
server.listen(port, host, () => console.log('GE E-Learning staging listening on '+host+':'+port));
