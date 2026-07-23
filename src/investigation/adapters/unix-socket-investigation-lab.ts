import http from "node:http";
import type { InvestigationLab, InvestigationShellResult } from "../ports/investigation-lab.js";

export class UnixSocketInvestigationLab implements InvestigationLab {
  constructor(private readonly options: { socketPath: string; token: string; timeoutMs: number }) {}

  execute(input: { investigationId: string; command: string; timeoutMs?: number }): Promise<InvestigationShellResult> {
    const body = JSON.stringify({ command: input.command, timeoutMs: input.timeoutMs ?? this.options.timeoutMs });
    return new Promise((resolve, reject) => {
      const request = http.request({
        socketPath: this.options.socketPath,
        path: `/v1/labs/${encodeURIComponent(input.investigationId)}/exec`,
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.token}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      }, (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => { text += chunk; });
        response.once("error", reject);
        response.once("end", () => {
          if ((response.statusCode ?? 500) >= 300) {
            reject(new Error(`Investigation lab returned HTTP ${response.statusCode ?? 500}`));
            return;
          }
          try { resolve(JSON.parse(text) as InvestigationShellResult); } catch { reject(new Error("Investigation lab returned invalid JSON")); }
        });
      });
      request.once("error", reject);
      request.end(body);
    });
  }
}
