import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vscode-test-playwright";

test("Copilot Breakpoint Debugger demo", async ({ workbox }, testInfo) => {
  test.setTimeout(3 * 60_000);

  // Playwright's built-in video recording does not apply to Electron apps.
  // Instead, we capture periodic screenshots and stitch them into a .webm with ffmpeg.
  // This is intentionally simple (demo-quality, not production-grade).
  const framesDir = testInfo.outputPath("frames");
  await fs.mkdir(framesDir, { recursive: true });

  let record = true;
  let frameIndex = 0;
  let ffmpegError: Error | undefined;
  const recordLoop = (async () => {
    for (;;) {
      if (!record) {
        break;
      }

      const framePath = path.join(
        framesDir,
        `frame-${String(frameIndex).padStart(5, "0")}.png`,
      );

      // Avoid failing the whole demo due to a transient screenshot issue during shutdown.
      // If this throws while VS Code is closing, we'll break out.
      try {
        await workbox.screenshot({ path: framePath });
        frameIndex++;
      }
      catch {
        break;
      }

      // ~4 FPS keeps files small while still looking like a video.
      await workbox.waitForTimeout(250);
    }
  })();

  try {
    // Drive the VS Code UI only (no VS Code API evaluation) so the demo remains self-contained.
    // Use the built-in keyboard shortcut for Chat (⌃⌘I on macOS) to avoid pointer-event issues.
    await workbox.keyboard.press("Control+Meta+KeyI");

    const chatPanel = workbox.locator("#workbench\\.panel\\.chat");
    await expect(chatPanel).toBeVisible();

    // NOTE: We intentionally do NOT enable "screen reader optimized" mode.
    // That mode can introduce chat progress sounds and changes UX in a way that's
    // undesirable for demo recordings.

    // Use the stable container from the user's selector and focus the embedded editor.
    const chatInputContainer = workbox.locator(
      "#workbench\\.panel\\.chat > div > div > div.monaco-scrollable-element.mac > div.split-view-container > div > div > div.pane-body.chat-viewpane"
      + " > div.chat-controls-container > div.interactive-session > div.interactive-input-part"
      + " > div.interactive-input-and-side-toolbar > div",
    );

    await chatInputContainer.waitFor({ state: "visible" });

    await expect(chatInputContainer).toBeVisible();
    await chatInputContainer.click();
    const chatEditable = chatInputContainer.locator(
      ".native-edit-context[role='textbox']",
    );
    await expect(chatEditable).toBeVisible();

    // Prefer codicon-based selectors for stability across label text and locale.
    // - When idle, the execute button is a paper-plane (send) icon.
    // - When processing, it changes to a stop-circle icon.
    const chatSendIcon = workbox.locator(
      "#workbench\\.panel\\.chat div.monaco-toolbar.chat-execute-toolbar a.action-label.codicon.codicon-send",
    );
    const chatStopIcon = workbox.locator(
      "#workbench\\.panel\\.chat div.monaco-toolbar.chat-execute-toolbar a.action-label.codicon.codicon-stop-circle",
    );

    await expect(chatSendIcon.first()).toBeVisible({ timeout: 30_000 });

    // Some VS Code surfaces intercept pointer events; a direct DOM click focuses the editor reliably.
    await chatEditable.evaluate(el => (el as HTMLElement).click());
    await workbox.keyboard.insertText(
      "Use the #startDebugger tool to start the 'Run b/server.js' launch configuration from the workspace. "
      + "Then confirm the server is running by watching for a 'Server listening on http://localhost:' message. "
      + "Keep the output concise.",
    );

    await workbox.keyboard.press("Enter");
    await workbox.waitForTimeout(250);

    // If the AI provider isn't signed in, VS Code may prompt only after sending.
    const aiSignInDialogMessageAfterSend = workbox.locator(
      "#monaco-dialog-message-text",
    );
    if (
      await aiSignInDialogMessageAfterSend
        .isVisible({ timeout: 2000 })
        .catch(() => false)
    ) {
      const text = (
        await aiSignInDialogMessageAfterSend.textContent().catch(() => null)
      )?.trim();
      throw new Error(
        `Unexpected AI sign-in modal shown after sending (sign-in not propagated).${
          text ? ` Dialog text: ${text}` : ""
        }`,
      );
    }

    // Wait for Copilot to finish responding before ending the test.
    // If we exit while a response is still streaming, the harness will close VS Code
    // and the chat request may be aborted mid-generation.
    //
    // Busy -> idle (stop icon appears while processing, then send icon returns).
    await expect(chatStopIcon.first()).toBeVisible({ timeout: 30_000 });
    await expect(chatSendIcon.first()).toBeVisible({ timeout: 180_000 });

    // Final grace period to let the response render fully (and for manual runs).
    await workbox.waitForTimeout(5000);
  }
  finally {
    record = false;
    await recordLoop;

    // Create a .webm inside the test output directory so the playwright-test-videos
    // submodule can discover it under `test-results/**`.
    if (frameIndex > 0) {
      const outputWebmPath = testInfo.outputPath("video.webm");
      const inputPattern = path.join(framesDir, "frame-%05d.png");
      const ffmpegArgs = [
        "-y",
        "-framerate",
        "4",
        "-i",
        inputPattern,
        "-c:v",
        "libvpx-vp9",
        "-pix_fmt",
        "yuv420p",
        outputWebmPath,
      ];

      const res = spawnSync("ffmpeg", ffmpegArgs, { stdio: "inherit" });
      if (res.status !== 0) {
        ffmpegError = new Error(
          `ffmpeg failed to create demo video (exit=${
            res.status ?? "unknown"
          }).`,
        );
      }
    }
  }

  if (ffmpegError) {
    throw ffmpegError;
  }
});
