import {
  UpdateManager,
} from "./update/updateManager.js";


export async function updatePackage(
  packageId: string
): Promise<void> {
  const manager =
    new UpdateManager();

  const projectPath =
    process.cwd();

  const result =
    await manager.check(
      packageId,
      projectPath
    );

  console.log();

  console.log(
    "Update Check"
  );

  console.log(
    "============"
  );

  console.log(
    `Package: ${result.package}`
  );

  console.log(
    `Current Version: ${result.currentVersion}`
  );

  console.log(
    `Latest Version: ${result.latestVersion}`
  );

  if (
    !result.updateAvailable
  ) {
    console.log();

    console.log(
      "Already up to date."
    );

    console.log();

    return;
  }

  console.log();

  console.log(
    "Update Plan"
  );

  console.log(
    "==========="
  );

  for (
    const step
    of result.plan
  ) {
    console.log(
      `${step.package}: ${step.currentVersion} -> ${step.targetVersion}`
    );
  }

  console.log();

  for (
    const step
    of result.plan
  ) {
    await manager.executeUpdate(
      step.package,
      projectPath,
      step.currentVersion,
      step.targetVersion
    );
  }

  console.log(
    "Update completed successfully."
  );

  console.log();
}
