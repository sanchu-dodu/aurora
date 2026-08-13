import {
  redactText,
} from "../../security/secretRedactor.js";

export class InstallationLogger {
  info(message: string): void {
    console.log(
      redactText(message)
    );
  }

  success(message: string): void {
    console.log(
      `✔ ${redactText(message)}`
    );
  }

  warning(message: string): void {
    console.log(
      `⚠ ${redactText(message)}`
    );
  }

  error(message: string): void {
    console.log(
      `✖ ${redactText(message)}`
    );
  }
}
