package capture

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"streammock/internal/config"
	"streammock/internal/models"
)

func TestParseMasterAndSelectVODWindow(t *testing.T) {
	base, _ := url.Parse("https://origin.example/master.m3u8")
	master, err := parsePlaylist(`#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=YES,URI="audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,AUDIO="audio"
low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1800000,AUDIO="audio"
high.m3u8`, base)
	if err != nil {
		t.Fatal(err)
	}
	if !master.master || len(master.variants) != 2 {
		t.Fatalf("unexpected master: %#v", master)
	}
	if got := chooseAudio(master.audio, "audio"); got == nil || got.url != "https://origin.example/audio.m3u8" {
		t.Fatalf("unexpected audio: %#v", got)
	}

	mediaBase, _ := url.Parse("https://origin.example/high.m3u8")
	media, err := parsePlaylist(`#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:42
#EXTINF:6,
one.ts
#EXTINF:6,
two.ts
#EXTINF:6,
three.ts
#EXT-X-ENDLIST`, mediaBase)
	if err != nil {
		t.Fatal(err)
	}
	segments, duration, err := selectSegments(media, 12)
	if err != nil {
		t.Fatal(err)
	}
	if len(segments) != 2 || segments[0].sequence != 42 || duration != 12 {
		t.Fatalf("unexpected selection: %#v, %v", segments, duration)
	}
	playlist := buildMediaPlaylist(media, segments)
	if want := "#EXT-X-MEDIA-SEQUENCE:42"; !contains(playlist, want) {
		t.Fatalf("playlist misses %q: %s", want, playlist)
	}
}

func TestParseRejectsUnsupportedHLS(t *testing.T) {
	base, _ := url.Parse("https://origin.example/media.m3u8")
	_, err := parsePlaylist(`#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key"
#EXTINF:6,
one.ts
#EXT-X-ENDLIST`, base)
	if err == nil {
		t.Fatal("expected encrypted playlist rejection")
	}
}

func TestSelectLiveSegmentsUsesLatestCompleteContinuityWindow(t *testing.T) {
	base, _ := url.Parse("https://origin.example/live.m3u8")
	media, err := parsePlaylist(`#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:100
#EXTINF:6,
100.ts
#EXTINF:6,
101.ts
#EXT-X-DISCONTINUITY
#EXTINF:6,
102.ts
#EXTINF:6,
103.ts
`, base)
	if err != nil {
		t.Fatal(err)
	}
	segments, duration, err := selectSegments(media, 24)
	if err != nil {
		t.Fatal(err)
	}
	if media.hasEndList || duration != 12 || len(segments) != 2 || segments[0].sequence != 102 || !segments[0].discontinuity {
		t.Fatalf("unexpected live selection: duration=%v segments=%+v", duration, segments)
	}
	local := buildMediaPlaylist(media, segments)
	if !strings.Contains(local, "#EXT-X-MEDIA-SEQUENCE:102") || !strings.Contains(local, "#EXT-X-ENDLIST") || !strings.Contains(local, "#EXT-X-DISCONTINUITY") {
		t.Fatalf("live snapshot was not normalized to VOD:\n%s", local)
	}
}

func TestParseLLHLSKeepsOnlyCompleteSegmentsAndAppliesSkip(t *testing.T) {
	base, _ := url.Parse("https://origin.example/live.m3u8")
	media, err := parsePlaylist(`#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-PART-INF:PART-TARGET=1
#EXT-X-MEDIA-SEQUENCE:200
#EXT-X-SKIP:SKIPPED-SEGMENTS=3
#EXT-X-PROGRAM-DATE-TIME:2026-08-30T20:00:00.000Z
#EXTINF:4,
203.m4s
#EXT-X-PART:DURATION=1,URI="204.0.m4s"
#EXT-X-RENDITION-REPORT:URI="other.m3u8",LAST-MSN=204,LAST-PART=0
#EXT-X-PRELOAD-HINT:TYPE=PART,URI="204.1.m4s"
`, base)
	if err != nil {
		t.Fatal(err)
	}
	if len(media.segments) != 1 || media.segments[0].sequence != 203 || media.segments[0].programTime == nil {
		t.Fatalf("unexpected LL-HLS normalization: %+v", media)
	}
}

func TestParseAndBuildFMP4Playlist(t *testing.T) {
	base, _ := url.Parse("https://origin.example/media.m3u8")
	media, err := parsePlaylist("#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MAP:URI=init.mp4\n#EXTINF:4,\n1.m4s\n#EXT-X-ENDLIST\n", base)
	if err != nil {
		t.Fatal(err)
	}
	if media.initURL != "https://origin.example/init.mp4" {
		t.Fatalf("init URL=%q", media.initURL)
	}
	segments, _, err := selectSegments(media, 4)
	if err != nil {
		t.Fatal(err)
	}
	local := buildMediaPlaylistForKind(media, segments, "video")
	if !strings.Contains(local, `#EXT-X-MAP:URI="init.mp4"`) || !strings.Contains(local, "segments/0.m4s") {
		t.Fatalf("unexpected fMP4 playlist:\n%s", local)
	}
}

func TestMaterializeFMP4ByteRangesAsStandaloneFiles(t *testing.T) {
	manifest := `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-MAP:URI="media.mp4",BYTERANGE="4@0"
#EXTINF:4,
#EXT-X-BYTERANGE:4@4
media.mp4
#EXTINF:4,
#EXT-X-BYTERANGE:4
media.mp4
#EXT-X-ENDLIST
`
	manager := NewManager(config.Config{CloneMaxBytes: 1 << 20, HTTPTimeout: time.Second}, nil)
	manager.source = &sourceClient{client: &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.String() == "https://origin.example/media.m3u8" {
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(manifest)), Header: make(http.Header), Request: request}, nil
		}
		parts := map[string]string{"bytes=0-3": "init", "bytes=4-7": "seg0", "bytes=8-11": "seg1"}
		body, ok := parts[request.Header.Get("Range")]
		if request.URL.String() != "https://origin.example/media.mp4" || !ok {
			return &http.Response{StatusCode: http.StatusNotFound, Body: io.NopCloser(strings.NewReader("missing")), Header: make(http.Header), Request: request}, nil
		}
		return &http.Response{StatusCode: http.StatusPartialContent, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header), Request: request}, nil
	})}}
	workspace := t.TempDir()
	result, err := manager.materialize(context.Background(), models.Stream{ID: "fmp4", OriginalURL: "https://origin.example/media.m3u8", RequestedDurationSeconds: 8}, workspace)
	if err != nil {
		t.Fatal(err)
	}
	if result.videoTracks != 1 || result.duration != 8 {
		t.Fatalf("unexpected result: %+v", result)
	}
	for path, want := range map[string]string{
		"variants/video-0/init.mp4":       "init",
		"variants/video-0/segments/0.m4s": "seg0",
		"variants/video-0/segments/1.m4s": "seg1",
	} {
		body, err := os.ReadFile(filepath.Join(workspace, filepath.FromSlash(path)))
		if err != nil {
			t.Fatal(err)
		}
		if string(body) != want {
			t.Fatalf("%s = %q, want %q", path, body, want)
		}
	}
}

func TestMaterializeBuildsSelfContainedLocalPlaylists(t *testing.T) {
	responses := map[string]string{
		"https://origin.example/master.m3u8": "#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=audio,NAME=English,DEFAULT=YES,URI=audio.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=800000,AUDIO=audio\nvideo.m3u8\n",
		"https://origin.example/video.m3u8":  "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nv0.ts\n#EXTINF:6,\nv1.ts\n#EXTINF:6,\nv2.ts\n#EXT-X-ENDLIST\n",
		"https://origin.example/audio.m3u8":  "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\na0.ts\n#EXTINF:6,\na1.ts\n#EXTINF:6,\na2.ts\n#EXT-X-ENDLIST\n",
		"https://origin.example/v0.ts":       "video-0", "https://origin.example/v1.ts": "video-1", "https://origin.example/a0.ts": "audio-0", "https://origin.example/a1.ts": "audio-1",
	}
	manager := NewManager(config.Config{CloneMaxBytes: 1 << 20, HTTPTimeout: time.Second}, nil)
	manager.source = &sourceClient{client: &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		body, ok := responses[request.URL.String()]
		if !ok {
			return &http.Response{StatusCode: http.StatusNotFound, Body: io.NopCloser(strings.NewReader("missing")), Request: request}, nil
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header), Request: request}, nil
	})}}
	workspace := t.TempDir()
	result, err := manager.materialize(context.Background(), models.Stream{ID: "clone", OriginalURL: "https://origin.example/master.m3u8", RequestedDurationSeconds: 12}, workspace)
	if err != nil {
		t.Fatal(err)
	}
	if result.duration != 12 || len(result.resources) != 7 {
		t.Fatalf("unexpected result: %#v", result)
	}
	master, err := os.ReadFile(filepath.Join(workspace, "master.m3u8"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(master), "origin.example") || !strings.Contains(string(master), "variants/video-0/index.m3u8") {
		t.Fatalf("master is not local: %s", master)
	}
	if _, err := os.Stat(filepath.Join(workspace, "audio", "audio-0", "segments", "0.ts")); err != nil {
		t.Fatal(err)
	}
}

func TestMaterializeLiveSnapshotUsesLatestRenditionWindow(t *testing.T) {
	responses := map[string]string{
		"https://origin.example/master.m3u8": "#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=audio,NAME=English,DEFAULT=YES,URI=audio.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=800000,AUDIO=audio\nvideo.m3u8\n",
		"https://origin.example/video.m3u8":  "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:42\n#EXTINF:6,\nv42.ts\n#EXTINF:6,\nv43.ts\n#EXTINF:6,\nv44.ts\n",
		"https://origin.example/audio.m3u8":  "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:42\n#EXTINF:6,\na42.ts\n#EXTINF:6,\na43.ts\n#EXTINF:6,\na44.ts\n",
		"https://origin.example/v43.ts":      "video-43",
		"https://origin.example/v44.ts":      "video-44",
		"https://origin.example/a43.ts":      "audio-43",
		"https://origin.example/a44.ts":      "audio-44",
	}
	manager := NewManager(config.Config{CloneMaxBytes: 1 << 20, HTTPTimeout: time.Second}, nil)
	manager.source = &sourceClient{client: &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		body, ok := responses[request.URL.String()]
		if !ok {
			return &http.Response{StatusCode: http.StatusNotFound, Body: io.NopCloser(strings.NewReader("missing")), Request: request}, nil
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header), Request: request}, nil
	})}}
	workspace := t.TempDir()
	result, err := manager.materialize(context.Background(), models.Stream{ID: "live", OriginalURL: "https://origin.example/master.m3u8", RequestedDurationSeconds: 12, TrackSelection: models.TracksAll}, workspace)
	if err != nil {
		t.Fatal(err)
	}
	if !result.sourceLive || result.duration != 12 || result.videoTracks != 1 || result.audioTracks != 1 {
		t.Fatalf("unexpected live result: %+v", result)
	}
	playlist, err := os.ReadFile(filepath.Join(workspace, "variants", "video-0", "index.m3u8"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(playlist), "#EXT-X-MEDIA-SEQUENCE:43") || strings.Contains(string(playlist), "42.ts") || !strings.Contains(string(playlist), "#EXT-X-ENDLIST") {
		t.Fatalf("unexpected local live snapshot:\n%s", playlist)
	}
}

func TestMaterializePreservesAllVariantsAudioAndSubtitles(t *testing.T) {
	responses := map[string]string{
		"https://origin.example/master.m3u8": `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Portuguese",LANGUAGE="pt",DEFAULT=YES,URI="pt.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="en",URI="en.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Portuguese",LANGUAGE="pt",URI="sub.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,AUDIO="audio",SUBTITLES="subs"
low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1800000,AUDIO="audio",SUBTITLES="subs"
high.m3u8
`,
	}
	media := func(prefix, extension string) string {
		return "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\n" + prefix + "0." + extension + "\n#EXTINF:6,\n" + prefix + "1." + extension + "\n#EXT-X-ENDLIST\n"
	}
	for _, name := range []string{"low", "high", "pt", "en"} {
		responses["https://origin.example/"+name+".m3u8"] = media(name, "ts")
		responses["https://origin.example/"+name+"0.ts"] = name + "-0"
		responses["https://origin.example/"+name+"1.ts"] = name + "-1"
	}
	responses["https://origin.example/sub.m3u8"] = media("sub", "vtt")
	responses["https://origin.example/sub0.vtt"] = "WEBVTT\n\n00:00.000 --> 00:01.000\nOi"
	responses["https://origin.example/sub1.vtt"] = "WEBVTT\n\n00:06.000 --> 00:07.000\nOlá"
	manager := NewManager(config.Config{CloneMaxBytes: 1 << 20, HTTPTimeout: time.Second}, nil)
	manager.source = &sourceClient{client: &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		body, ok := responses[request.URL.String()]
		if !ok {
			return &http.Response{StatusCode: http.StatusNotFound, Body: io.NopCloser(strings.NewReader("missing")), Request: request}, nil
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header), Request: request}, nil
	})}}
	workspace := t.TempDir()
	result, err := manager.materialize(context.Background(), models.Stream{ID: "all", OriginalURL: "https://origin.example/master.m3u8", RequestedDurationSeconds: 12, ProtectionMode: models.ProtectionClear, TrackSelection: models.TracksAll}, workspace)
	if err != nil {
		t.Fatal(err)
	}
	if result.videoTracks != 2 || result.audioTracks != 2 || result.subtitleTracks != 1 {
		t.Fatalf("unexpected track counts: %+v", result)
	}
	master, err := os.ReadFile(filepath.Join(workspace, "master.m3u8"))
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"variants/video-0/index.m3u8", "variants/video-1/index.m3u8", `LANGUAGE="pt"`, `LANGUAGE="en"`, `SUBTITLES="subtitles"`} {
		if !strings.Contains(string(master), expected) {
			t.Fatalf("master misses %q:\n%s", expected, master)
		}
	}
	if _, err := os.Stat(filepath.Join(workspace, "subtitles", "subtitle-0", "segments", "0.vtt")); err != nil {
		t.Fatal(err)
	}
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) { return f(request) }

func contains(value, needle string) bool {
	for i := 0; i+len(needle) <= len(value); i++ {
		if value[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
