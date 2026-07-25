import { AURORA_VERSION } from "../core/version.js";


export function validatePackage(
  manifest:any
):void {


  const required =
    manifest.aurora?.minimumVersion;


  if(!required){

    return;

  }


  if(
    AURORA_VERSION < required
  ){

    throw new Error(
      `Package ${manifest.id} requires Aurora ${required} or higher`
    );

  }


}