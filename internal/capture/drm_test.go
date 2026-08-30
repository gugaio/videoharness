package capture

import (
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"streammock/internal/config"
	"streammock/internal/db"
	"streammock/internal/models"
	mediapackager "streammock/internal/packager"
	"streammock/internal/store"
)

type fakePackager func(context.Context, mediapackager.Request) error

func (f fakePackager) Run(ctx context.Context, request mediapackager.Request) error {
	return f(ctx, request)
}

func TestMaterializeClearKeyPackagesAndInventoriesClone(t *testing.T) {
	database, err := db.Open(filepath.Join(t.TempDir(), "drm.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := database.Migrate(); err != nil {
		t.Fatal(err)
	}
	streams := store.New(database)
	now := time.Now().UTC()
	stream := models.Stream{ID: "drm", OriginalURL: "https://origin.example/master.m3u8", ProxyPath: "/s/drm/master.m3u8", ActivePreset: "clean", Mode: models.ModeClone, CaptureStatus: models.CaptureCapturing, RequestedDurationSeconds: 12, Format: models.FormatHLS, ProtectionMode: models.ProtectionClearKey, TrackSelection: models.TracksAll, CreatedAt: now, UpdatedAt: now}
	if err := streams.Add(stream, true); err != nil {
		t.Fatal(err)
	}
	if err := streams.AddDRMKey(models.DRMKey{StreamID: stream.ID, KIDHex: "102b08cb433d5563ad2b501e05572e50", KeyHex: "3ed2014066b1421558239f723700021b", Label: "STREAMMOCK"}); err != nil {
		t.Fatal(err)
	}
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
		responses["https://origin.example/"+name+"0.ts"] = name + "-zero"
		responses["https://origin.example/"+name+"1.ts"] = name + "-one"
	}
	responses["https://origin.example/sub.m3u8"] = media("sub", "vtt")
	responses["https://origin.example/sub0.vtt"] = "WEBVTT\n\n00:00.000 --> 00:01.000\nOi"
	responses["https://origin.example/sub1.vtt"] = "WEBVTT\n\n00:06.000 --> 00:07.000\nOlá"
	manager := NewManager(config.Config{CloneMaxBytes: 1 << 20, HTTPTimeout: time.Second}, streams)
	manager.source = &sourceClient{client: &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		body := responses[request.URL.String()]
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header), Request: request}, nil
	})}}
	manager.packager = fakePackager(func(_ context.Context, request mediapackager.Request) error {
		if len(request.Tracks) != 4 || request.KIDHex == "" || request.KeyHex == "" {
			t.Fatalf("unexpected package request: %+v", request)
		}
		if err := os.WriteFile(filepath.Join(request.WorkDir, request.MasterPlaylist), []byte("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nvariants/video-0/index.m3u8\n"), 0o644); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(request.WorkDir, request.MPDOutput), []byte("<MPD><Period></Period></MPD>"), 0o644); err != nil {
			return err
		}
		for _, track := range request.Tracks {
			for _, path := range []string{track.InitSegment, strings.ReplaceAll(track.SegmentTemplate, "$Number$", "1"), track.PlaylistName} {
				full := filepath.Join(request.WorkDir, filepath.FromSlash(path))
				if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
					return err
				}
				if err := os.WriteFile(full, []byte("packaged"), 0o644); err != nil {
					return err
				}
			}
		}
		return nil
	})
	workspace := t.TempDir()
	result, err := manager.materialize(context.Background(), stream, workspace)
	if err != nil {
		t.Fatal(err)
	}
	if result.videoTracks != 2 || result.audioTracks != 2 || result.subtitleTracks != 1 || result.duration != 12 || len(result.resources) < 15 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if _, err := os.Stat(filepath.Join(workspace, ".inputs")); !os.IsNotExist(err) {
		t.Fatal("clear packaging inputs were not removed")
	}
	for _, resource := range result.resources {
		if strings.Contains(resource.LogicalPath, ".inputs") {
			t.Fatalf("temporary input leaked into inventory: %+v", resource)
		}
	}
	mpd, err := os.ReadFile(filepath.Join(workspace, "manifest.mpd"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(mpd), `contentType="text"`) || !strings.Contains(string(mpd), `lang="pt"`) {
		t.Fatalf("subtitle adaptation was not injected into MPD: %s", mpd)
	}
}
