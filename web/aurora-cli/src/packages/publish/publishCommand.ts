import path from "path";
import { PackagePublisher } from "./packagePublisher.js";

export async function publishPackage(
  packageId: string
): Promise<void> {

  const publisher =
    new PackagePublisher();

  await publisher.publish(

    path.join(
      process.cwd(),
      "packages",
      packageId
    )

  );

}