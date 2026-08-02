import path from "path";
import { pathToFileURL } from "url";


export async function loadHooks(
  packageId: string
) {

  const hookPath =
    path.join(
      process.cwd(),
      "packages",
      packageId,
      "hooks",
      "hooks.js"
    );


  try {

    const module =
      await import(
        pathToFileURL(hookPath).href
      );


    return module;


  } catch (error) {

    return null;

  }

}