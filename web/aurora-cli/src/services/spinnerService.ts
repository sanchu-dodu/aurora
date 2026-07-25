import ora, { Ora } from "ora";

export class SpinnerService {

  private spinner: Ora;

  constructor(text: string) {
    this.spinner = ora(text);
  }

  start(): void {
    this.spinner.start();
  }

  succeed(text?: string): void {
    this.spinner.succeed(text);
  }

  fail(text?: string): void {
    this.spinner.fail(text);
  }

  info(text: string): void {
    this.spinner.info(text);
  }

}