import type { BasePromptElementProps, PromptSizing } from '@vscode/prompt-tsx';
import { PromptElement, TextChunk } from '@vscode/prompt-tsx';

export interface StartDebuggerPromptProps extends BasePromptElementProps {
  summary: {
    session: string;
    file?: string;
    line?: number;
    reason?: string;
  };
  thread?: {
    id?: number;
    name?: string;
  };
  frame?: {
    id?: number;
    name?: string;
    source?: {
      name?: string;
      path?: string;
    };
    line?: number;
    column?: number;
  };
  scopes: Array<{
    scopeName: string;
    variables: Array<{
      name: string;
      value: string;
    }>;
  }>;
}

export class StartDebuggerPrompt extends PromptElement<
  StartDebuggerPromptProps,
  Record<string, never>
> {
  override async render(_state: Record<string, never>, _sizing: PromptSizing) {
    const { summary, thread, frame, scopes } = this.props;

    return (
      <>
        <TextChunk priority={300}>
          Breakpoint Summary
          <br />
          {JSON.stringify(summary)}
        </TextChunk>
        <TextChunk priority={200}>
          Thread &amp; Frame
          <br />
          {JSON.stringify({ thread, frame })}
        </TextChunk>
        {scopes.map(scope => (
          <TextChunk priority={50}>
            Scope {scope.scopeName} ({scope.variables.length} variables)
            <br />
            {JSON.stringify(scope.variables)}
          </TextChunk>
        ))}
      </>
    );
  }
}
