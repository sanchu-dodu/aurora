import {
  compareManifestSemVer,
  parseManifestSemVer,
} from "../version/manifestVersion.js";


export interface UpdateStep {
  package: string;

  currentVersion: string;

  targetVersion: string;
}


export class UpdatePlanner {
  createPlan(
    packageId: string,
    currentVersion: string,
    targetVersion: string
  ): UpdateStep[] {
    const current =
      parseManifestSemVer(
        currentVersion
      );

    const target =
      parseManifestSemVer(
        targetVersion
      );

    const comparison =
      compareManifestSemVer(
        target,
        current
      );

    if (
      comparison === 0
    ) {
      return [];
    }

    if (
      comparison < 0
    ) {
      throw new Error(
        `Package update cannot downgrade '${packageId}' from '${currentVersion}' to '${targetVersion}'.`
      );
    }

    return [
      {
        package:
          packageId,

        currentVersion,

        targetVersion,
      },
    ];
  }
}
