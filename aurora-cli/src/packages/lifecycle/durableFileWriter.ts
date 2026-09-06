import {
  randomUUID,
} from "node:crypto";
import fs, {
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";

export interface DurableWriteFileOptions {
  readonly mode?: number;
}

export async function durableWriteFile(
  file: string,
  content:
    string |
    Uint8Array,
  options:
    DurableWriteFileOptions = {}
): Promise<void> {
  const target =
    path.resolve(file);

  const directory =
    path.dirname(target);

  await durableEnsureDirectory(
    directory
  );

  const temporary =
    path.join(
      directory,
      `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`
    );

  let handle:
    FileHandle | undefined;

  try {
    handle =
      await fs.open(
        temporary,
        "wx",
        options.mode ??
          0o600
      );

    await handle.writeFile(
      content
    );

    await handle.sync();

    await handle.close();
    handle = undefined;

    await fs.rename(
      temporary,
      target
    );

    await syncDirectory(
      directory
    );
  }
  catch (error) {
    try {
      await handle?.close();
    }
    catch {
      // Preserve the primary write failure.
    }

    try {
      await fs.rm(
        temporary,
        {
          force: true,
        }
      );
    }
    catch {
      // Preserve the primary write failure.
    }

    throw error;
  }
}

export async function durableEnsureDirectory(
  directory: string,
  mode = 0o700
): Promise<void> {
  const resolved =
    path.resolve(directory);

  const missing:
    string[] = [];

  let current =
    resolved;

  while (true) {
    try {
      const information =
        await fs.stat(
          current
        );

      if (!information.isDirectory()) {
        throw new Error(
          `Durable directory path is not a directory: ${current}`
        );
      }

      break;
    }
    catch (error) {
      const code =
        (
          error as NodeJS.ErrnoException
        ).code;

      if (code !== "ENOENT") {
        throw error;
      }

      missing.push(
        current
      );

      const parent =
        path.dirname(current);

      if (parent === current) {
        throw new Error(
          `Cannot create durable directory root: ${resolved}`
        );
      }

      current =
        parent;
    }
  }

  for (
    const candidate of
    missing.reverse()
  ) {
    try {
      await fs.mkdir(
        candidate,
        {
          recursive: false,
          mode,
        }
      );
    }
    catch (error) {
      const code =
        (
          error as NodeJS.ErrnoException
        ).code;

      if (code !== "EEXIST") {
        throw error;
      }

      /*
       * Another cooperating writer may create the same missing directory
       * between discovery and mkdir. Accept only the resulting real
       * directory; a file or symbolic-link substitution still fails closed.
       */
      const information =
        await fs.lstat(
          candidate
        );

      if (
        !information.isDirectory() ||
        information.isSymbolicLink()
      ) {
        throw error;
      }
    }

    await syncDirectory(
      path.dirname(
        candidate
      )
    );

    await syncDirectory(
      candidate
    );
  }
}

export async function durableCreateDirectory(
  directory: string,
  mode = 0o700
): Promise<void> {
  const resolved =
    path.resolve(directory);

  const parent =
    path.dirname(resolved);

  await durableEnsureDirectory(
    parent,
    mode
  );

  await fs.mkdir(
    resolved,
    {
      recursive: false,
      mode,
    }
  );

  await syncDirectory(
    parent
  );

  await syncDirectory(
    resolved
  );
}

export async function syncDirectory(
  directory: string
): Promise<void> {
  /*
   * Node does not expose a portable Windows directory-fsync
   * primitive. FileHandle.sync() is still used for file data
   * before rename; directory sync is applied where the platform
   * supports opening directory handles.
   */
  if (process.platform === "win32") {
    return;
  }

  let handle:
    FileHandle | undefined;

  try {
    handle =
      await fs.open(
        directory,
        "r"
      );

    await handle.sync();
  }
  catch (error) {
    const code =
      (
        error as NodeJS.ErrnoException
      ).code;

    if (
      code === "EINVAL" ||
      code === "ENOTSUP" ||
      code === "EISDIR"
    ) {
      return;
    }

    throw error;
  }
  finally {
    await handle?.close();
  }
}
