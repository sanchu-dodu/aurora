export interface PackageManifest {

  id: string;

  version: string;

  description: string;

  author: string;

  framework: string;

  category: string;

  tags: string[];

  dependencies: string[];

  repository: string;

  documentation: string;

}