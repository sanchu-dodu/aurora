import {
  AuroraError,
} from "./AuroraError.js";

import {
  redactText,
} from "../security/secretRedactor.js";

export function getErrorMessage(
  error: unknown
): string {
  if (error instanceof Error) {
    return redactText(
      error.message
    );
  }

  return redactText(
    String(error)
  );
}

export function formatFatalError(
  error: unknown
): string {
  if (
    error instanceof
    AggregateError
  ) {
    return formatAggregateError(
      error
    );
  }

  if (
    error instanceof
    AuroraError
  ) {
    return formatAuroraError(
      error
    );
  }

  return [
    "",
    "Aurora CLI failed:",
    `Message: ${getErrorMessage(error)}`,
  ].join("\n");
}

function formatAuroraError(
  error: AuroraError
): string {
  const lines = [
    "",
    "Aurora CLI failed:",
    `Code: ${error.code}`,
    `Message: ${redactText(error.message)}`,
  ];

  if (error.suggestion) {
    lines.push(
      `Suggestion: ${redactText(error.suggestion)}`
    );
  }

  return lines.join("\n");
}

function formatAggregateError(
  error: AggregateError
): string {
  const lines = [
    "",
    "Aurora CLI encountered multiple failures:",
  ];

  for (
    const innerError
    of error.errors
  ) {
    if (
      innerError instanceof
      AuroraError
    ) {
      lines.push(
        `- [${innerError.code}] ${redactText(innerError.message)}`
      );

      if (
        innerError.suggestion
      ) {
        lines.push(
          `  Suggestion: ${redactText(innerError.suggestion)}`
        );
      }

      continue;
    }

    lines.push(
      `- ${getErrorMessage(innerError)}`
    );
  }

  return lines.join("\n");
}
