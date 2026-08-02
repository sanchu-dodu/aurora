import { singleton } from "../decorators/singleton.js";

@singleton()
export class Logger {

  log(message: string) {
    console.log("[Aurora]", message);
  }

}