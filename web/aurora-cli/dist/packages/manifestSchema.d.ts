import { z } from "zod";
export declare const ManifestSchema: z.ZodObject<{
    id: z.ZodString;
    version: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    dependencies: z.ZodDefault<z.ZodArray<z.ZodString>>;
    env: z.ZodDefault<z.ZodArray<z.ZodString>>;
    templates: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type PackageManifest = z.infer<typeof ManifestSchema>;
