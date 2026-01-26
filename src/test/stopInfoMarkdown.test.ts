import type { StartDebuggerStopInfo } from "../session";
import * as assert from "node:assert";
import { renderStopInfoMarkdown } from "../stopInfoMarkdown";

function makeBaseStopInfo(overrides?: Partial<StartDebuggerStopInfo>): StartDebuggerStopInfo {
  const base = {
    thread: { id: 1, name: "main" },
    frame: {
      id: 1,
      name: "frame",
      line: 10,
      column: 1,
      source: {
        name: "test.ts",
        path: "/tmp/test.ts",
      },
    },
    scopes: [],
    scopeVariables: [],
    serverReadyInfo: {
      configured: false,
      triggerMode: "disabled",
      phases: [],
    },
    debuggerState: {
      status: "paused",
      sessionId: "session-1",
      sessionName: "session-1",
    },
    protocol: {
      allowedNextActions: [],
      forbiddenNextActions: [],
      nextStepSuggestion: "",
    },
    runtimeOutput: {
      lines: [],
      totalLines: 0,
      truncated: false,
    },
  } satisfies StartDebuggerStopInfo;

  return { ...base, ...(overrides ?? {}) };
}

describe("renderStopInfoMarkdown", () => {
  it("never emits 'undefined' when line is missing", () => {
    const stopInfo = makeBaseStopInfo({
      // StackFrame.line is normally present, but we defensively handle undefined.
      frame: {
        id: 1,
        name: "frame",
        line: undefined as unknown as number,
        column: 1,
        source: {
          name: "test.ts",
          path: "/tmp/test.ts",
        },
      },
    });

    const markdown = renderStopInfoMarkdown({
      stopInfo,
      breakpointConfig: { breakpoints: [] },
      success: true,
    });

    assert.ok(
      !markdown.includes("undefined"),
      `Expected markdown not to contain 'undefined', got:\n${markdown}`,
    );
    assert.ok(
      markdown.includes("Breakpoint") === false,
      "Expected a generic stop header when no hitBreakpoint/exceptionInfo",
    );
  });

  it("renders exception header and details without leaking 'undefined'", () => {
    const stopInfo = makeBaseStopInfo({
      exceptionInfo: {
        description: "Boom",
        details: "stack...",
      },
      reason: "exception",
    });

    const markdown = renderStopInfoMarkdown({
      stopInfo,
      breakpointConfig: { breakpoints: [] },
      success: false,
    });

    assert.ok(
      markdown.includes("Exception: Boom"),
      `Expected exception header, got:\n${markdown}`,
    );
    assert.ok(
      markdown.includes("## Exception Details"),
      `Expected exception details section, got:\n${markdown}`,
    );
    assert.ok(
      !markdown.includes("undefined"),
      `Expected markdown not to contain 'undefined', got:\n${markdown}`,
    );
  });
});
