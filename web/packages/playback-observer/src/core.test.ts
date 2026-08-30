// @vitest-environment jsdom
import Hls from "hls.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observePlayback } from "./core";
import { hlsJsAdapter } from "./hls/hlsjs";
import { shakaAdapter } from "./shaka/shaka";
import type { ObserverEvent } from "./types";

function mediaFixture() {
	const media = document.createElement("video");
	let paused = false;
	let seeking = false;
	let currentTime = 1;
	let frameCallback: (() => void) | null = null;
	Object.defineProperties(media, {
		paused: { configurable: true, get: () => paused },
		seeking: { configurable: true, get: () => seeking },
		currentTime: { configurable: true, get: () => currentTime, set: (value: number) => { currentTime = value; } },
		buffered: { configurable: true, get: () => ({ length: 1, start: () => 0, end: () => 1.2 }) },
		requestVideoFrameCallback: { configurable: true, value: (callback: () => void) => { frameCallback = callback; return 1; } },
	});
	return { media, setPaused: (value: boolean) => { paused = value; }, setSeeking: (value: boolean) => { seeking = value; }, fireFrame: () => frameCallback?.() };
}

function sentEvents(fetchMock: ReturnType<typeof vi.fn>): ObserverEvent[] {
	return fetchMock.mock.calls.flatMap((call) => {
		const init = call[1] as RequestInit;
		return (JSON.parse(String(init.body)) as { events: ObserverEvent[] }).events;
	});
}

describe("playback observer core", () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	beforeEach(() => {
		vi.useFakeTimers();
		fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 202 }));
		vi.stubGlobal("fetch", fetchMock);
		Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: vi.fn(() => false) });
	});
	afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

	it("records play request and a precise first frame", async () => {
		const fixture = mediaFixture();
		const observer = observePlayback({ media: fixture.media, sessionId: "sid-a", ingestUrl: "/i/token/events" });
		observer.playRequested(); fixture.fireFrame(); fixture.media.dispatchEvent(new Event("playing"));
		await vi.advanceTimersByTimeAsync(1600);
		const events = sentEvents(fetchMock);
		expect(events.map((event) => event.event_type)).toEqual(expect.arrayContaining(["session_started", "play_requested", "first_frame", "playing"]));
		const firstFrame = events.find((event) => event.event_type === "first_frame");
		expect(firstFrame?.payload_json).toContain("requestVideoFrameCallback");
		observer.destroy();
	});

	it("does not report waiting during pause or seek as rebuffer", async () => {
		const fixture = mediaFixture();
		const observer = observePlayback({ media: fixture.media, sessionId: "sid-b", ingestUrl: "/i/token/events" });
		observer.playRequested(); fixture.fireFrame();
		fixture.setPaused(true); fixture.media.dispatchEvent(new Event("pause")); fixture.media.dispatchEvent(new Event("waiting"));
		await vi.advanceTimersByTimeAsync(300);
		fixture.setPaused(false); fixture.setSeeking(true); fixture.media.dispatchEvent(new Event("seeking")); fixture.media.dispatchEvent(new Event("waiting"));
		await vi.advanceTimersByTimeAsync(1600);
		expect(sentEvents(fetchMock).some((event) => event.event_type === "buffering_started")).toBe(false);
		observer.destroy();
	});
});

describe("HLS.js adapter", () => {
	it("normalizes fatal, non-fatal, stall and append errors and removes listeners", () => {
		const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
		const fake = {
			on: (event: string, listener: (...args: unknown[]) => void) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
			off: (event: string, listener: (...args: unknown[]) => void) => listeners.set(event, (listeners.get(event) ?? []).filter((item) => item !== listener)),
		} as unknown as Hls;
		const emitted: string[] = [];
		const detach = hlsJsAdapter(fake).attach((type) => emitted.push(type));
		for (const data of [{ details: "bufferStalledError", fatal: false }, { details: "bufferAppendError", fatal: true }]) {
			for (const listener of listeners.get(Hls.Events.ERROR) ?? []) listener(Hls.Events.ERROR, data);
		}
		expect(emitted.filter((type) => type === "hls_error")).toHaveLength(2);
		expect(emitted).toEqual(expect.arrayContaining(["stall_detected", "buffer_append_error"]));
		detach();
		expect(listeners.get(Hls.Events.ERROR)).toHaveLength(0);
	});
});

describe("Shaka adapter", () => {
	it("normalizes download, adaptation, buffering and error events", () => {
		const player = new EventTarget() as EventTarget & { getStats: () => Record<string, unknown> };
		player.getStats = () => ({ estimatedBandwidth: 1_000_000 });
		const emitted: string[] = [];
		const detach = shakaAdapter(player).attach((type) => emitted.push(type));
		player.dispatchEvent(new Event("downloadcompleted"));
		player.dispatchEvent(new Event("adaptation"));
		player.dispatchEvent(new Event("buffering"));
		player.dispatchEvent(new Event("error"));
		expect(emitted).toEqual(expect.arrayContaining(["segment_downloaded", "adaptation", "stall_detected", "shaka_error"]));
		detach();
		player.dispatchEvent(new Event("error"));
		expect(emitted.filter((type) => type === "shaka_error")).toHaveLength(1);
	});
});
