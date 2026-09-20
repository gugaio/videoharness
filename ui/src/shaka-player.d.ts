declare module "shaka-player" {
  interface ShakaErrorEvent extends Event {
    detail?: { code?: number; category?: number; severity?: number; message?: string };
  }
  interface ShakaPlayer extends EventTarget {
    attach(media: HTMLMediaElement): Promise<void>;
    load(uri: string): Promise<void>;
    configure(config: Record<string, unknown>): void;
    destroy(): Promise<void>;
    getStats(): Record<string, unknown>;
  }
  const shaka: { Player: new () => ShakaPlayer };
  export default shaka;
}
