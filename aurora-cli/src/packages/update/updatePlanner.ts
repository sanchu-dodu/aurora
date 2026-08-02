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


    if (
      currentVersion === targetVersion
    ) {

      return [];

    }


    return [

      {

        package: packageId,

        currentVersion,

        targetVersion

      }

    ];

  }

}
