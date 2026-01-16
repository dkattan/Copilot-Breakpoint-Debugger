import type { BreakpointDefinition } from "../BreakpointDefinition";
import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { type ScopeVariables, startDebuggingAndWaitForStop } from "../session";
import {
  activateCopilotDebugger,
  getExtensionRoot,
  openScriptDocument,
  stopAllDebugSessions,
} from "./utils/startDebuggerToolTestUtils";

describe("snippet-based breakpoints", function () {
  // Debug adapter startup + step/variable capture can be slow under full-suite load.
  this.timeout(240_000);

  afterEach(async () => {
    await stopAllDebugSessions();
  });

  it("resolves a snippet that matches multiple lines (sets breakpoints on all)", async () => {
    await activateCopilotDebugger();

    const extensionRoot = getExtensionRoot();
    const workspaceFolder = path.join(extensionRoot, "test-workspace");
    const scriptPath = path.join(workspaceFolder, "test.js");
    const scriptUri = vscode.Uri.file(scriptPath);
    const doc = await vscode.workspace.openTextDocument(scriptUri);
    await openScriptDocument(scriptUri);

    const snippet = "console.log"; // matches multiple lines
    const expectedFirstLine =
      doc
        .getText()
        .split(/\r?\n/)
        .findIndex((l) => l.includes(snippet)) + 1;
    assert.ok(expectedFirstLine > 0, "Expected snippet to exist in test.js");

    const context = await startDebuggingAndWaitForStop({
      sessionName: "",
      workspaceFolder,
      nameOrConfiguration: "Run test.js",
      timeoutSeconds: 90,
      breakpointConfig: {
        breakpoints: [
          {
            path: scriptPath,
            code: snippet,
            onHit: "break",
            variableFilter: [],
          },
        ],
      },
    });

    assert.strictEqual(
      context.frame.line,
      expectedFirstLine,
      "Did not pause on the first matching snippet breakpoint"
    );
    assert.ok(context.hitBreakpoint, "hitBreakpoint missing");
    assert.strictEqual(context.hitBreakpoint.code, snippet);
    assert.strictEqual(context.hitBreakpoint.line, expectedFirstLine);
  });

  it("throws a clear error when snippet is not found", async () => {
    await activateCopilotDebugger();

    const extensionRoot = getExtensionRoot();
    const workspaceFolder = path.join(extensionRoot, "test-workspace");
    const scriptPath = path.join(workspaceFolder, "test.js");
    const scriptUri = vscode.Uri.file(scriptPath);
    await openScriptDocument(scriptUri);

    const missing = "THIS_SNIPPET_DOES_NOT_EXIST_123";

    await assert.rejects(
      () =>
        startDebuggingAndWaitForStop({
          sessionName: "",
          workspaceFolder,
          nameOrConfiguration: "Run test.js",
          breakpointConfig: {
            breakpoints: [
              {
                path: scriptPath,
                code: missing,
                onHit: "break",
                variableFilter: [],
              },
            ],
          },
        }),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        return /not found/i.test(msg) && msg.includes(missing);
      }
    );
  });

  it("throws when 'code' snippet is missing (even if line is provided)", async () => {
    await activateCopilotDebugger();
    const extensionRoot = getExtensionRoot();
    const workspaceFolder = path.join(extensionRoot, "test-workspace");
    const scriptPath = path.join(workspaceFolder, "test.js");

    await assert.rejects(
      () =>
        startDebuggingAndWaitForStop({
          sessionName: "",
          workspaceFolder,
          nameOrConfiguration: "Run test.js",
          breakpointConfig: {
            breakpoints: [
              {
                path: scriptPath,
                line: 10,
                onHit: "break",
                variableFilter: [],
              } as unknown as BreakpointDefinition, // Cast to bypass TS check for missing 'code'
            ],
          },
        }),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        return msg.includes("missing required 'code' snippet");
      }
    );
  });

  it("autoStepOver captures before/after values around an assignment", async () => {
    await activateCopilotDebugger();

    const extensionRoot = getExtensionRoot();
    const workspaceFolder = path.join(extensionRoot, "test-workspace");
    const scriptPath = path.join(workspaceFolder, "test.js");
    const scriptUri = vscode.Uri.file(scriptPath);
    const doc = await vscode.workspace.openTextDocument(scriptUri);
    await openScriptDocument(scriptUri);

    const assignmentSnippet = "assignedValue = 1";
    const assignmentLine =
      doc
        .getText()
        .split(/\r?\n/)
        .findIndex((l) => l.includes(assignmentSnippet)) + 1;
    assert.ok(
      assignmentLine > 0,
      "Expected assignment snippet to exist in test.js"
    );

    const context = await startDebuggingAndWaitForStop({
      sessionName: "",
      workspaceFolder,
      nameOrConfiguration: "Run test.js",
      timeoutSeconds: 180,
      breakpointConfig: {
        breakpoints: [
          {
            path: scriptPath,
            code: assignmentSnippet,
            onHit: "break",
            autoStepOver: true,
            variableFilter: ["assignedValue"],
          },
        ],
      },
    });

    assert.ok(context.stepOverCapture?.performed, "Expected stepOverCapture");
    assert.strictEqual(context.stepOverCapture?.fromLine, assignmentLine);
    assert.ok(
      typeof context.stepOverCapture?.toLine === "number" &&
        (context.stepOverCapture?.toLine as number) > assignmentLine,
      "Expected toLine to be after the assignment line"
    );

    const findVar = (scopes: ScopeVariables[]) => {
      for (const scope of scopes) {
        for (const v of scope.variables ?? []) {
          if (v.name === "assignedValue") {
            return v.value;
          }
        }
      }
      return undefined;
    };

    const beforeVal = findVar(context.stepOverCapture!.before);
    const afterVal = findVar(context.stepOverCapture!.after);
    assert.strictEqual(beforeVal, "0");
    assert.strictEqual(afterVal, "1");
  });
});
