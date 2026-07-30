import { SemVer } from "./semver.js";
import { VersionComparator } from "./comparator.js";

const comparator =
  new VersionComparator();

const a =
  SemVer.parse("1.2.0");

const b =
  SemVer.parse("1.5.1");

console.log(

  comparator.compare(
    a,
    b
  )

);