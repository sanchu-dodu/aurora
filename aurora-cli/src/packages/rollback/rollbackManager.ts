import fs from "fs/promises";
import path from "path";


export class RollbackManager {


  constructor(
    private projectPath: string
  ) {}



  async rollback(
    backupPath: string
  ): Promise<void> {


    const files =
      await fs.readdir(
        backupPath
      );


    for (
      const file of files
    ) {


      await fs.copyFile(

        path.join(
          backupPath,
          file
        ),

        path.join(
          this.projectPath,
          file
        )

      );

    }


    console.log(
      "Rollback completed successfully."
    );


  }


}