const http = require('node:http');

const requestedPortRaw = process.env.COPILOT_DEBUGGER_TEST_PORT;
const requestedPort = requestedPortRaw ? Number.parseInt(requestedPortRaw, 10) : NaN;
const port = Number.isFinite(requestedPort) ? requestedPort : 31337;
let boundPort = port;
// eslint-disable-next-line no-unused-vars, unused-imports/no-unused-vars
let started = false; // referenced by breakpoint variable

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${boundPort}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } else if (url.pathname === '/api/echo') {
    const q = url.searchParams.get('q') ?? '';
    const queryParam = q;
    const queryParamForDebugger = queryParam;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, queryParam }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(port, () => {
  const address = server.address();
  if (address && typeof address === 'object') {
    boundPort = address.port;
  }
  // serverReady breakpoint target (line below) - indicates server accepting connections
  started = true; // LINE_FOR_SERVER_READY
  console.log(`Server listening on http://localhost:${boundPort}`);
});

// Emit a repeated line so breakpoint-based tests have a stable target even if the
// first server.listen callback line is missed due to breakpoint-binding races.
const tickInterval = setInterval(() => {
  console.log('TICK_FOR_USER_BREAKPOINT');
}, 200);

// Keep process alive for a short period
setTimeout(() => {
  console.log('Shutting down server');
  clearInterval(tickInterval);
  server.close();
}, 5000);
