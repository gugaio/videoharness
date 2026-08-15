import fs from "node:fs/promises";
import path from "node:path";

const SAFE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Removes the local files an investigation owns: the artifact directory, the
 * sandboxed lab workspace and the workspaces/published directories of its
 * experiment recordings. Directory removal is idempotent and never fails when
 * a directory does not exist.
 */
export class FilesystemInvestigationCleanup {
  constructor(private readonly dataDirectory: string) {}

  async removeInvestigationFiles(investigationId: string): Promise<void> {
    assertSafeId(investigationId);
    await Promise.all([
      fs.rm(this.resolve("artifacts", investigationId), { recursive: true, force: true }),
      fs.rm(this.resolve("workspaces", investigationId), { recursive: true, force: true }),
    ]);
  }

  async removeRecordingFiles(recordingId: string): Promise<void> {
    assertSafeId(recordingId);
    await Promise.all([
      fs.rm(this.resolve("recordings", recordingId), { recursive: true, force: true }),
      fs.rm(this.resolve("recording-workspaces", recordingId), { recursive: true, force: true }),
    ]);
  }

  private resolve(directory: string, id: string): string {
    const root = path.resolve(this.dataDirectory, directory);
    const target = path.resolve(root, id);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Investigation cleanup path is invalid");
    return target;
  }
}

function assertSafeId(id: string): void {
  if (!SAFE_ID.test(id)) throw new Error("Investigation cleanup id is invalid");
}
