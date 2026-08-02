import {
  basename,
  resolve,
} from "node:path";

import { Kernel } from "./kernel.js";
import type { KernelContext } from "./kernelContext.js";
import type { KernelService } from "./kernelService.js";

export class KernelBuilder {
  private workspace = process.cwd();

  private projectName: string | undefined;

  private readonly services =
    new Map<string, KernelService>();

  withWorkspace(workspace: string): this {
    const normalizedWorkspace = workspace.trim();

    if (!normalizedWorkspace) {
      throw new Error(
        "Kernel workspace cannot be empty."
      );
    }

    this.workspace = resolve(normalizedWorkspace);

    return this;
  }

  withProjectName(projectName: string): this {
    const normalizedProjectName =
      projectName.trim();

    if (!normalizedProjectName) {
      throw new Error(
        "Kernel project name cannot be empty."
      );
    }

    this.projectName = normalizedProjectName;

    return this;
  }

  addService(service: KernelService): this {
    if (!service.id.trim()) {
      throw new Error(
        "Kernel service id cannot be empty."
      );
    }

    if (this.services.has(service.id)) {
      throw new Error(
        `Kernel service '${service.id}' is already registered.`
      );
    }

    this.services.set(service.id, service);

    return this;
  }

  build(): Kernel {
    const workspace = resolve(this.workspace);

    const inferredProjectName =
      basename(workspace) || "aurora-project";

    const context: KernelContext = {
      workspace,
      projectName:
        this.projectName ?? inferredProjectName,
      initializedAt: new Date(),
    };

    return new Kernel(
      context,
      this.services.values()
    );
  }
}
