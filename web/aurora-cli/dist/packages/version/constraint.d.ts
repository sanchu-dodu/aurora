import { SemVer } from "./semver.js";
export interface VersionConstraint {
    operator: string;
    version: SemVer;
}
export declare class ConstraintParser {
    parse(constraint: string): VersionConstraint;
}
