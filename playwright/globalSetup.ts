import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as process from "node:process";

function loadEnvFileIfPresent(envFilePath: string): void {
  // Minimal, dependency-free .env loader.
  // - Ignores blank lines and comments (# ...)
  // - Supports KEY=VALUE, with optional surrounding quotes
  // - Does not override existing process.env entries
  if (!fs.existsSync(envFilePath)) {
    return;
  }

  const content = fs.readFileSync(envFilePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }

    const key = line.slice(0, eq).trim();
    if (!key) {
      continue;
    }
    if (process.env[key] !== undefined) {
      continue;
    }

    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function tryDiscoverVSCodeExecutablePath(): string | undefined {
  // Prefer app bundles on macOS (most reliable for Playwright electron launch).
  if (os.platform() === "darwin") {
    const candidates = [
      "/Applications/Visual Studio Code.app",
      "/Applications/Visual Studio Code Insiders.app",
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return c;
      }
    }
  }

  // Best-effort PATH lookup.
  // NOTE: On macOS this often returns a shim script; the harness can still
  // handle it, but for the demo we prefer the .app if available.
  const isWindows = os.platform() === "win32";
  const commands = isWindows ? ["code.cmd", "code"] : ["code", "code-insiders"];
  for (const cmd of commands) {
    const res = cp.spawnSync(isWindows ? "where" : "which", [cmd], {
      encoding: "utf8",
    });
    if (res.status === 0 && typeof res.stdout === "string") {
      const firstLine = res.stdout
        .split(/\r?\n/)
        .map(s => s.trim())
        .find(Boolean);
      if (firstLine) {
        return firstLine;
      }
    }
  }

  return undefined;
}

function tryDiscoverVSCodeFromVscodeTestDir(): string | undefined {
  // When running in CI (or after running extension tests locally), @vscode/test-cli
  // downloads VS Code into `.vscode-test/`. Prefer that deterministic copy when present
  // to avoid any manual PW_VSCODE_EXECUTABLE_PATH setup.
  const vscodeTestDir = path.join(process.cwd(), ".vscode-test");
  if (!fs.existsSync(vscodeTestDir)) {
    return undefined;
  }

  const candidates: string[] = [];

  // macOS: `.vscode-test/**/Visual Studio Code.app`
  if (os.platform() === "darwin") {
    candidates.push(
      path.join(vscodeTestDir, "vscode-darwin-arm64-", "Visual Studio Code.app"),
    );
    // We don't know the exact versioned folder name ahead of time, so scan.
    try {
      const entries = fs.readdirSync(vscodeTestDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) {
          continue;
        }
        const dir = path.join(vscodeTestDir, e.name);
        const app = path.join(dir, "Visual Studio Code.app");
        if (fs.existsSync(app)) {
          return app;
        }
        // @vscode/test-cli also creates worker folders like `.vscode-test/worker-0/...`
        if (e.name.startsWith("worker-")) {
          try {
            const workerEntries = fs.readdirSync(dir, { withFileTypes: true });
            for (const we of workerEntries) {
              if (!we.isDirectory()) {
                continue;
              }
              const wdir = path.join(dir, we.name);
              const wapp = path.join(wdir, "Visual Studio Code.app");
              if (fs.existsSync(wapp)) {
                return wapp;
              }
            }
          }
          catch {
            // Ignore and continue scanning.
          }
        }
      }
    }
    catch {
      // Ignore and continue with other discovery strategies.
    }
  }

  // Windows: `.vscode-test/**/Code.exe`
  if (os.platform() === "win32") {
    try {
      const entries = fs.readdirSync(vscodeTestDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) {
          continue;
        }
        const exe = path.join(vscodeTestDir, e.name, "Code.exe");
        if (fs.existsSync(exe)) {
          return exe;
        }
      }
    }
    catch {
      // Ignore.
    }
  }

  // Linux: `.vscode-test/**/code` (common layout from @vscode/test-electron)
  if (os.platform() === "linux") {
    try {
      const entries = fs.readdirSync(vscodeTestDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) {
          continue;
        }
        const linuxDir = path.join(vscodeTestDir, e.name);
        // Typical: VSCode-linux-x64/code
        const codeBin = path.join(linuxDir, "code");
        if (fs.existsSync(codeBin)) {
          return codeBin;
        }
        const nested = path.join(linuxDir, "VSCode-linux-x64", "code");
        if (fs.existsSync(nested)) {
          return nested;
        }
      }
    }
    catch {
      // Ignore.
    }
  }

  // If none of the platform-specific heuristics found a path, bail.
  // The harness can still attempt its own discovery if enabled.
  void candidates;
  return undefined;
}

export default async function globalSetup(): Promise<void> {
  // Optional: support local overrides via `.env.playwright` (if present), but do not
  // require it. This keeps fresh clones working with zero manual setup.
  loadEnvFileIfPresent(path.join(process.cwd(), ".env.playwright"));

  if (!process.env.PW_VSCODE_EXECUTABLE_PATH) {
    const fromVscodeTest = tryDiscoverVSCodeFromVscodeTestDir();
    if (fromVscodeTest) {
      process.env.PW_VSCODE_EXECUTABLE_PATH = fromVscodeTest;
    }
  }

  if (!process.env.PW_VSCODE_EXECUTABLE_PATH) {
    const discovered = tryDiscoverVSCodeExecutablePath();
    if (discovered) {
      process.env.PW_VSCODE_EXECUTABLE_PATH = discovered;
    }
  }

  // Default user-data cloning for the demo.
  //
  // Why: When VS Code is already running (very common during local dev), launching
  // another instance with the same user-data/profile can “handoff” to the existing
  // process and exit immediately. Playwright then observes the Electron app closing
  // before `firstWindow()` appears.
  //
  // Cloning preserves auth state (GitHub/Copilot) while also ensuring we always get
  // a fresh, isolated `--user-data-dir` for a deterministic demo recording.
  if (!process.env.PW_VSCODE_CLONE_USER_DATA_FROM) {
    process.env.PW_VSCODE_CLONE_USER_DATA_FROM = "default";
  }
  if (!process.env.PW_VSCODE_CLONE_MODE) {
    process.env.PW_VSCODE_CLONE_MODE = "minimal";
  }
  if (!process.env.PW_VSCODE_CLONE_INCLUDE_GLOBAL_STORAGE) {
    process.env.PW_VSCODE_CLONE_INCLUDE_GLOBAL_STORAGE = "1";
  }

  if (process.env.PW_VSCODE_EXECUTABLE_PATH) {
    return;
  }

  // If we couldn't discover it ourselves, enable the harness's opt-in auto
  // discovery (it has some additional heuristics).
  process.env.PW_VSCODE_AUTO_DISCOVER = "1";

  throw new Error(
    "PW_VSCODE_EXECUTABLE_PATH is not set and VS Code could not be auto-discovered. "
    + "For the Playwright demo, we need a VS Code executable to launch.\n\n"
    + "Fix options:\n"
    + "- Install VS Code to /Applications (macOS) or ensure 'code' is on PATH\n"
    + "- Or run the extension tests once to populate .vscode-test/ (CI does this automatically)\n"
    + "- Or set PW_VSCODE_EXECUTABLE_PATH in the environment (recommended for GitHub Actions)\n\n"
    + "Discovery tried: .vscode-test download, /Applications app bundle (macOS), and PATH lookup ('which code' / 'which code-insiders' or 'where' on Windows).",
  );
}
