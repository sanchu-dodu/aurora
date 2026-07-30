import ora from "ora";
export class SpinnerService {
    spinner;
    constructor(text) {
        this.spinner = ora(text);
    }
    start() {
        this.spinner.start();
    }
    succeed(text) {
        this.spinner.succeed(text);
    }
    fail(text) {
        this.spinner.fail(text);
    }
    info(text) {
        this.spinner.info(text);
    }
}
//# sourceMappingURL=spinnerService.js.map