import { open, mkdir, readFile, rename, rm, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export class StorageError extends Error {
  constructor(
    readonly reason: 'invalid_key' | 'too_large' | 'missing' | 'failed',
  ) {
    super('Storage rejected');
  }
}

export type StorageAdapter = {
  put(key: string, bytes: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
};

const keyPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;

// Keys are plain file names: no separators, no traversal, no hidden prefixes.
export function assertStorageKey(key: string): void {
  if (!keyPattern.test(key) || key.includes('..'))
    throw new StorageError('invalid_key');
}

export function localStorageAdapter(options: {
  root: string;
  maxBytes?: number;
}): StorageAdapter {
  const root = options.root,
    maxBytes = options.maxBytes ?? 10 * 1024 * 1024,
    path = (key: string) => {
      assertStorageKey(key);
      return join(root, key);
    };
  return {
    async put(key, bytes) {
      const target = path(key);
      if (!Buffer.isBuffer(bytes)) throw new StorageError('failed');
      if (bytes.byteLength > maxBytes) throw new StorageError('too_large');
      const temporary = join(root, '.tmp-' + randomUUID());
      await mkdir(root, { recursive: true, mode: 0o700 });
      let handle;
      try {
        handle = await open(temporary, 'wx', 0o600);
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.close();
        handle = undefined;
        // Rename is atomic on one filesystem: readers never see a partial file.
        await rename(temporary, target);
      } catch (error) {
        await handle?.close().catch(() => {});
        await unlink(temporary).catch(() => {});
        if (error instanceof StorageError) throw error;
        throw new StorageError('failed');
      }
    },
    async read(key) {
      try {
        return await readFile(path(key));
      } catch (error) {
        if (error instanceof StorageError) throw error;
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          throw new StorageError('missing');
        throw new StorageError('failed');
      }
    },
    async remove(key) {
      try {
        await rm(path(key), { force: true });
      } catch (error) {
        if (error instanceof StorageError) throw error;
        throw new StorageError('failed');
      }
    },
  };
}
