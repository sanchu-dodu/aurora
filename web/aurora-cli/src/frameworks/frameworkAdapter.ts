export interface FrameworkAdapter {

  id: string;

  displayName: string;

  createProject(
    projectName: string
  ): Promise<void>;

}
