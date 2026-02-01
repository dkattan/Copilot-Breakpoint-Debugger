import { defineConfigObject } from "reactive-vscode";
import * as Meta from "./generated-meta";

type ServerReadyActionType = "httpRequest" | "shellCommand" | "vscodeCommand";
type ConsoleLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "off";
type ExistingSessionBehavior = "useExisting" | "stopExisting" | "ignoreAndCreateNew";

const configDefaults = {
  defaultLaunchConfiguration: (Meta.configs
    .copilotDebuggerDefaultLaunchConfiguration
    .default ?? "") as string,
  entryTimeoutSeconds: (Meta.configs.copilotDebuggerEntryTimeoutSeconds
    .default ?? 60) as number,
  captureMaxVariables: (Meta.configs.copilotDebuggerCaptureMaxVariables
    .default ?? 40) as number,
  serverReadyEnabled: (Meta.configs.copilotDebuggerServerReadyEnabled.default
    ?? true) as boolean,
  serverReadyDefaultActionType: (Meta.configs
    .copilotDebuggerServerReadyDefaultActionType
    .default
    ?? "httpRequest") as ServerReadyActionType,
  maxBuildErrors: (Meta.configs.copilotDebuggerMaxBuildErrors.default
    ?? 5) as number,
  maxOutputLines: (Meta.configs.copilotDebuggerMaxOutputLines.default
    ?? 50) as number,
  maxOutputChars: (Meta.configs.copilotDebuggerMaxOutputChars.default
    ?? 8192) as number,
  consoleLogLevel: (Meta.configs.copilotDebuggerConsoleLogLevel.default
    ?? "info") as ConsoleLogLevel,
  enableTraceLogging: (Meta.configs.copilotDebuggerEnableTraceLogging.default
    ?? false) as boolean,
  supportsMultipleDebugSessions: (Meta.configs
    .copilotDebuggerSupportsMultipleDebugSessions
    .default ?? false) as boolean,
  existingSessionBehavior: (Meta.configs.copilotDebuggerExistingSessionBehavior
    .default ?? "useExisting") as ExistingSessionBehavior,
} satisfies {
  defaultLaunchConfiguration: string
  entryTimeoutSeconds: number
  captureMaxVariables: number
  serverReadyEnabled: boolean
  serverReadyDefaultActionType: ServerReadyActionType
  maxBuildErrors: number
  maxOutputLines: number
  maxOutputChars: number
  consoleLogLevel: ConsoleLogLevel
  enableTraceLogging: boolean
  supportsMultipleDebugSessions: boolean
  existingSessionBehavior: ExistingSessionBehavior
};

export type CopilotDebuggerConfig = typeof configDefaults;

export const config = defineConfigObject<CopilotDebuggerConfig>(
  "copilot-debugger",
  configDefaults,
);
