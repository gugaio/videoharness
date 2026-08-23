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
