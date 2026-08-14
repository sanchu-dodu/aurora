import type {
  PackageCapability,
} from "./packageCapabilityPolicy.js";

export type PackageExecutionLifecycle =
  | "beforeInstall"
  | "install"
  | "afterInstall";

export interface PackageExecutionRequest {
  readonly type: "request";
  readonly requestId: string;
  readonly capability:
    PackageCapability;
  readonly action: string;
  readonly input?: unknown;
}

export interface PackageExecutionResponse {
  readonly type: "response";
  readonly requestId: string;
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: string;
}

export interface PackageExecutionLog {
  readonly type: "log";
  readonly message: string;
}

export interface PackageExecutionCompleted {
  readonly type: "completed";
  readonly executed: boolean;
}

export interface PackageExecutionFailed {
  readonly type: "failed";
  readonly error: string;
}

export interface PackageExecutionLimit {
  readonly type: "limit";
  readonly limit: "output";
}

export type PackageExecutionWorkerMessage =
  | PackageExecutionRequest
  | PackageExecutionLog
  | PackageExecutionCompleted
  | PackageExecutionFailed
  | PackageExecutionLimit;

export interface PackageWorkerContext {
  log(message: string): void;

  createFile(
    filePath: string,
    content: string
  ): Promise<void>;

  readonly config: {
    addDependency(
      packageName: string,
      version?: string
    ): Promise<void>;
  };

  readonly env: {
    addVariables(
      variables: string[]
    ): Promise<void>;
  };
}

export interface PackageExecutableModule {
  beforeInstall?(
    context: PackageWorkerContext
  ): Promise<unknown> | unknown;

  install?(
    context: PackageWorkerContext
  ): Promise<unknown> | unknown;

  afterInstall?(
    context: PackageWorkerContext
  ): Promise<unknown> | unknown;
}
