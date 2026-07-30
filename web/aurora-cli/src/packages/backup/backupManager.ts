import fs from "fs/promises";
import path from "path";


export class BackupManager {


  private backupPath: string;


  constructor(
    private projectPath: string
  ) {

    this.backupPath =
      path.join(
        projectPath,
        ".aurora",
        "backups"
      );

  }



  async createBackup(): Promise<string> {


    await fs.mkdir(
      this.backupPath,
      {
        recursive: true
      }
    );


    const timestamp =
      new Date()
        .toISOString()
        .replace(
          /[:.]/g,
          "-"
        );


    const backupFolder =
      path.join(
        this.backupPath,
        timestamp
      );


    await fs.mkdir(
      backupFolder,
      {
        recursive: true
      }
    );


    const files = [
      "package.json",
      ".env.example",
      ".aurora/cache.json"
    ];


    for (
      const file of files
    ) {


      try {

        await fs.copyFile(
          path.join(
            this.projectPath,
            file
          ),
          path.join(
            backupFolder,
            path.basename(file)
          )
        );


      } catch {

        // Ignore missing files

      }

    }


    return backupFolder;

  }


}
