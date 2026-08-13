import type {
  ExtensionCapability,
} from "./extensionManifest.js";

export type ExtensionLifecycle =
  | "activate"
  | "deactivate";

export interface ExtensionRequest {
  readonly type: "request";
  readonly requestId: string;
  readonly capability:
    ExtensionCapability;
  readonly action: string;
  readonly input?: unknown;
}

export interface ExtensionResponse {
  readonly type: "response";
  readonly requestId: string;
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: string;
}

export interface ExtensionCompleted {
  readonly type: "completed";
  readonly value?: unknown;
}

export interface ExtensionFailed {
  readonly type: "failed";
  readonly error: string;
}

export interface ExtensionLimit {
  readonly type: "limit";
  readonly limit: "output";
}

export type ExtensionWorkerMessage =
  | ExtensionRequest
  | ExtensionCompleted
  | ExtensionFailed
  | ExtensionLimit;

export interface ExtensionContext {
  readonly output: {
    write(message: string):
      Promise<void>;
  };

  readonly environment: {
    read(name: string):
      Promise<string | undefined>;
  };
}

export interface ExtensionModule {
  activate?(
    context: ExtensionContext
  ): Promise<unknown> | unknown;

  deactivate?(
    context: ExtensionContext
  ): Promise<unknown> | unknown;
}
