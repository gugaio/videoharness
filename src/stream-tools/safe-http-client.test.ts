import { Readable } from "node:stream";
import type http from "node:http";
import { describe, expect, it, vi } from "vitest";
import { isPublicAddress, SafeHttpClient, type PinnedRequester } from "./safe-http-client.js";

describe("public address policy", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "100.64.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "192.0.2.1",
    "192.88.99.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.10",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ])("blocks non-public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"])(
    "allows public address %s",
    (address) => expect(isPublicAddress(address)).toBe(true),
  );
});

describe("SafeHttpClient", () => {
  it("blocks literal private targets before opening a connection", async () => {
    const requester = vi.fn<PinnedRequester>();
    const client = new SafeHttpClient({ requester });

    await expect(client.getText("http://127.0.0.1:3210/v1/health"))
      .rejects.toMatchObject({ code: "STREAM_DESTINATION_BLOCKED", retryable: false });
    expect(requester).not.toHaveBeenCalled();
  });

  it("blocks a hostname when any DNS answer is private", async () => {
    const requester = vi.fn<PinnedRequester>();
    const client = new SafeHttpClient({
      resolver: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.2", family: 4 },
      ],
      requester,
    });

    await expect(client.getText("https://stream.example/master.m3u8"))
      .rejects.toMatchObject({ code: "STREAM_DESTINATION_BLOCKED" });
    expect(requester).not.toHaveBeenCalled();
  });

  it("allows only an explicitly configured local development hostname alias", async () => {
    const resolver = vi.fn(async () => [{ address: "172.17.0.1", family: 4 as const }]);
    const requester = vi.fn<PinnedRequester>()
      .mockResolvedValue(response(200, "#EXTM3U", { "content-type": "application/vnd.apple.mpegurl" }));
    const client = new SafeHttpClient({
      resolver,
      requester,
      allowedPrivateHostnameAliases: { localhost: "host.docker.internal" },
    });

    const result = await client.getText("http://localhost:8080/index.m3u8");

    expect(resolver).toHaveBeenCalledWith("host.docker.internal");
    expect(requester.mock.calls[0]?.[0].hostname).toBe("localhost");
    expect(requester.mock.calls[0]?.[1].address).toBe("172.17.0.1");
    expect(result.text).toBe("#EXTM3U");
  });

  it("keeps literal private IPs blocked when a localhost alias is configured", async () => {
    const requester = vi.fn<PinnedRequester>();
    const client = new SafeHttpClient({
      requester,
      allowedPrivateHostnameAliases: { localhost: "host.docker.internal" },
    });

    await expect(client.getText("http://127.0.0.1:8080/index.m3u8"))
      .rejects.toMatchObject({ code: "STREAM_DESTINATION_BLOCKED", retryable: false });
    expect(requester).not.toHaveBeenCalled();
  });

  it("revalidates redirects away from the configured localhost alias", async () => {
    const requester = vi.fn<PinnedRequester>()
      .mockResolvedValueOnce(response(302, "", { location: "http://127.0.0.1:8080/private.m3u8" }));
    const client = new SafeHttpClient({
      resolver: async () => [{ address: "172.17.0.1", family: 4 }],
      requester,
      allowedPrivateHostnameAliases: { localhost: "host.docker.internal" },
    });

    await expect(client.getText("http://localhost:8080/index.m3u8"))
      .rejects.toMatchObject({ code: "STREAM_DESTINATION_BLOCKED", retryable: false });
    expect(requester).toHaveBeenCalledTimes(1);
  });

  it("does not allow a public request to redirect into the localhost alias", async () => {
    const resolver = vi.fn(async (hostname: string) => [{
      address: hostname === "stream.example" ? "93.184.216.34" : "172.17.0.1",
      family: 4 as const,
    }]);
    const requester = vi.fn<PinnedRequester>()
      .mockResolvedValueOnce(response(302, "", { location: "http://localhost:8080/private.m3u8" }));
    const client = new SafeHttpClient({
      resolver,
      requester,
      allowedPrivateHostnameAliases: { localhost: "host.docker.internal" },
    });

    await expect(client.getText("https://stream.example/master.m3u8"))
      .rejects.toMatchObject({ code: "STREAM_DESTINATION_BLOCKED", retryable: false });
    expect(requester).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenLastCalledWith("localhost");
  });

  it("revalidates redirects and pins each request to its validated address", async () => {
    const resolver = vi.fn(async (hostname: string) => [{
      address: hostname === "first.example" ? "93.184.216.34" : "1.1.1.1",
      family: 4 as const,
    }]);
    const requester = vi.fn<PinnedRequester>()
      .mockResolvedValueOnce(response(302, "", { location: "https://second.example/live.m3u8" }))
      .mockResolvedValueOnce(response(200, "#EXTM3U", { "content-type": "application/vnd.apple.mpegurl" }));
    const client = new SafeHttpClient({ resolver, requester });

    const result = await client.getText("https://first.example/master.m3u8");

    expect(resolver).toHaveBeenCalledTimes(2);
    expect(requester.mock.calls.map((call) => call[1].address)).toEqual(["93.184.216.34", "1.1.1.1"]);
    expect(result.finalUrl).toBe("https://second.example/live.m3u8");
    expect(result.text).toBe("#EXTM3U");
  });

  it("captures HTTP facts across redirects and from final response headers", async () => {
    const resolver = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);
    const requester = vi.fn<PinnedRequester>()
      .mockResolvedValueOnce(response(302, "", { location: "https://cdn.example/live.m3u8" }))
      .mockResolvedValueOnce(response(200, "#EXTM3U", {
        "content-type": "application/vnd.apple.mpegurl",
        server: "nginx",
        "cache-control": "no-store",
        etag: "\"abc\"",
        via: "1.1 varnish",
      }));
    const client = new SafeHttpClient({ resolver, requester });

    const result = await client.getText("https://stream.example/master.m3u8");

    expect(result.http.redirectCount).toBe(1);
    expect(result.http.redirectChain).toEqual(["https://cdn.example/live.m3u8"]);
    expect(result.http.server).toBe("nginx");
    expect(result.http.cacheControl).toBe("no-store");
    expect(result.http.etag).toBe("\"abc\"");
    expect(result.http.via).toBe("1.1 varnish");
    expect(result.http.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.http.firstByteMs).toBeGreaterThanOrEqual(0);
  });

  it("stops reading when the response exceeds the byte limit", async () => {
    const client = new SafeHttpClient({
      resolver: async () => [{ address: "93.184.216.34", family: 4 }],
      requester: async () => response(200, "123456789"),
      maxBytes: 8,
    });

    await expect(client.getText("https://stream.example/master.m3u8"))
      .rejects.toMatchObject({ code: "STREAM_RESPONSE_TOO_LARGE", retryable: false });
  });

  it("applies the total timeout while waiting for response bytes", async () => {
    const requester: PinnedRequester = async () => Object.assign(new Readable({ read() {} }), {
      statusCode: 200,
      headers: {},
    }) as http.IncomingMessage;
    const client = new SafeHttpClient({
      resolver: async () => [{ address: "93.184.216.34", family: 4 }],
      requester,
      timeoutMs: 10,
    });

    await expect(client.getText("https://stream.example/master.m3u8"))
      .rejects.toMatchObject({ code: "STREAM_REQUEST_TIMEOUT", retryable: true });
  });

  it("rejects credentials embedded in a stream URL", async () => {
    const client = new SafeHttpClient();
    await expect(client.getText("https://user:secret@stream.example/master.m3u8"))
      .rejects.toMatchObject({ code: "INVALID_STREAM_URL" });
  });
});

function response(
  statusCode: number,
  body: string,
  headers: http.IncomingHttpHeaders = {},
): http.IncomingMessage {
  return Object.assign(Readable.from([Buffer.from(body)]), { statusCode, headers }) as http.IncomingMessage;
}
