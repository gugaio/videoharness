import { describe, expect, it } from "vitest";
import { parseDashMpd } from "./dash-mpd.js";

const mpd = `<?xml version="1.0"?><MPD type="static" mediaPresentationDuration="PT40S"><BaseURL>https://cdn.example.test/video/</BaseURL><Period start="PT0S" duration="PT40S"><AdaptationSet contentType="video" mimeType="video/mp4" codecs="hvc1.2.4.L153.B0" segmentAlignment="true"><SegmentTemplate timescale="1000" media="$RepresentationID$/chunk-$Time$.m4s" initialization="$RepresentationID$/init.mp4" startNumber="1"><SegmentTimeline><S t="0" d="4000" r="9"/></SegmentTimeline></SegmentTemplate><Representation id="uhd" bandwidth="9000000" width="3840" height="2160"/><Representation id="fhd" bandwidth="3000000" width="1920" height="1080"/></AdaptationSet><AdaptationSet contentType="audio" mimeType="audio/mp4"><SegmentTemplate timescale="48000" media="audio-$Number%03d$.m4s" initialization="audio-init.mp4" duration="192000"/><Representation id="audio" bandwidth="128000"/></AdaptationSet></Period></MPD>`;

describe("parseDashMpd", () => {
  it("expands representation timelines into presentation-time segment references", () => {
    const result = parseDashMpd(mpd, "https://origin.example.test/path/manifest.mpd");
    expect(result.representations).toHaveLength(3);
    const uhd = result.representations.find((entry) => entry.id === "uhd")!;
    expect(uhd.initializationUrl).toBe("https://cdn.example.test/video/uhd/init.mp4");
    expect(uhd.segments).toHaveLength(10);
    expect(uhd.segments[5]).toMatchObject({ number: 6, presentationStartSeconds: 20, presentationEndSeconds: 24, url: "https://cdn.example.test/video/uhd/chunk-20000.m4s" });
    const audio = result.representations.find((entry) => entry.id === "audio")!;
    expect(audio.segments).toHaveLength(10);
    expect(audio.segments[0]!.url).toBe("https://cdn.example.test/video/audio-001.m4s");
  });

  it("resolves inherited DASH attributes into an effective switching contract", () => {
    const document = `<MPD type="static" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" mediaPresentationDuration="PT4S"><Period id="p0" start="PT2S" duration="PT4S"><BaseURL>media/</BaseURL><AdaptationSet id="video" contentType="video" mimeType="video/mp4" codecs="hev1.2.4.L153.B0" maxWidth="3840" maxHeight="2160" maxFrameRate="60000/1001" par="16:9" segmentAlignment="true" subsegmentAlignment="true" startWithSAP="1" subsegmentStartsWithSAP="1" bitstreamSwitching="true"><ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc" cenc:default_KID="abc"><cenc:pssh>AAAA</cenc:pssh></ContentProtection><SegmentTemplate timescale="90000" presentationTimeOffset="180000" initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/$Number$.m4s" duration="360000"/><Representation id="uhd" bandwidth="12000000" width="3840" height="2160" frameRate="60000/1001" sar="1:1"><BaseURL>video/</BaseURL></Representation></AdaptationSet></Period></MPD>`;
    const result = parseDashMpd(document, "https://cdn.example.test/root/manifest.mpd");
    expect(result.periods[0]).toMatchObject({ id: "p0", startSeconds: 2, durationSeconds: 4 });
    expect(result.adaptationSets[0]).toMatchObject({ id: "video", maxWidth: 3840, maxHeight: 2160, maxFrameRate: "60000/1001", par: "16:9", timescale: 90_000, presentationTimeOffset: "180000", startWithSap: 1, bitstreamSwitching: true });
    expect(result.adaptationSets[0]?.switchingContract).toEqual(expect.objectContaining({ mode: "BITSTREAM_SWITCHING", codecFamily: "HEVC", sampleEntryExpectation: "hev1", effectiveTimescale: 90_000, representations: ["uhd"] }));
    expect(result.adaptationSets[0]?.contentProtection[0]).toEqual({ schemeIdUri: "urn:mpeg:dash:mp4protection:2011", value: "cenc", defaultKid: "abc", pssh: ["AAAA"] });
    expect(result.representations[0]).toMatchObject({ baseUrl: "https://cdn.example.test/root/media/video/", initializationUrl: "https://cdn.example.test/root/media/video/uhd/init.mp4", mediaTemplate: "$RepresentationID$/$Number$.m4s", sar: "1:1", segmentAddressing: "template", presentationTimeOffset: 180000n });
  });
});
