import * as assert from "node:assert";
import * as vscode from "vscode";
import { config } from "../config";
import { truncateToolOutputText } from "../outputTruncation";

describe("tool output truncation", () => {
  let originalMax: number;

  before(async () => {
    originalMax = config.maxOutputChars;
  });

  afterEach(async () => {
    await config.$update(
      "maxOutputChars",
      originalMax,
      vscode.ConfigurationTarget.Workspace,
    );
  });

  it("truncates tool output to configured maxOutputChars", async () => {
    await config.$update(
      "maxOutputChars",
      200,
      vscode.ConfigurationTarget.Workspace,
    );
    assert.strictEqual(config.maxOutputChars, 200);

    const longText = "x".repeat(500);
    const truncated = truncateToolOutputText(longText);

    assert.strictEqual(truncated.truncated, true);
    assert.strictEqual(truncated.maxLength, 200);
    assert.ok(
      truncated.text.length <= 200,
      `Expected truncated length <= 200, got ${truncated.text.length}`,
    );
    assert.ok(
      truncated.text.includes("truncated"),
      `Expected truncation suffix, got: ${truncated.text}`,
    );
  });

  it("does not truncate when output is within limit", async () => {
    await config.$update(
      "maxOutputChars",
      200,
      vscode.ConfigurationTarget.Workspace,
    );

    const text = "hello world";
    const truncated = truncateToolOutputText(text);

    assert.strictEqual(truncated.truncated, false);
    assert.strictEqual(truncated.text, text);
  });
});
