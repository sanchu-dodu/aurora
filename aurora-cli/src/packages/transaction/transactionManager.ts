import fs from "fs/promises";
import path from "path";


export interface Transaction {

  id: string;

  package: string;

  fromVersion: string;

  toVersion: string;

  status:
    | "started"
    | "completed"
    | "failed"
    | "rolled_back";

  startedAt: string;

  finishedAt?: string;

  backup?: string;

}



export class TransactionManager {


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



  private async ensureFolder() {

    await fs.mkdir(
      this.folder,
      {
        recursive: true
      }
    );

  }



  async create(
    transaction: Transaction
  ): Promise<void> {


    await this.ensureFolder();


    await fs.writeFile(

      path.join(
        this.folder,
        `${transaction.id}.json`
      ),

      JSON.stringify(
        transaction,
        null,
        2
      )

    );

  }



  async update(
    id: string,
    data: Partial<Transaction>
  ): Promise<void> {


    await this.ensureFolder();


    const file =
      path.join(
        this.folder,
        `${id}.json`
      );


    const content =
      await fs.readFile(
        file,
        "utf8"
      );


    const transaction =
      JSON.parse(content);



    await fs.writeFile(

      file,

      JSON.stringify(
        {
          ...transaction,
          ...data
        },
        null,
        2
      )

    );

  }


}