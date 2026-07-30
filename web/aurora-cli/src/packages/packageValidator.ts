import {
  ManifestSchema,
  PackageManifest
} from "./manifestSchema.js";


export function validatePackage(
  manifest: unknown
): PackageManifest {


  const result =
    ManifestSchema.safeParse(
      manifest
    );


  if (!result.success) {

    console.error(
      "Invalid package manifest:"
    );


    console.error(
      result.error.format()
    );


    throw new Error(
      "Package manifest validation failed"
    );

  }


  return result.data;

}