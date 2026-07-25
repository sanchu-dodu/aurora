import { resolveDependencies } from "../dependencyResolver.js";
import { loadInstaller } from "./installerLoader.js";
import { InstallerContext } from "./installerContext.js";
import { loadHooks } from "./hookLoader.js";
import { validatePackage } from "../packageValidator.js";

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
const hooks =
 await loadHooks(pkg);


if(hooks?.beforeInstall){

 await hooks.beforeInstall(context);

}

const manifest =
 await import(
  `../../packages/${pkg}/manifest.json`,
  {
    with:{
      type:"json"
    }
  }
 );


validatePackage(
 manifest.default
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

if(hooks?.afterInstall){

 await hooks.afterInstall(context);

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