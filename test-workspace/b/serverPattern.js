const http = require("node:http");

const port = 31338;
let readyFlag = false; // referenced by user breakpoint
let readyHits = 0;

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, readyFlag, readyHits }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(port, () => {
  // serverReady pattern target (line below)
  console.log(`Pattern server listening on http://localhost:${port}`);
  readyFlag = true; // PATTERN_READY_LINE
  readyHits += 1; // USER_BREAKPOINT_TARGET
});

setTimeout(() => {
  server.close();
}, 2000);
