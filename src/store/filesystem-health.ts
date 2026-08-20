import fs from "node:fs/promises";
import path from "node:path";

export type StorageHealth = {
  check(): Promise<void>;
};

/** Verifies the local JSON store directory is writable. */
export function createFilesystemHealth(dataDirectory: string): StorageHealth {
  return {
    async check(): Promise<void> {
      await fs.mkdir(path.resolve(dataDirectory), { recursive: true });
      await fs.access(path.resolve(dataDirectory), fs.constants.W_OK);
    },
  };
}