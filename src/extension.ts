// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { GetVariablesTool } from './getVariablesTool';
import { ExpandVariableTool } from './expandVariableTool';
import { StartDebuggerTool } from './startDebuggerTool';
import { ResumeDebugSessionTool } from './resumeDebugSessionTool';
import { EvaluateExpressionTool } from './evaluateExpressionTool';
import { StopDebugSessionTool } from './stopDebugSessionTool';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  registerTools(context);
}

function registerTools(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.lm.registerTool(
      'start_debugger_with_breakpoints',
      new StartDebuggerTool()
    ),
    vscode.lm.registerTool(
      'resume_debug_session',
      new ResumeDebugSessionTool()
    ),
    vscode.lm.registerTool('get_variables', new GetVariablesTool()),
    vscode.lm.registerTool('expand_variable', new ExpandVariableTool()),
    vscode.lm.registerTool('evaluate_expression', new EvaluateExpressionTool()),
    vscode.lm.registerTool('stop_debug_session', new StopDebugSessionTool())
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
