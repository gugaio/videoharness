import fs from "node:fs/promises";
import path from "node:path";
import type { RecordingStore, RecordingWorkspace } from "../ports/recording-store.js";

const SAFE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Files are only exposed after the complete workspace is atomically renamed. */
export class FilesystemRecordingStore implements RecordingStore {
  constructor(private readonly dataDirectory: string) {}

  async prepareWorkspace(recordingId: string): Promise<RecordingWorkspace> {
    const workspacePath = this.workspacePath(recordingId);
    await fs.rm(workspacePath, { recursive: true, force: true });
    await fs.mkdir(workspacePath, { recursive: true });
    return { recordingId, path: workspacePath };
  }

  async publish(workspace: RecordingWorkspace): Promise<void> {
    const source = this.workspacePath(workspace.recordingId);
    if (path.resolve(workspace.path) !== source) throw new Error("Recording workspace is invalid");
    const destination = this.publishedPath(workspace.recordingId);
    await fs.mkdir(destination, { recursive: true });
    await this.moveContents(source, destination);
  }

  private async moveContents(source: string, destination: string): Promise<void> {
    const entries = await fs.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      const from = path.join(source, entry.name);
      const to = path.join(destination, entry.name);
      await fs.rename(from, to);
    }
    await fs.rm(source, { recursive: true, force: true });
  }

  async discardWorkspace(recordingId: string): Promise<void> {
    await fs.rm(this.workspacePath(recordingId), { recursive: true, force: true });
  }

  async removePublished(recordingId: string): Promise<void> {
    await fs.rm(this.publishedPath(recordingId), { recursive: true, force: true });
  }

  async readPublishedResource(storageKey: string): Promise<Uint8Array> {
    const root = path.resolve(this.dataDirectory, "recordings");
    const destination = path.resolve(this.dataDirectory, storageKey);
    if (!destination.startsWith(`${root}${path.sep}`)) throw new Error("Recording resource storage key is invalid");
    return fs.readFile(destination);
  }

  /** Resolves an already-published recording resource without consulting PostgreSQL. */
  async readPublishedRecordingResource(recordingId: string, logicalPath: string): Promise<Uint8Array> {
    const root = this.publishedPath(recordingId);
    const destination = path.resolve(root, logicalPath);
    if (!destination.startsWith(`${root}${path.sep}`)) throw new Error("Recording resource path is invalid");
    return fs.readFile(destination);
  }

  private workspacePath(recordingId: string): string {
    return this.resolve("recording-workspaces", recordingId);
  }

  private publishedPath(recordingId: string): string {
    return this.resolve("recordings", recordingId);
  }

  private resolve(directory: string, recordingId: string): string {
    if (!SAFE_ID.test(recordingId)) throw new Error("Recording ID is invalid");
    const root = path.resolve(this.dataDirectory, directory);
    const target = path.resolve(root, recordingId);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Recording storage path is invalid");
    return target;
  }
}
