import { defineExtension, useWorkspaceFolders } from "reactive-vscode";
import * as vscode from "vscode";
import { config } from "./config";
import { EvaluateExpressionTool } from "./evaluateExpressionTool";
import { ExpandVariableTool } from "./expandVariableTool";
import { GetVariablesTool } from "./getVariablesTool";
import { ResumeDebugSessionTool } from "./resumeDebugSessionTool";
import { startDebuggingAndWaitForStop } from "./session";
import { StartDebuggerTool } from "./startDebuggerTool";
import { StopDebugSessionTool } from "./stopDebugSessionTool";

const workspaceFoldersRef = useWorkspaceFolders();

const extension = defineExtension((context) => {
  registerTools(context);
});

export const activate = extension.activate;
export const deactivate = extension.deactivate;

function registerTools(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.lm.registerTool(
      "start_debugger_with_breakpoints",
      new StartDebuggerTool()
    ),
    vscode.lm.registerTool(
      "resume_debug_session",
      new ResumeDebugSessionTool()
    ),
    vscode.lm.registerTool("get_variables", new GetVariablesTool()),
    vscode.lm.registerTool("expand_variable", new ExpandVariableTool()),
    vscode.lm.registerTool("evaluate_expression", new EvaluateExpressionTool()),
    vscode.lm.registerTool("stop_debug_session", new StopDebugSessionTool()),

    vscode.commands.registerCommand(
      "copilotBreakpointDebugger.startAndWaitManual",
      async () => {
        const workspaceFolders = workspaceFoldersRef.value;
        if (!workspaceFolders?.length) {
          vscode.window.showErrorMessage("No workspace folder open.");
          return;
        }
        // Prompt user to select the workspace folder instead of defaulting to index 0.
        const folderItems = workspaceFolders.map((f) => ({
          label: f.name,
          description: f.uri.fsPath,
        }));
        const pickedFolderItem = await vscode.window.showQuickPick(
          folderItems,
          {
            placeHolder: "Select a workspace folder to use for debugging",
            ignoreFocusOut: true,
          }
        );
        if (!pickedFolderItem) {
          vscode.window.showInformationMessage(
            "Workspace folder selection canceled."
          );
          return;
        }
        const selectedFolder = workspaceFolders.find(
          (f) => f.name === pickedFolderItem.label
        );
        if (!selectedFolder) {
          vscode.window.showErrorMessage(
            "Selected workspace folder could not be resolved."
          );
          return;
        }
        const folderUri = selectedFolder.uri;
        const folder = folderUri.fsPath;
        // First ensure user has at least one breakpoint set; skip path/line prompts when using existing breakpoints.
        const existingSourceBreakpoints = vscode.debug.breakpoints.filter(
          (bp) => bp instanceof vscode.SourceBreakpoint
        ) as vscode.SourceBreakpoint[];
        if (!existingSourceBreakpoints.length) {
          vscode.window.showInformationMessage(
            "No breakpoints set. Please set a breakpoint and rerun the command."
          );
          return;
        }
        // Only after confirming breakpoints, ask for launch configuration.
        const launchConfig = vscode.workspace.getConfiguration(
          "launch",
          folderUri
        );
        const allConfigs =
          (launchConfig.get<unknown>(
            "configurations"
          ) as vscode.DebugConfiguration[]) || [];
        if (!allConfigs.length) {
          vscode.window.showErrorMessage(
            "No launch configurations found in .vscode/launch.json."
          );
          return;
        }
        const picked = await vscode.window.showQuickPick(
          allConfigs.map((c) => ({ label: c.name })),
          {
            placeHolder: "Select a launch configuration to start",
            ignoreFocusOut: true,
          }
        );
        if (!picked) {
          vscode.window.showInformationMessage(
            "Launch configuration selection canceled."
          );
          return;
        }
        const variableFilterInput = await vscode.window.showInputBox({
          prompt: "Variable names to capture (comma-separated, at least one)",
          validateInput: (value) => {
            const arr = value
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean);
            return arr.length
              ? undefined
              : "Provide at least one variable name";
          },
        });
        if (!variableFilterInput) {
          vscode.window.showInformationMessage("Breakpoint setup canceled.");
          return;
        }
        const variableFilter = variableFilterInput
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
        // Convert existing breakpoints into the expected configuration shape.
        const breakpointConfig = {
          breakpoints: existingSourceBreakpoints.map((sb) => ({
            path: sb.location.uri.fsPath,
            line: sb.location.range.start.line + 1,
            variableFilter,
            action: "break" as const,
          })),
        };
        try {
          await startDebuggingAndWaitForStop({
            sessionName: "manual-start",
            workspaceFolder: folder,
            nameOrConfiguration: picked.label,
            breakpointConfig,
            useExistingBreakpoints: true,
          });
          void vscode.window.showInformationMessage(
            `Started '${picked.label}' and hit breakpoint.`
          );
        } catch (e) {
          void vscode.window.showErrorMessage(
            `Manual start failed: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
    )
  );

  // Command to set the default launch configuration (workspace scope)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "copilotBreakpointDebugger.setDefaultLaunchConfiguration",
      async () => {
        const workspaceFolders = workspaceFoldersRef.value;
        if (!workspaceFolders?.length) {
          vscode.window.showErrorMessage("No workspace folder open.");
          return;
        }
        const folderUri = workspaceFolders[0].uri;
        const launchConfig = vscode.workspace.getConfiguration(
          "launch",
          folderUri
        );
        const allConfigs =
          (launchConfig.get<unknown>(
            "configurations"
          ) as vscode.DebugConfiguration[]) || [];
        if (!allConfigs.length) {
          vscode.window.showErrorMessage(
            "No launch configurations found in .vscode/launch.json."
          );
          return;
        }
        const picked = await vscode.window.showQuickPick(
          allConfigs.map((c) => ({ label: c.name })),
          {
            placeHolder: "Select a configuration to set as default",
            ignoreFocusOut: true,
          }
        );
        if (!picked) {
          vscode.window.showInformationMessage("Selection canceled.");
          return;
        }
        await config.$update(
          "defaultLaunchConfiguration",
          picked.label,
          vscode.ConfigurationTarget.Workspace
        );
        vscode.window.showInformationMessage(
          `Set default launch configuration to '${picked.label}'.`
        );
      }
    )
  );

  // Insert sample start debugger payload (opens new untitled JSON doc)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "copilotBreakpointDebugger.insertSampleStartDebuggerPayload",
      async () => {
        const serverReadySampleAction = (() => {
          switch (config.serverReadyDefaultActionType) {
            case "shellCommand":
              return {
                type: "shellCommand" as const,
                shellCommand: "curl http://localhost:%PORT%/healthz",
              };
            case "vscodeCommand":
              return {
                type: "vscodeCommand" as const,
                command: "workbench.action.tasks.reloadTasks",
                args: [],
              };
            case "httpRequest":
            default:
              return {
                type: "httpRequest" as const,
                url: "http://localhost:%PORT%/swagger",
              };
          }
        })();
        const sample = {
          workspaceFolder: "/abs/path/project",
          configurationName: "Run test.js",
          breakpointConfig: {
            breakpoints: [
              {
                path: "src/server.ts",
                line: 27,
                action: "capture",
                logMessage: "port={PORT}",
                variableFilter: ["PORT"],
              },
            ],
          },
          serverReady: {
            trigger: { pattern: "listening on .*:(\\d+)" },
            action: serverReadySampleAction,
          },
        };
        const doc = await vscode.workspace.openTextDocument({
          language: "json",
          content: JSON.stringify(sample, null, 2),
        });
        await vscode.window.showTextDocument(doc, { preview: false });
      }
    )
  );
}

export { deactivate as defaultDeactivated };
