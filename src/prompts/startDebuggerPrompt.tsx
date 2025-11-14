import type { BasePromptElementProps, PromptSizing } from '@vscode/prompt-tsx';
import { AssistantMessage, PromptElement, TextChunk } from '@vscode/prompt-tsx';

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
        <AssistantMessage priority={300}>
          <TextChunk priority={300}>Breakpoint Summary</TextChunk>
          <br />
          <TextChunk priority={300}>{JSON.stringify(summary)}</TextChunk>
        </AssistantMessage>
        <AssistantMessage priority={200}>
          <TextChunk priority={200}>Thread &amp; Frame</TextChunk>
          <br />
          <TextChunk priority={200}>
            {JSON.stringify({ thread, frame })}
          </TextChunk>
        </AssistantMessage>
        {scopes.map(scope => (
          <AssistantMessage priority={50}>
            <TextChunk priority={50}>
              Scope {scope.scopeName} ({scope.variables.length} variables)
            </TextChunk>
            <br />
            <TextChunk priority={50}>
              {JSON.stringify(scope.variables)}
            </TextChunk>
          </AssistantMessage>
        ))}
      </>
    );
  }
}
