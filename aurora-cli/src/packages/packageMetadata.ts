export interface AuroraPackage {
  id: string;

  name: string;

  version: string;

  description: string;

  author: string;

  framework: string;

  category: string;

  tags: string[];

  dependencies: string[];

  repository?: string;

  documentation?: string;
}