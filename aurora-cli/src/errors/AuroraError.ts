import type {
  AuroraErrorCode,
} from "./errorCodes.js";

export interface AuroraErrorOptions {
  code: AuroraErrorCode;

  suggestion?: string;

  cause?: unknown;
}

export class AuroraError
  extends Error {
  readonly code:
    AuroraErrorCode;

  readonly suggestion?:
    string;

  constructor(
    message: string,
    options: AuroraErrorOptions
  ) {
    super(message);

    this.name =
      "AuroraError";

    this.code =
      options.code;

    this.suggestion =
      options.suggestion;

    if (
      options.cause !==
      undefined
    ) {
      this.cause =
        options.cause;
    }
  }
}