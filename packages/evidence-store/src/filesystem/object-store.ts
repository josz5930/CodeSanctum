import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

/**
 * Content-addressed bytes on disk at objects/ab/cd/<digest>. Writes go to a
 * temporary file and are renamed into place, so a reader never observes a
 * partial object. Because the path is the content's own digest, a duplicate
 * write is a no-op and there is no overwrite case to reason about.
 */
export function createFilesystemObjectStore(root: string) {
  const pathFor = (digest: string): string => {
    const hex = digest.slice("sha256:".length);
    return path.join(root, "objects", hex.slice(0, 2), hex.slice(2, 4), hex);
  };

  return {
    async has(digest: string): Promise<boolean> {
      try {
        await readFile(pathFor(digest));
        return true;
      } catch {
        return false;
      }
    },

    async put(digest: string, bytes: Uint8Array): Promise<void> {
      const target = pathFor(digest);
      await mkdir(path.dirname(target), { recursive: true });
      const temporary = `${target}.tmp`;
      await writeFile(temporary, bytes, { flush: true });
      await rename(temporary, target);
    },

    async get(digest: string): Promise<Uint8Array | undefined> {
      try {
        return new Uint8Array(await readFile(pathFor(digest)));
      } catch {
        return undefined;
      }
    },

    async remove(digest: string): Promise<void> {
      await rm(pathFor(digest), { force: true });
    }
  };
}

export type FilesystemObjectStore = ReturnType<typeof createFilesystemObjectStore>;
