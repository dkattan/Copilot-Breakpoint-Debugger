// Minimal PowerShell script shim for tests.
// This avoids requiring pwsh to be installed on the machine running the VS Code extension tests.
// Supported subset:
//   - Write-Host "..."
//   - exit <number>
// Any unsupported content will cause a non-zero exit with a clear error.

const fs = require('node:fs');

const scriptPath = process.argv[2];
if (!scriptPath) {
  console.error('Usage: node run-ps1-shim.js <path-to-ps1>');
  process.exit(2);
}

let text;
try {
  text = fs.readFileSync(scriptPath, 'utf8');
} catch (e) {
  console.error(`Failed to read script: ${scriptPath}`);
  process.exit(2);
}

const lines = text
  .split(/\r?\n/)
  .map(l => l.trim())
  .filter(l => l.length > 0);

let exitCode = 0;
for (const line of lines) {
  const writeHostMatch = line.match(/^Write-Host\s+"([\s\S]*)"\s*$/);
  if (writeHostMatch) {
    process.stdout.write(`${writeHostMatch[1]}\n`);
    continue;
  }

  const exitMatch = line.match(/^exit\s+(-?\d+)\s*$/i);
  if (exitMatch) {
    exitCode = Number.parseInt(exitMatch[1], 10);
    continue;
  }

  console.error(`Unsupported PowerShell syntax in test shim: ${line}`);
  process.exit(2);
}

process.exit(exitCode);
