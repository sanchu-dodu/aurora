import {
  registerTemplate,
} from "../core/templateRegistry.js";

registerTemplate({
  id: "nextjs",
  name: "nextjs",
  displayName:
    "Aurora Next.js Starter",
  version: "1.1.0",
  description:
    "Buildable Next.js TypeScript starter with pinned direct dependencies",
  author: "Aurora",
  framework: "nextjs",
  path:
    "templates/projects/nextjs",
  tags: [
    "frontend",
    "react",
    "nextjs",
    "typescript",
  ],
});
