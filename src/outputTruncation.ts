import { LanguageModelTextPart, LanguageModelToolResult } from "vscode";
import { config } from "./config";

const DEFAULT_MAX_OUTPUT_CHARS = 8192;

export interface TruncationResult {
  text: string
  truncated: boolean
  originalLength: number
  maxLength: number
}

export function truncateToolOutputText(text: string, maxLength = config.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS): TruncationResult {
  const originalLength = text.length;
  const effectiveMax
    = typeof maxLength === "number" && maxLength > 0
      ? Math.floor(maxLength)
      : DEFAULT_MAX_OUTPUT_CHARS;

  if (originalLength <= effectiveMax) {
    return {
      text,
      truncated: false,
      originalLength,
      maxLength: effectiveMax,
    };
  }

  const suffix = `… (truncated ${originalLength - effectiveMax} chars)`;
  const available = Math.max(0, effectiveMax - suffix.length);
  const head = available > 0 ? text.slice(0, available) : "";

  return {
    text: `${head}${suffix}`,
    truncated: true,
    originalLength,
    maxLength: effectiveMax,
  };
}

export function createTruncatedToolResult(text: string): LanguageModelToolResult {
  const truncated = truncateToolOutputText(text).text;
  return new LanguageModelToolResult([new LanguageModelTextPart(truncated)]);
}
