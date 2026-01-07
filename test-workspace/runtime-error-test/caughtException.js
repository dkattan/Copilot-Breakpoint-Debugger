// Intentionally throw and catch an exception.
// The debugger should NOT stop here when configured for uncaught/unhandled exceptions only.

function run() {
  try {
    throw new Error("This exception is caught");
  } catch (err) {
    // handled
    const _ignored = err;
  }

  console.log("REACHABLE_AFTER_CATCH");
  console.log("still running after catch");
}

run();
