import type { InitializeCapabilities } from "../testTypes";

import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";

import { getSessionCapabilities } from "../events";
import { startDebuggingAndWaitForStop } from "../session";

import {
  activateCopilotDebugger,
  getExtensionRoot,
  openScriptDocument,
  stopAllDebugSessions,
} from "./utils/startDebuggerToolTestUtils";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

describe("javascript (node) DAP capabilities", function () {
  // Debug adapter startup can be slow under load.
  this.timeout(180_000);

  afterEach(async () => {
    await stopAllDebugSessions();
  });

  it("captures initialize capabilities from the Node debug adapter", async () => {
    await activateCopilotDebugger();

    const extensionRoot = getExtensionRoot();
    const workspaceFolder = path.join(extensionRoot, "test-workspace");
    const scriptPath = path.join(workspaceFolder, "test.js");

    await openScriptDocument(vscode.Uri.file(scriptPath));

    const stopInfo = await startDebuggingAndWaitForStop({
      sessionName: "",
      workspaceFolder,
      nameOrConfiguration: "Run test.js",
      mode: "inspect",
      timeoutSeconds: 90,
      breakpointConfig: {
        breakpoints: [
          {
            path: scriptPath,
            code: "console.log(\"Running test.js inside test-workspace\");",
            onHit: "break",
            variable: "*",
          },
        ],
      },
    });

    const sessionId = stopInfo.debuggerState.sessionId;
    assert.ok(sessionId, "Expected debuggerState.sessionId to be present in inspect mode");

    // Capabilities arrive via the DAP initialize response and are captured by our tracker.
    // Poll briefly because message ordering can vary slightly by adapter/runtime.
    const pollStart = Date.now();
    let caps: unknown;
    while (Date.now() - pollStart < 5_000) {
      caps = getSessionCapabilities(sessionId);
      if (caps !== undefined) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const rec = asRecord(caps);
    if (!rec) {
      assert.fail("Expected initialize capabilities to be captured for the session");
    }

    const capsRec = rec as unknown as InitializeCapabilities & Record<string, unknown>;

    const exceptionFilters = Array.isArray(capsRec.exceptionBreakpointFilters)
      ? capsRec.exceptionBreakpointFilters
          .map(f => (typeof f?.filter === "string" ? f.filter : undefined))
          .filter((f): f is string => !!f)
      : [];

    const summary = {
      supportsConditionalBreakpoints: capsRec.supportsConditionalBreakpoints ?? null,
      supportsHitConditionalBreakpoints: capsRec.supportsHitConditionalBreakpoints ?? null,
      supportsLogPoints: capsRec.supportsLogPoints ?? null,
      supportsFunctionBreakpoints: capsRec.supportsFunctionBreakpoints ?? null,
      supportsDataBreakpoints: capsRec.supportsDataBreakpoints ?? null,
      supportsInstructionBreakpoints: capsRec.supportsInstructionBreakpoints ?? null,
      supportsExceptionOptions: capsRec.supportsExceptionOptions ?? null,
      exceptionBreakpointFilters: exceptionFilters,
    };

    console.log(`[js-dap-capabilities] Node debug adapter initialize capability summary:\n${JSON.stringify(summary, null, 2)}`);

    // Loose assertions: we only require that the adapter reports these as booleans if present.
    // This test is intended to *detect* what the adapter supports without hardcoding values.
    const booleanKeys = [
      "supportsConditionalBreakpoints",
      "supportsHitConditionalBreakpoints",
      "supportsLogPoints",
      "supportsFunctionBreakpoints",
      "supportsDataBreakpoints",
      "supportsInstructionBreakpoints",
      "supportsExceptionOptions",
    ] as const satisfies ReadonlyArray<keyof InitializeCapabilities>;

    for (const key of booleanKeys) {
      const value: unknown = capsRec[key];
      if (value === undefined) {
        continue;
      }
      assert.strictEqual(
        typeof value,
        "boolean",
        `Expected capability '${key}' to be a boolean when present, got ${typeof value}`,
      );
    }

    // Sanity check that we captured at least something meaningful.
    assert.ok(
      Object.keys(rec).length > 0,
      "Expected initialize capabilities object to have at least one key",
    );
  });
});
