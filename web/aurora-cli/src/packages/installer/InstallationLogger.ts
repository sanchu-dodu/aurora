export class InstallationLogger {

  info(message: string): void {
    console.log(message);
  }

  success(message: string): void {
    console.log(`✔ ${message}`);
  }

  warning(message: string): void {
    console.log(`⚠ ${message}`);
  }

  error(message: string): void {
    console.log(`✖ ${message}`);
  }

}