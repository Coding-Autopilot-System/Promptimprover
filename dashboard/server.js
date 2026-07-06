// C:\PersonalRepo\portfolio\Promptimprover\dashboard\server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { once } = require('events');

const TRACE_FILE = path.resolve('C:/PersonalRepo/.planning/traces.jsonl');
const STATIC_DIR = path.join(__dirname);
const PORT = 3000;

// Helper: read last N lines from trace file
async function readLastLines(filePath, maxLines = 20) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  let data = '';
  stream.on('data', chunk => { data += chunk; });
  await once(stream, 'end');
  const lines = data.trim().split(/\r?\n/);
  const recent = lines.slice(-maxLines);
  // parse each JSON line safely
  return recent.map(l => {
    try { return JSON.parse(l); } catch (_) { return null; }
  }).filter(Boolean);
}

function serveStatic(res, filePath, contentType) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
    serveStatic(res, path.join(STATIC_DIR, 'index.html'), 'text/html');
  } else if (parsed.pathname === '/style.css') {
    serveStatic(res, path.join(STATIC_DIR, 'style.css'), 'text/css');
  } else if (parsed.pathname === '/data') {
    try {
      const logs = await readLastLines(TRACE_FILE, 20);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(logs));
    } catch (e) {
      res.writeHead(500);
      res.end('Error reading trace file');
    }
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Promptimprover dashboard listening on http://localhost:${PORT}`);
});
