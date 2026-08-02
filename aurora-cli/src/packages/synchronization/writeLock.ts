export class WriteLock {

  private static locked = false;

  async acquire(): Promise<void> {

    while (WriteLock.locked) {

      await new Promise(
        resolve =>
          setTimeout(resolve, 5)
      );

    }

    WriteLock.locked = true;

  }

  release(): void {

    WriteLock.locked = false;

  }

}