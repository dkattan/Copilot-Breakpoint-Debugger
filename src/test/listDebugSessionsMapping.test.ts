import * as assert from "node:assert";
import { mapDebugSessionsForTool } from "../session";

describe("listDebugSessions mapping", () => {
  it("returns only stop-compatible string ids", () => {
    const result = mapDebugSessionsForTool({
      sessions: [
        {
          id: "abc",
          name: "one",
          configuration: { type: "node", request: "launch" },
        },
        { id: "", name: "empty" },
        // @ts-expect-error - intentionally invalid shape
        { id: 123, name: "bad" },
      ],
      activeSessionId: "abc",
    });

    assert.deepStrictEqual(result, [
      {
        toolId: 1,
        id: "abc",
        name: "one",
        isActive: true,
        configurationType: "node",
        request: "launch",
      },
    ]);
  });

  it("marks isActive false when no activeSessionId", () => {
    const result = mapDebugSessionsForTool({
      sessions: [{ id: "abc", name: "one" }],
      activeSessionId: undefined,
    });

    assert.strictEqual(result[0].isActive, false);
    assert.strictEqual(result[0].toolId, 1);
  });
});
