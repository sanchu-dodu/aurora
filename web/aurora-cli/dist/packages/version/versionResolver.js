import { VersionComparator } from "./comparator.js";
import { ConstraintParser } from "./constraint.js";
import { SemVer } from "./semver.js";
export class VersionResolver {
    comparator = new VersionComparator();
    parser = new ConstraintParser();
    satisfies(installed, constraint) {
        const current = SemVer.parse(installed);
        const rule = this.parser.parse(constraint);
        const comparison = this.comparator.compare(current, rule.version);
        switch (rule.operator) {
            case "=":
                return comparison === 0;
            case ">":
                return comparison > 0;
            case "<":
                return comparison < 0;
            case ">=":
                return comparison >= 0;
            case "<=":
                return comparison <= 0;
            default:
                return false;
        }
    }
}
//# sourceMappingURL=versionResolver.js.map