import fs from "fs/promises";
import path from "path";


export class EnvContext {


  constructor(
    private projectPath:string
  ){}



  async addVariables(
    variables:string[]
  ):Promise<void>{


    const file =
      path.join(
        this.projectPath,
        ".env.example"
      );


    let content = "";


    try {

      content =
        await fs.readFile(
          file,
          "utf-8"
        );

    } catch {

      content = "";

    }



    for(const variable of variables){


      if(!content.includes(variable)){


        content +=
          `${variable}=\n`;


      }

    }



    await fs.writeFile(
      file,
      content
    );


    console.log(
      "Updated .env.example"
    );


  }


}