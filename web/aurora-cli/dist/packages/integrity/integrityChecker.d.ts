export declare class IntegrityChecker {
    checksum(file: string): Promise<string>;
    verify(expected: string, actual: string): boolean;
}
