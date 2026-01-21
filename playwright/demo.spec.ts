import * as path from "node:path";
import { expect, test } from "vscode-test-playwright";

test("Copilot Breakpoint Debugger demo", async ({ workbox, vscode }) => {
  // Use repo-relative absolute paths so this works in CI (Linux) and locally.
  const repoRoot = path.join(__dirname, "..");
  const workspaceB = path.join(repoRoot, "test-workspace", "b");

  const chatPanel = workbox.locator("#workbench\\.panel\\.chat");

  await vscode.commands.executeCommand("workbench.panel.chat.view.copilot.focus");

  await expect(chatPanel).toBeVisible({ timeout: 30_000 });

  // Prefer codicon-based selectors for stability across label text and locale.
  // - When idle, the execute button is a paper-plane (send) icon.
  // - When processing, it changes to a stop-circle icon.
  const chatSendIcon = chatPanel.locator(
    "div.monaco-toolbar.chat-execute-toolbar a.action-label.codicon.codicon-send",
  );
  const chatStopIcon = chatPanel.locator(
    "div.monaco-toolbar.chat-execute-toolbar a.action-label.codicon.codicon-stop-circle",
  );
  await expect(chatSendIcon.first()).toBeVisible({ timeout: 30_000 });

  // Extremely explicit instructions for anonymous-access mode: tell the model exactly
  // which tool to call and the precise fields to supply.
  const toolArgs = {
    workspaceFolder: workspaceB,
    configurationName: "Run b/server.js",
    mode: "singleShot",
    breakpointConfig: {
      breakpoints: [
        {
          path: "server.js",
          code: "TICK_FOR_USER_BREAKPOINT",
          variableFilter: ["started", "port"],
          onHit: "captureAndStopDebugging",
        },
      ],
    },
  };
  const promptText = `You MUST call the tool #startDebugSessionWithBreakpoints now. Do not describe steps; call the tool. Use exactly this JSON (no extra keys): ${JSON.stringify(
    toolArgs,
  )}. After the tool returns, reply with only: (1) whether 'Server listening on http://localhost:' appears in output and (2) the captured values for started and port.`;

  await vscode.commands.executeCommand("type", { text: promptText });

  // Submit.
  await vscode.commands.executeCommand("workbench.action.chat.submit");
  await workbox.waitForTimeout(250);

  // Wait for processing to complete.
  // We use UI observation only (no clicking) to keep this stable across notification toasts.
  await expect(chatStopIcon.first()).toBeVisible({ timeout: 30_000 });
  await expect(chatSendIcon.first()).toBeVisible({ timeout: 180_000 });

  // Final grace period to let the response render fully (and for manual runs).
  await workbox.waitForTimeout(5000);
});
