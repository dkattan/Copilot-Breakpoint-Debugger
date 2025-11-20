const http = require('node:http');

const port = 31337;
// eslint-disable-next-line no-unused-vars, unused-imports/no-unused-vars
let started = false; // referenced by breakpoint variableFilter

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(port, () => {
  // serverReady breakpoint target (line below) - indicates server accepting connections
  started = true; // LINE_FOR_SERVER_READY
  console.log(`Server listening on http://localhost:${port}`);
});

// Keep process alive for a short period
setTimeout(() => {
  console.log('Shutting down server');
  server.close();
}, 5000);
