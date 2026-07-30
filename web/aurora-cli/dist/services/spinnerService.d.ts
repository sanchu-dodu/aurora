export declare class SpinnerService {
    private spinner;
    constructor(text: string);
    start(): void;
    succeed(text?: string): void;
    fail(text?: string): void;
    info(text: string): void;
}
