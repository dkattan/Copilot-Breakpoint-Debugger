import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";

import { startDebuggingAndWaitForStop } from "../session";

import {
  activateCopilotDebugger,
  getExtensionRoot,
  openScriptDocument,
  stopAllDebugSessions,
} from "./utils/startDebuggerToolTestUtils";

describe("function breakpoints", function () {
  // Debug adapter startup can be slow under load.
  this.timeout(180_000);

  afterEach(async () => {
    await stopAllDebugSessions();
  });

  it("fails fast when adapter does not support function breakpoints (js-debug)", async () => {
    await activateCopilotDebugger();

    const extensionRoot = getExtensionRoot();
    const workspaceFolder = path.join(extensionRoot, "test-workspace");
    const scriptPath = path.join(workspaceFolder, "test.js");

    await openScriptDocument(vscode.Uri.file(scriptPath));

    await assert.rejects(
      () =>
        startDebuggingAndWaitForStop({
          sessionName: "",
          workspaceFolder,
          nameOrConfiguration: "Run test.js",
          timeoutSeconds: 90,
          mode: "singleShot",
          breakpointConfig: {
            functionBreakpoints: [
              {
                // Name is adapter-specific; this test is about capability gating.
                functionName: "definitelyNotARealFunctionName",
                onHit: "break",
                variable: "*",
              },
            ],
          },
        }),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        // Emit the message so test output makes it obvious what happened.
        // This is intentionally a negative test in the default environment where js-debug
        // does not advertise supportsFunctionBreakpoints=true.
        console.log(`[function breakpoints] expected failure message: ${msg}`);
        return msg.includes("supportsFunctionBreakpoints=true");
      },
    );
  });
});
