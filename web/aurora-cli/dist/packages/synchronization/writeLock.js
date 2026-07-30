export class WriteLock {
    static locked = false;
    async acquire() {
        while (WriteLock.locked) {
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        WriteLock.locked = true;
    }
    release() {
        WriteLock.locked = false;
    }
}
//# sourceMappingURL=writeLock.js.map