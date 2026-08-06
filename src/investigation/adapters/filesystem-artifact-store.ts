import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { ArtifactStore, StoredArtifact } from "../ports/artifact-store.js";

const SAFE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_EXTENSION = /^[a-z0-9]{1,10}$/i;

export class FilesystemArtifactStore implements ArtifactStore {
  constructor(private readonly dataDirectory: string) {}

  async put(input: {
    investigationId: string;
    artifactId: string;
    extension: string;
    content: Uint8Array;
  }): Promise<StoredArtifact> {
    if (!SAFE_ID.test(input.investigationId) || !SAFE_ID.test(input.artifactId) || !SAFE_EXTENSION.test(input.extension)) {
      throw new Error("Artifact path components are invalid");
    }
    const directory = path.join(this.dataDirectory, "artifacts", input.investigationId);
    const fileName = `${input.artifactId}.${input.extension.toLowerCase()}`;
    const storageKey = path.posix.join("artifacts", input.investigationId, fileName);
    const destination = path.join(directory, fileName);
    const temporary = `${destination}.tmp`;
    await fs.mkdir(directory, { recursive: true });
    try {
      await fs.writeFile(temporary, input.content, { flag: "wx" });
      await fs.rename(temporary, destination);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    return { storageKey, sizeBytes: input.content.byteLength, sha256: createHash("sha256").update(input.content).digest("hex") };
  }

  async remove(storageKey: string): Promise<void> {
    const destination = this.resolve(storageKey);
    await fs.rm(destination, { force: true });
  }

  async read(storageKey: string): Promise<Uint8Array> {
    return fs.readFile(this.resolve(storageKey));
  }

  private resolve(storageKey: string): string {
    const destination = path.resolve(this.dataDirectory, storageKey);
    const artifactRoot = `${path.resolve(this.dataDirectory, "artifacts")}${path.sep}`;
    if (!destination.startsWith(artifactRoot)) throw new Error("Artifact storage key is invalid");
    return destination;
  }
}
