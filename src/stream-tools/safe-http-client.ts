import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { StreamCollectionError } from "./errors.js";

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type DnsResolver = (hostname: string) => Promise<ResolvedAddress[]>;
export type PinnedRequester = (
  url: URL,
  target: ResolvedAddress,
  signal: AbortSignal,
) => Promise<http.IncomingMessage>;

export type SafeTextResponse = {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  contentType?: string;
  bytes: Uint8Array;
  text: string;
};

export type SafeBinaryResponse = Omit<SafeTextResponse, "text">;

export class SafeHttpClient {
  private readonly resolver: DnsResolver;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxRedirects: number;
  private readonly requester: PinnedRequester;

  constructor(options: {
    resolver?: DnsResolver;
    timeoutMs?: number;
    maxBytes?: number;
    maxRedirects?: number;
    requester?: PinnedRequester;
  } = {}) {
    this.resolver = options.resolver ?? resolveAddresses;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxBytes = options.maxBytes ?? 1_048_576;
    this.maxRedirects = options.maxRedirects ?? 3;
    this.requester = options.requester ?? requestPinned;
  }

  async getText(value: string): Promise<SafeTextResponse> {
    const response = await this.getBytes(value);
    return { ...response, text: new TextDecoder("utf-8", { fatal: false }).decode(response.bytes) };
  }

  async getBytes(value: string): Promise<SafeBinaryResponse> {
    const requestedUrl = parseStreamUrl(value).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.request(requestedUrl, requestedUrl, 0, controller.signal);
    } catch (error) {
      if (error instanceof StreamCollectionError) throw error;
      if (controller.signal.aborted) {
        throw new StreamCollectionError("STREAM_REQUEST_TIMEOUT", "The stream request timed out", true, {
          cause: error,
        });
      }
      throw new StreamCollectionError("STREAM_HTTP_ERROR", "The stream request failed", true, { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async request(
    requestedUrl: string,
    currentValue: string,
    redirectCount: number,
    signal: AbortSignal,
  ): Promise<SafeBinaryResponse> {
    const url = parseStreamUrl(currentValue);
    const addresses = await raceWithAbort(this.resolveAndValidate(url.hostname), signal);
    const target = addresses[0]!;
    const response = await this.requester(url, target, signal);
    const statusCode = response.statusCode ?? 0;

    if (isRedirect(statusCode)) {
      const location = response.headers.location;
      response.resume();
      if (!location) {
        throw new StreamCollectionError("STREAM_HTTP_ERROR", "The stream redirect has no destination", false);
      }
      if (redirectCount >= this.maxRedirects) {
        throw new StreamCollectionError("STREAM_TOO_MANY_REDIRECTS", "The stream exceeded the redirect limit", false);
      }
      return this.request(requestedUrl, new URL(location, url).toString(), redirectCount + 1, signal);
    }

    if (statusCode < 200 || statusCode >= 300) {
      response.resume();
      throw new StreamCollectionError(
        "STREAM_HTTP_ERROR",
        `The stream server returned HTTP ${statusCode}`,
        statusCode >= 500 || statusCode === 408 || statusCode === 429,
      );
    }

    const declaredLength = Number(response.headers["content-length"] ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > this.maxBytes) {
      response.destroy();
      throw new StreamCollectionError(
        "STREAM_RESPONSE_TOO_LARGE",
        "The stream response exceeds the allowed response size",
        false,
      );
    }
    const bytes = await readLimited(response, this.maxBytes, signal);
    const contentTypeHeader = response.headers["content-type"];
    const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader;
    return {
      requestedUrl,
      finalUrl: url.toString(),
      statusCode,
      ...(contentType ? { contentType } : {}),
      bytes,
    };
  }

  private async resolveAndValidate(hostname: string): Promise<ResolvedAddress[]> {
    const normalizedHostname = stripIpv6Brackets(hostname);
    let addresses: ResolvedAddress[];
    try {
      const family = isIP(normalizedHostname);
      addresses = family
        ? [{ address: normalizedHostname, family: family as 4 | 6 }]
        : await this.resolver(normalizedHostname);
    } catch (error) {
      throw new StreamCollectionError("STREAM_DNS_FAILED", "The stream hostname could not be resolved", true, {
        cause: error,
      });
    }
    if (addresses.length === 0) {
      throw new StreamCollectionError("STREAM_DNS_FAILED", "The stream hostname returned no addresses", true);
    }
    if (addresses.some((entry) => !isPublicAddress(entry.address))) {
      throw new StreamCollectionError(
        "STREAM_DESTINATION_BLOCKED",
        "The stream destination is not a public network address",
        false,
      );
    }
    return addresses;
  }
}

export function isPublicAddress(value: string): boolean {
  const address = stripIpv6Brackets(value).toLowerCase();
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family !== 6) return false;

  const parts = parseIpv6(address);
  if (!parts) return false;
  if (parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff) {
    return isPublicIpv4(`${parts[6]! >> 8}.${parts[6]! & 255}.${parts[7]! >> 8}.${parts[7]! & 255}`);
  }
  const first = parts[0]!;
  if (first < 0x2000 || first > 0x3fff) return false;
  if (matchesIpv6Prefix(parts, [0x2001, 0x0db8], 32)) return false;
  if (matchesIpv6Prefix(parts, [0x2001, 0x0002, 0], 48)) return false;
  if (matchesIpv6Prefix(parts, [0x2001, 0x0010], 28)) return false;
  if (matchesIpv6Prefix(parts, [0x2001, 0x0020], 28)) return false;
  if (matchesIpv6Prefix(parts, [0x2002], 16)) return false;
  if (matchesIpv6Prefix(parts, [0x3fff, 0], 20)) return false;
  return true;
}

function parseStreamUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new StreamCollectionError("INVALID_STREAM_URL", "The stream URL is invalid", false, { cause: error });
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new StreamCollectionError(
      "INVALID_STREAM_URL",
      "The stream URL must use HTTP(S) and cannot contain credentials",
      false,
    );
  }
  return url;
}

async function resolveAddresses(hostname: string): Promise<ResolvedAddress[]> {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.flatMap((entry): ResolvedAddress[] =>
    entry.family === 4 || entry.family === 6 ? [{ address: entry.address, family: entry.family }] : []);
}

function requestPinned(url: URL, target: ResolvedAddress, signal: AbortSignal): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https.request : http.request)({
      protocol: url.protocol,
      hostname: target.address,
      family: target.family,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: {
        Host: url.host,
        Accept: "application/vnd.apple.mpegurl, application/dash+xml, application/xml, text/plain, */*",
        "Accept-Encoding": "identity",
        "User-Agent": "VideoHarness/0.1 manifest-collector",
      },
      ...(url.protocol === "https:" && isIP(stripIpv6Brackets(url.hostname)) === 0
        ? { servername: url.hostname }
        : {}),
      signal,
    }, resolve);
    request.once("error", reject);
    request.end();
  });
}

function readLimited(
  response: http.IncomingMessage,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = (): void => {
      response.destroy();
      finish(() => reject(new StreamCollectionError(
        "STREAM_REQUEST_TIMEOUT",
        "The stream request timed out",
        true,
      )));
    };
    signal.addEventListener("abort", abort, { once: true });
    response.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        response.destroy();
        finish(() => reject(new StreamCollectionError(
          "STREAM_RESPONSE_TOO_LARGE",
          "The stream response exceeds the allowed response size",
          false,
        )));
        return;
      }
      chunks.push(chunk);
    });
    response.once("end", () => finish(() => resolve(Buffer.concat(chunks, total))));
    response.once("error", (error) => {
      if (signal.aborted) {
        finish(() => reject(new StreamCollectionError("STREAM_REQUEST_TIMEOUT", "The stream request timed out", true, {
          cause: error,
        })));
        return;
      }
      finish(() => reject(error));
    });
  });
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("Request aborted"));
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(new Error("Request aborted"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function isRedirect(statusCode: number): boolean {
  return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
}

function isPublicIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function parseIpv6(value: string): number[] | null {
  const withoutZone = value.split("%")[0]!;
  const ipv4TailMatch = withoutZone.match(/(\d+\.\d+\.\d+\.\d+)$/);
  let normalized = withoutZone;
  if (ipv4TailMatch) {
    const ipv4 = ipv4TailMatch[1]!.split(".").map(Number);
    if (ipv4.length !== 4 || ipv4.some((part) => part < 0 || part > 255)) return null;
    normalized = `${withoutZone.slice(0, -ipv4TailMatch[1]!.length)}${((ipv4[0]! << 8) | ipv4[1]!).toString(16)}:${((ipv4[2]! << 8) | ipv4[3]!).toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const parts = [...left, ...Array(missing).fill("0"), ...right].map((part) => Number.parseInt(part, 16));
  return parts.length === 8 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 0xffff)
    ? parts
    : null;
}

function matchesIpv6Prefix(address: number[], prefix: number[], bits: number): boolean {
  const fullParts = Math.floor(bits / 16);
  const remainingBits = bits % 16;
  for (let index = 0; index < fullParts; index += 1) {
    if (address[index] !== prefix[index]) return false;
  }
  if (remainingBits === 0) return true;
  const mask = (0xffff << (16 - remainingBits)) & 0xffff;
  return ((address[fullParts] ?? 0) & mask) === ((prefix[fullParts] ?? 0) & mask);
}

function stripIpv6Brackets(value: string): string {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}
