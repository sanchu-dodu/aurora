import { FrameworkAdapter } from "./frameworkAdapter.js";
export declare class NextJsAdapter implements FrameworkAdapter {
    id: string;
    displayName: string;
    createProject(projectName: string): Promise<void>;
}
