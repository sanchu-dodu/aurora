import fs from "fs/promises";
import path from "path";


export interface RecoveryTransaction {

  id: string;

  package: string;

  fromVersion: string;

  toVersion: string;

  status: string;

  backup?: string;

}



export class RecoveryManager {


  private folder: string;


  constructor(
    private projectPath: string
  ) {

    this.folder =
      path.join(
        projectPath,
        ".aurora",
        "transactions"
      );

  }



  async findIncomplete():

  Promise<RecoveryTransaction[]> {


    try {


      const files =
        await fs.readdir(
          this.folder
        );


      const transactions:
        RecoveryTransaction[] = [];



      for (
        const file of files
      ) {


        if (
          !file.endsWith(".json")
        ) {

          continue;

        }


        const content =
          await fs.readFile(
            path.join(
              this.folder,
              file
            ),
            "utf8"
          );


        const transaction =
          JSON.parse(content);



        if (
          transaction.status ===
          "started"
        ) {

          transactions.push(
            transaction
          );

        }


      }


      return transactions;


    } catch {


      return [];

    }


  }


}