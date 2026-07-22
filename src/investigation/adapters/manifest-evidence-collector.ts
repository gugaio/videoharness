import { inspectManifest } from "../../stream-tools/manifest.js";
import { SafeHttpClient } from "../../stream-tools/safe-http-client.js";
import type { StreamEvidenceCollector } from "../ports/stream-evidence-collector.js";

export class ManifestEvidenceCollector implements StreamEvidenceCollector {
  constructor(private readonly http: SafeHttpClient) {}

  async collectManifest(sourceUrl: string) {
    const response = await this.http.getText(sourceUrl);
    return {
      requestedUrl: response.requestedUrl,
      finalUrl: response.finalUrl,
      statusCode: response.statusCode,
      ...(response.contentType ? { contentType: response.contentType } : {}),
      bytes: response.bytes,
      inspection: inspectManifest(response.text),
    };
  }
}
