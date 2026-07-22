export type StoredArtifact = {
  storageKey: string;
  sizeBytes: number;
};

export interface ArtifactStore {
  put(input: {
    investigationId: string;
    artifactId: string;
    extension: string;
    content: Uint8Array;
  }): Promise<StoredArtifact>;
  remove(storageKey: string): Promise<void>;
}
