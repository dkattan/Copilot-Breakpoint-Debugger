import type { Page } from "@playwright/test";
import type { StartDebuggerToolParameters } from "../src/startDebuggerToolTypes";
import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test } from "vscode-test-playwright";

interface RoleDumpItem {
  role: string
  tag: string
  id?: string
  className?: string
  ariaLabel?: string
  title?: string
  textPreview?: string
}

async function summarizeByRole(page: Page, params: {
  role: Parameters<Page["getByRole"]>[0]
  maxItems: number
  onlyVisible: boolean
}): Promise<RoleDumpItem[]> {
  const { role, maxItems, onlyVisible } = params;
  const locators = await page.getByRole(role).all();
  const sliced = locators.slice(0, maxItems);

  const items: RoleDumpItem[] = [];
  for (const locator of sliced) {
    if (onlyVisible) {
      const visible = await locator.isVisible();
      if (!visible) {
        continue;
      }
    }

    // Intentionally avoid DOM/CSS selectors. We capture basic attributes + text preview
    // to help identify an element by accessibility role/name.
    const info = await locator.evaluate((el: Element) => {
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      const htmlEl = el as HTMLElement;
      const className = typeof htmlEl.className === "string" && htmlEl.className.length > 0 ? htmlEl.className : undefined;
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || undefined,
        className,
        ariaLabel: el.getAttribute("aria-label") || undefined,
        title: el.getAttribute("title") || undefined,
        textPreview: text ? text.slice(0, 160) : undefined,
      };
    });

    items.push({ role, ...info });
  }

  return items;
}

async function dumpVisibleAccessible(page: Page): Promise<RoleDumpItem[]> {
  // NOTE: Playwright does not support getByRole('*'). Instead, we sample a curated set
  // of common UI roles to approximate "all accessible elements".
  // Keep this list small-ish to avoid massive logs on VS Code's DOM.
  const roles: Array<Parameters<Page["getByRole"]>[0]> = [
    "button",
    "link",
    "checkbox",
    "textbox",
    "combobox",
    "menuitem",
    "tab",
    "treeitem",
    "option",
    "heading",
    "dialog",
    "listitem",
    "generic",
  ];

  const results: RoleDumpItem[] = [];
  for (const role of roles) {
    // 'generic' can explode in count; cap it harder.
    const maxItems = role === "generic" ? 80 : 80;
    results.push(
      ...(await summarizeByRole(page, { role, maxItems, onlyVisible: true })),
    );
  }

  return results;
}

test("Copilot Breakpoint Debugger demo", async ({ workbox, vscode, evaluateInVSCode }) => {
  // Use repo-relative absolute paths so this works in CI (Linux) and locally.
  const repoRoot = path.join(__dirname, "..");
  const workspaceB = path.join(repoRoot, "test-workspace", "node");

  // Open the file we plan to debug BEFORE interacting with Copilot Chat.
  const scriptPath = path.join(workspaceB, "server.js");
  await evaluateInVSCode(async (vscode, fsPath) => {
    const uri = vscode.Uri.file(fsPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
  }, scriptPath);

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
  const demoRequestPath = path.join(repoRoot, "demoRequest.json");
  const rawRequest = JSON.parse(
    fs.readFileSync(demoRequestPath, { encoding: "utf8" }),
  ) as StartDebuggerToolParameters;

  if (rawRequest.workspaceFolder !== "__WORKSPACE_B__") {
    throw new Error(
      `demoRequest.json workspaceFolder must be '__WORKSPACE_B__' placeholder, got: ${String(
        rawRequest.workspaceFolder,
      )}`,
    );
  }

  const toolArgs = {
    ...rawRequest,
    workspaceFolder: workspaceB,
  };
  const promptText = `You MUST call the tool #startDebugSessionWithBreakpoints now. Do not describe steps; call the tool. Use exactly this JSON (no extra keys): ${JSON.stringify(
    toolArgs,
  )}. After the tool returns, reply with only: (1) whether the server started and the /api/echo request was made and (2) the captured value for queryParam.`;

  await vscode.commands.executeCommand("type", { text: promptText });

  // Submit.
  await vscode.commands.executeCommand("workbench.action.chat.submit");
  await workbox.waitForTimeout(250);

  // The chat transcript sometimes leaves the top of the just-submitted prompt
  // slightly clipped. Click the rendered markdown and nudge upward.
  const chatMarkdownParts = chatPanel.locator(
    "div.chat-markdown-part.rendered-markdown",
  );
  await expect(chatMarkdownParts.last()).toBeVisible({ timeout: 30_000 });
  await chatMarkdownParts.last().click();
  await workbox.keyboard.press("ArrowUp");

  // Wait for processing to start (best-effort).
  // In CI, Copilot Chat can sometimes transition from idle → processing → idle fast enough
  // that the stop icon never becomes observable. We avoid making that a hard requirement.
  //
  // We still prefer UI observation only (no clicking) to keep this stable across notification toasts.
  try {
    await Promise.race([
      chatStopIcon.first().waitFor({ state: "visible", timeout: 5_000 }),
      chatSendIcon.first().waitFor({ state: "hidden", timeout: 5_000 }),
    ]);
  }
  catch {
    // If neither transition is observed quickly, continue; the completion wait below is authoritative.
  }

  // Wait for processing to complete.
  await expect(chatSendIcon.first()).toBeVisible({ timeout: 180_000 });

  // Expand the Copilot "Request" message (tool invocation payload) using accessibility
  // queries, not brittle CSS selectors.
  //
  // If this fails, we throw with a small dump of visible accessible nodes to guide
  // updating the role/name query without guessing at selectors.
  const requestMessage = workbox.getByRole("listitem", {
    name: /You MUST call the tool #startDebugSessionWithBreakpoints/i,
  });
  const requestMessageCount = await requestMessage.count();
  if (requestMessageCount < 1) {
    const dump = await dumpVisibleAccessible(workbox);
    throw new Error(
      `Could not find the request message list item (expected accessible name to include '#startDebugSessionWithBreakpoints'). Visible accessible sample (role, tag, ariaLabel/title/textPreview): ${JSON.stringify(dump)}`,
    );
  }

  // VS Code sometimes shows a context/tooltip overlay that can intercept pointer events.
  // Dismiss it deterministically before clicking the request message.
  await workbox.mouse.move(0, 0);
  await workbox.keyboard.press("Escape");
  await workbox.waitForTimeout(250);
  await requestMessage.first().click();

  // Final grace period to let the response render fully (and for manual runs).
  await workbox.waitForTimeout(5000);
});
