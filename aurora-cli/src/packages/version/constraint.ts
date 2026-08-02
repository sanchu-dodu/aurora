import { SemVer } from "./semver.js";

export interface VersionConstraint {

  operator: string;

  version: SemVer;

}

export class ConstraintParser {

  parse(
    constraint: string
  ): VersionConstraint {

    const operators = [

      ">=",
      "<=",
      "^",
      "~",
      ">",
      "<"

    ];

    for (const operator of operators) {

      if (
        constraint.startsWith(operator)
      ) {

        return {

          operator,

          version:
            SemVer.parse(
              constraint.slice(
                operator.length
              )
            )

        };

      }

    }

    return {

      operator: "=",

      version:
        SemVer.parse(
          constraint
        )

    };

  }

}