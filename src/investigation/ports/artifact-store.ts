export type StoredArtifact = {
  storageKey: string;
  sizeBytes: number;
  sha256?: string;
};

export interface ArtifactStore {
  put(input: {
    investigationId: string;
    artifactId: string;
    extension: string;
    content: Uint8Array;
  }): Promise<StoredArtifact>;
  read?(storageKey: string): Promise<Uint8Array>;
  remove(storageKey: string): Promise<void>;
}
