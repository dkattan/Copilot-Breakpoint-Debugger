// Parameters for starting a debug session. The tool starts a debugger using the
// configured default launch configuration and waits for the first breakpoint hit,
// returning call stack and (optionally) filtered variables.
// Individual breakpoint definition now includes a required variableFilter so
// each breakpoint can specify its own variable name patterns (regex fragments).

export interface BreakpointDefinition {
  path: string;
  line: number;
  variableFilter: string[];
  onHit?: 'break' | 'stopDebugging' | 'captureAndContinue'; // captureAndContinue returns data then continues (non-blocking)
  condition?: string; // Expression evaluated at breakpoint; stop only if true
  hitCount?: number; // Exact numeric hit count (3 means pause on 3rd hit)
  logMessage?: string; // Logpoint style message with {var} interpolation
  reasonCode?: string; // Internal telemetry tag (not surfaced)
}
