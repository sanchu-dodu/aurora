export interface UpdateStep {
    package: string;
    currentVersion: string;
    targetVersion: string;
}
export declare class UpdatePlanner {
    createPlan(packageId: string, currentVersion: string, targetVersion: string): UpdateStep[];
}
