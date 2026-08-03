import {
  AuroraError,
} from "./AuroraError.js";

export function getErrorMessage(
  error: unknown
): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
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
    `Message: ${error.message}`,
  ];

  if (error.suggestion) {
    lines.push(
      `Suggestion: ${error.suggestion}`
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
        `- [${innerError.code}] ${innerError.message}`
      );

      if (
        innerError.suggestion
      ) {
        lines.push(
          `  Suggestion: ${innerError.suggestion}`
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