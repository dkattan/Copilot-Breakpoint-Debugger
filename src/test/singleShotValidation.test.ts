import * as assert from "node:assert";
import { startDebuggingAndWaitForStop } from "../session";

describe("startDebuggingAndWaitForStop validation", () => {
  it("rejects captureAndContinue onHit in singleShot mode", async () => {
    await assert.rejects(
      () =>
        startDebuggingAndWaitForStop({
          sessionName: "",
          workspaceFolder: "/abs/path/project",
          nameOrConfiguration: "Run test.js",
          mode: "singleShot",
          timeoutSeconds: 1,
          breakpointConfig: {
            breakpoints: [
              {
                path: "src/server.ts",
                code: "console.log('listening')",
                variable: "PORT",
                onHit: "captureAndContinue",
              },
            ],
          },
        }),
      /captureAndContinue.*not supported in singleShot mode/i,
    );
  });
});
