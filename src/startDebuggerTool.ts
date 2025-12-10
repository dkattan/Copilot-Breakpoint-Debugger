import type {
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
} from "vscode";
import { LanguageModelTextPart, LanguageModelToolResult } from "vscode";
import { config } from "./config";
import { logger } from "./logger";
import { startDebuggingAndWaitForStop } from "./session";

// Parameters for starting a debug session. The tool starts a debugger using the
// configured default launch configuration and waits for the first breakpoint hit,
// returning call stack and (optionally) filtered variables.
// Individual breakpoint definition now includes a required variableFilter so
// each breakpoint can specify its own variable name patterns (regex fragments).
export interface BreakpointDefinition {
  path: string;
  line: number;
  variableFilter?: string[]; // Optional: when action=capture and omitted we auto-capture all locals (bounded by captureMaxVariables setting)
  action: "break" | "stopDebugging" | "capture"; // 'capture' returns data then continues (non-blocking)
  condition?: string; // Expression evaluated at breakpoint; stop only if true
  hitCount?: number; // Exact numeric hit count (3 means pause on 3rd hit)
  logMessage?: string; // Logpoint style message with {var} interpolation
  reasonCode?: string; // Internal telemetry tag (not surfaced)
}

export interface BreakpointConfiguration {
  breakpoints: BreakpointDefinition[];
}

type ServerReadyAction =
  | { shellCommand: string }
  | {
      httpRequest: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      };
    }
  | { vscodeCommand: { command: string; args?: unknown[] } }
  | {
      type: "httpRequest";
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    }
  | { type: "shellCommand"; shellCommand: string }
  | { type: "vscodeCommand"; command: string; args?: unknown[] };

export interface StartDebuggerToolParameters {
  workspaceFolder: string;
  configurationName?: string;
  breakpointConfig: BreakpointConfiguration;
  /**
   * Optional serverReady configuration.
   * trigger: defines when to run the action (breakpoint path+line OR pattern). If omitted and request === 'attach' the action runs immediately after attach (default immediate attach mode).
   * action: exactly one of shellCommand | httpRequest | vscodeCommand.
   */
  serverReady?: {
    trigger?: {
      path?: string;
      line?: number;
      pattern?: string;
    };
    action: ServerReadyAction;
  };
}

// Removed scope variable limiting; concise output filters directly.

export class StartDebuggerTool
  implements LanguageModelTool<StartDebuggerToolParameters>
{
  async invoke(
    options: LanguageModelToolInvocationOptions<StartDebuggerToolParameters>
  ): Promise<LanguageModelToolResult> {
    const {
      workspaceFolder,
      configurationName,
      breakpointConfig,
      serverReady,
    } = options.input;
    try {
      // Direct invocation with new serverReady structure
      const stopInfo = await startDebuggingAndWaitForStop({
        workspaceFolder,
        nameOrConfiguration: configurationName,
        breakpointConfig,
        sessionName: "",
        serverReady,
      });

      const summary = {
        session:
          stopInfo.thread?.name ??
          stopInfo.frame?.source?.name ??
          "debug-session",
        file: stopInfo.frame?.source?.path,
        line: stopInfo.frame?.line,
        reason: stopInfo.frame?.name,
      };

      // Ensure we have a hit breakpoint
      if (!stopInfo.hitBreakpoint) {
        throw new TypeError(
          "Hit breakpoint not identifiable; no frame/line correlation."
        );
      }
      const action = stopInfo.hitBreakpoint.action ?? "break";
      let activeFilters: string[] = stopInfo.hitBreakpoint.variableFilter || [];
      const captureAll = action === "capture" && activeFilters.length === 0;
      const maxAuto = config.captureMaxVariables ?? 40;
      const capturedLogs = stopInfo.capturedLogMessages ?? [];
      // Build list of variables: explicit filters OR auto-capture OR none.
      if (captureAll) {
        const names: string[] = [];
        for (const scope of stopInfo.scopeVariables ?? []) {
          for (const variable of scope.variables) {
            if (!names.includes(variable.name)) {
              names.push(variable.name);
              if (names.length >= maxAuto) {
                break; // inner break
              }
            }
          }
          if (names.length >= maxAuto) {
            break; // outer break
          }
        }
        activeFilters = names;
      }
      const filterSet = new Set(activeFilters);
      const flattened: Array<{
        name: string;
        value: string;
        scope: string;
        type?: string;
      }> = [];
      for (const scope of stopInfo.scopeVariables ?? []) {
        for (const variable of scope.variables) {
          if (filterSet.size === 0) {
            // No filters provided (non-capture breakpoint) => skip reporting variables to keep output concise.
            continue;
          }
          if (filterSet.has(variable.name)) {
            flattened.push({
              name: variable.name,
              value: variable.value,
              scope: scope.scopeName,
              type: variable.type,
            });
          }
        }
      }
      const truncate = (val: string) => {
        const max = 120;
        return val.length > max ? `${val.slice(0, max)}…(${val.length})` : val;
      };
      const variableStr = flattened
        .map((v) => {
          const typePart = v.type ? `:${v.type}` : "";
          return `${v.name}=${truncate(v.value)} (${v.scope}${typePart})`;
        })
        .join("; ");
      const fileName = summary.file
        ? summary.file.split(/[/\\]/).pop()
        : "unknown";
      const header = `Breakpoint ${fileName}:${summary.line} action=${action}`;
      let bodyVars: string;
      if (flattened.length) {
        bodyVars = `Vars: ${variableStr}`;
      } else if (filterSet.size === 0) {
        bodyVars = "Vars: <none> (no filter provided)";
      } else {
        bodyVars = `Vars: <none> (filters: ${activeFilters.join(", ")})`;
      }
      if (captureAll) {
        bodyVars += ` (auto-captured ${activeFilters.length} variable(s), cap=${maxAuto})`;
      }
      const bodyLogs = capturedLogs.length
        ? `Logs: ${capturedLogs
            .map((l) => (l.length > 120 ? `${l.slice(0, 120)}…` : l))
            .join(" | ")}`
        : "";
      const timestampLine = `Timestamp: ${new Date().toISOString()}`;
      const debuggerStateLine = (() => {
        const state = stopInfo.debuggerState;
        const sessionLabel = state.sessionName ?? state.sessionId ?? "unknown";
        switch (state.status) {
          case "paused":
            return `Debugger State: paused on '${sessionLabel}'. Recommended tools: resume_debug_session, get_variables, expand_variable, evaluate_expression, stop_debug_session.`;
          case "terminated":
            return "Debugger State: terminated. Recommended tool: start_debugger_with_breakpoints to begin a new session.";
          case "running":
          default:
            return `Debugger State: running (capture action continued session '${sessionLabel}'). Recommended tools: wait_for_breakpoint or resume_debug_session with new breakpoints.`;
        }
      })();
      const serverReadySection = (() => {
        const info = stopInfo.serverReadyInfo;
        if (!info?.configured) {
          return "Server Ready Trigger: Not configured";
        }
        if (!info.phases.length) {
          return `Server Ready Trigger: Not Hit (mode=${info.triggerMode})`;
        }
        const hits = info.phases
          .map(
            (entry) =>
              `${entry.phase}@${new Date(entry.timestamp).toISOString()}`
          )
          .join(", ");
        const detail = info.triggerSummary ? ` | ${info.triggerSummary}` : "";
        return `Server Ready Trigger: Hit (mode=${info.triggerMode}) ${hits}${detail}`;
      })();
      const runtimeOutputSection = (() => {
        const preview = stopInfo.runtimeOutput;
        if (!preview || preview.lines.length === 0) {
          return "Runtime Output: <none>";
        }
        const qualifier = preview.truncated
          ? `showing last ${preview.lines.length} of ${preview.totalLines} line(s)`
          : `last ${preview.lines.length} line(s)`;
        const body = preview.lines.map((line) => `- ${line}`).join("\n");
        return `Runtime Output (${qualifier}):\n${body}`;
      })();
      const sections = [
        timestampLine,
        header,
        bodyVars,
        bodyLogs,
        debuggerStateLine,
        serverReadySection,
        runtimeOutputSection,
      ].filter((section) => section && section.trim().length > 0);
      const textOutput = sections.join("\n");

      logger.info(`[StartDebuggerTool] textOutput ${textOutput}`);
      return new LanguageModelToolResult([
        new LanguageModelTextPart(textOutput),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new LanguageModelToolResult([
        new LanguageModelTextPart(`Error: ${message}`),
      ]);
    }
  }
}
