export type FrameworkOption = {
    name: string;
    value: string;
    description: string;
};
export declare function getAvailableFrameworks(): Promise<FrameworkOption[]>;
export declare function getFrameworkDisplayName(framework: string): Promise<string>;
