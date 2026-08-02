import { registerTemplate } from "../core/templateRegistry.js";

registerTemplate({
  id: "nextjs",
  name: "nextjs",
  displayName: "Aurora Next.js Starter",
  version: "1.0.0",
  description:
    "Production-ready Next.js TypeScript starter template for Aurora CLI",
  author: "Aurora",
  framework: "nextjs",
  path: "templates/nextjs",
  tags: [
    "frontend",
    "react",
    "nextjs",
    "typescript"
  ],
});