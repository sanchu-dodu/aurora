import {
  z,
} from "zod";

const IdentifierSchema =
  z.string().regex(
    /^[a-z][a-z0-9.-]*$/u,
    "Expected a canonical lowercase identifier."
  ).max(100);

export const AuroraConfigSchema =
  z.object({
    defaultFramework:
      IdentifierSchema,
    language: z.enum([
      "javascript",
      "typescript",
    ]),
    packageManager: z.enum([
      "bun",
      "npm",
      "pnpm",
      "yarn",
    ]),
    installDependencies:
      z.boolean(),
    initializeGit:
      z.boolean(),
  }).strict();

export type AuroraConfig =
  z.infer<
    typeof AuroraConfigSchema
  >;

export type AuroraConfigKey =
  keyof AuroraConfig;

export const AURORA_CONFIG_KEYS = [
  "defaultFramework",
  "language",
  "packageManager",
  "installDependencies",
  "initializeGit",
] as const satisfies
  readonly AuroraConfigKey[];

export const defaultConfig:
  AuroraConfig = {
    defaultFramework: "nextjs",
    language: "typescript",
    packageManager: "npm",
    installDependencies: true,
    initializeGit: true,
  };
