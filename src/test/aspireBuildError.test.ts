import type * as vscode from "vscode";
import * as assert from "node:assert";
import * as vscodeReal from "vscode";
import { config } from "../config";
import {
  invokeStartDebuggerTool,
  stopAllDebugSessions,
} from "./utils/startDebuggerToolTestUtils";

describe("startDebuggerTool Aspire build errors", () => {
  let originalTimeout: number | undefined;

  before(async () => {
    // Keep this short so adapter-build failures don't burn 60s per run.
    originalTimeout = config.entryTimeoutSeconds;
    await config.$update(
      "entryTimeoutSeconds",
      10,
      vscodeReal.ConfigurationTarget.Workspace,
    );
  });

  after(async () => {
    await config.$update(
      "entryTimeoutSeconds",
      originalTimeout ?? 60,
      vscodeReal.ConfigurationTarget.Workspace,
    );
  });

  afterEach(async () => {
    await stopAllDebugSessions();
  });

  it("includes AppHost syntax errors from preLaunchTask output", async function () {
    this.timeout(60000);

    const result = await invokeStartDebuggerTool({
      scriptRelativePath: "test-workspace/aspire-build-error-test/AppHost/AppHost.cs",
      configurationName: "Aspire Build Error Test",
      variable: "builder",
      breakpointSnippets: [
        "DistributedApplication.CreateBuilder",
      ],
      workspaceFolder: "test-workspace/aspire-build-error-test",
    });

    const { content } = result;
    assert.ok(content.length === 1, "expected single output part");
    const text = (content[0] as vscode.LanguageModelTextPart).value as string;

    assert.match(text, /Success:\s*false/i, "Expected StartDebuggerTool failure");
    assert.match(text, /Failure:\s*error/i, "Expected error failure category");
    assert.match(
      text,
      /dotnet build apphost with syntax error/i,
      "Expected preLaunchTask label in output",
    );
    assert.match(
      text,
      /AppHost\.cs/i,
      "Expected source file name in build error output",
    );

    const hasCompilerError = /error\s+CS\d+/i.test(text) || /; expected/i.test(text);
    assert.ok(
      hasCompilerError,
      `Expected compiler syntax error details in output. Got: ${text}`,
    );
  });
});
