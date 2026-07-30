import { SemVer } from "./semver.js";

export class VersionComparator {

  compare(
    a: SemVer,
    b: SemVer
  ): number {

    if (
      a.major !== b.major
    ) {

      return a.major - b.major;

    }

    if (
      a.minor !== b.minor
    ) {

      return a.minor - b.minor;

    }

    return a.patch - b.patch;

  }

}