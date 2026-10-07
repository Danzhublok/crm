import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const project = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(project, 'dist');
const demo = path.join(project, 'demo', 'APRESENTAR-CRM.html');
const compiled = fs.existsSync(path.join(root, 'index.html'));
if (!compiled && !fs.existsSync(demo)) {
  console.error('CRM nao encontrado. Extraia a pasta completa do projeto ou execute npm ci e npm run build.');
  process.exit(1);
}
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    let file;
    if (compiled) {
      file = path.resolve(root, relative || 'index.html');
      if (file !== root && !file.startsWith(root + path.sep)) {
        res.writeHead(403); res.end(); return;
      }
    } else {
      if (relative && relative !== 'index.html') {
        res.writeHead(404); res.end('Arquivo nao encontrado'); return;
      }
      file = demo;
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end('Arquivo nao encontrado'); return;
    }
    res.writeHead(200, {'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache'});
    fs.createReadStream(file).pipe(res);
  } catch {
    res.writeHead(400); res.end('Requisicao invalida');
  }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? 'A porta ja esta em uso. Feche a outra janela do CRM e tente novamente.' : error.message);
  process.exitCode = 1;
});
const port = Number(process.env.PORT || 4173);
server.listen(port, '127.0.0.1', () => console.log(`Nexus CRM disponivel em http://127.0.0.1:${server.address().port}\n${compiled ? 'Versao compilada' : 'Demonstracao incluida: nenhuma compilacao necessaria'}\nMantenha esta janela aberta. Ctrl+C para encerrar.`));
