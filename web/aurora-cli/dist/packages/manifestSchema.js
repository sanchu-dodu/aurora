import { z } from "zod";
export const ManifestSchema = z.object({
    id: z.string()
        .min(1, "Package id is required"),
    version: z.string()
        .min(1, "Package version is required"),
    description: z.string()
        .optional(),
    dependencies: z.array(z.string())
        .default([]),
    env: z.array(z.string())
        .default([]),
    templates: z.array(z.string())
        .default([])
});
//# sourceMappingURL=manifestSchema.js.map