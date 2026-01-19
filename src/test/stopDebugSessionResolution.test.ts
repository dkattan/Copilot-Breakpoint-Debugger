import * as assert from "node:assert";
import { mapDebugSessionsForTool } from "../session";

// NOTE: This file tests the deterministic mapping contract that stopDebugSession relies on
// (toolId -> session UUID) without needing to start a real debug session.

describe("stopDebugSession resolution helpers (mapping contract)", () => {
  it("assigns toolId as 1-based index in listing order", () => {
    const mapped = mapDebugSessionsForTool({
      sessions: [
        {
          id: "uuid-1",
          name: "one",
          configuration: { type: "node", request: "launch" },
        },
        {
          id: "uuid-2",
          name: "two",
          configuration: { type: "node", request: "launch" },
        },
      ],
      activeSessionId: "uuid-2",
    });

    assert.deepStrictEqual(
      mapped.map(m => m.toolId),
      [1, 2],
    );
    assert.strictEqual(mapped[1].isActive, true);
  });

  it("filters out empty ids and does not renumber toolId (stable index semantics)", () => {
    const mapped = mapDebugSessionsForTool({
      sessions: [
        { id: "uuid-1", name: "one" },
        { id: "", name: "empty" },
        { id: "uuid-3", name: "three" },
      ],
      activeSessionId: "uuid-1",
    });

    // We deliberately keep toolId aligned to original order to avoid shifting identifiers
    // when some sessions are filtered out.
    assert.deepStrictEqual(
      mapped.map(m => ({ toolId: m.toolId, id: m.id })),
      [
        { toolId: 1, id: "uuid-1" },
        { toolId: 3, id: "uuid-3" },
      ],
    );
  });
});
