// Parameters for starting a debug session. The tool starts a debugger using the
// configured default launch configuration and waits for the first breakpoint hit,
// returning call stack and (optionally) filtered variables.
// Individual breakpoint definition now includes a required variable so
// each breakpoint can specify the single variable name it cares about.
// Use variable="*" to opt into capture-all (auto-capture) behavior.

export interface BreakpointDefinition {
  path: string
  /**
   * Exact code snippet (substring) to break on.
   * The tool will search the file and set breakpoints on every matching line.
   */
  code: string
  /**
   * Runtime-resolved hit line (1-based). Not required for breakpoint requests.
   * Populated in stop info when a breakpoint is hit.
   */
  line?: number
  /**
   * Exact variable name to capture/report (case-sensitive).
   * Use "*" to opt into capture-all (auto-capture) behavior.
   */
  variable: string
  onHit?: "break" | "captureAndStopDebugging" | "captureAndContinue" // captureAndContinue returns data then continues (non-blocking)
  condition?: string // Expression evaluated at breakpoint; stop only if true
  hitCount?: number // Exact numeric hit count (3 means pause on 3rd hit)
  logMessage?: string // Logpoint style message with {var} interpolation
  /**
   * If true, the tool will capture variables, step over once (DAP 'next'), then capture again.
   * Useful for "before vs after" snapshots around assignments/invocations.
   */
  autoStepOver?: boolean
  reasonCode?: string // Internal telemetry tag (not surfaced)
}
