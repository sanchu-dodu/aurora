import { SemVer } from "./semver.js";
export class ConstraintParser {
    parse(constraint) {
        const operators = [
            ">=",
            "<=",
            "^",
            "~",
            ">",
            "<"
        ];
        for (const operator of operators) {
            if (constraint.startsWith(operator)) {
                return {
                    operator,
                    version: SemVer.parse(constraint.slice(operator.length))
                };
            }
        }
        return {
            operator: "=",
            version: SemVer.parse(constraint)
        };
    }
}
//# sourceMappingURL=constraint.js.map