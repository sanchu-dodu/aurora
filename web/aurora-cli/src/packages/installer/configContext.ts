import fs from "fs/promises";
import path from "path";


export class ConfigContext {

  constructor(
    private root:string
  ){}


  async updatePackageJson(
    dependency:string,
    version:string
  ){

    const file =
      path.join(
        this.root,
        "package.json"
      );


    const content =
      await fs.readFile(
        file,
        "utf-8"
      );


    const json =
      JSON.parse(content);


    json.dependencies =
      json.dependencies || {};


    json.dependencies[dependency] =
      version;


    await fs.writeFile(
      file,
      JSON.stringify(
        json,
        null,
        2
      )
    );


    console.log(
      `Added dependency ${dependency}`
    );

  }


}