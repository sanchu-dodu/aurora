export interface AuroraPlugin {

  id: string;

  name: string;

  version: string;

  activate(): Promise<void>;

  deactivate(): Promise<void>;

}