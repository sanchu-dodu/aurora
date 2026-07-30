export interface GeneratorDefinition {
    id: string;
    output: string;
}
export declare function registerGenerator(id: string): void;
export declare function getGenerator(id: string): GeneratorDefinition;
export declare function listGenerators(): GeneratorDefinition[];
