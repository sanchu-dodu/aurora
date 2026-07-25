import { resolveDependencies } from "../dependencyResolver.js";
import { loadInstaller } from "./installerLoader.js";
import { InstallerContext } from "./installerContext.js";


export class PackageInstaller {


  async install(
    packageId: string
  ): Promise<void> {


    const packages =
      await resolveDependencies(
        packageId
      );


    const context =
      new InstallerContext(
        process.cwd()
      );


    console.log();

    console.log(
      "Installing Packages"
    );

    console.log(
      "==================="
    );

    console.log();


    for (const pkg of packages) {


      console.log(
        `Installing ${pkg}...`
      );


      const installer =
        await loadInstaller(
          pkg
        );


      if (installer) {


        await installer(
          context
        );


      } else {


        console.log(
          "No installer found."
        );


      }


      console.log(
        "✔ Complete"
      );

      console.log();


    }


    console.log(
      "Installation finished."
    );


  }

}