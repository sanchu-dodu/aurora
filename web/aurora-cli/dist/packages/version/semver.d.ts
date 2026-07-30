export declare class SemVer {
    major: number;
    minor: number;
    patch: number;
    constructor(major: number, minor: number, patch: number);
    static parse(version: string): SemVer;
    toString(): string;
}
