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

func TestMaterializeDASHBuildsLocalMPD(t *testing.T) {
	responses := map[string]string{
		"https://origin.example/manifest.mpd":    "<?xml version=\"1.0\"?><MPD type=\"static\" mediaPresentationDuration=\"PT12S\"><Period><AdaptationSet contentType=\"video\" mimeType=\"video/mp4\"><SegmentTemplate timescale=\"1\" duration=\"6\" startNumber=\"1\" initialization=\"v-$RepresentationID$-init.mp4\" media=\"v-$Number%02d$.m4s\"/><Representation id=\"high\" bandwidth=\"1000\"/></AdaptationSet><AdaptationSet contentType=\"audio\" mimeType=\"audio/mp4\"><SegmentTemplate timescale=\"1\" duration=\"6\" initialization=\"a-init.mp4\" media=\"a-$Number$.m4s\"/><Representation id=\"audio\" bandwidth=\"100\"/></AdaptationSet></Period></MPD>",
		"https://origin.example/v-high-init.mp4": "v-init",
		"https://origin.example/v-01.m4s":        "v1", "https://origin.example/v-02.m4s": "v2",
		"https://origin.example/a-init.mp4": "a-init",
		"https://origin.example/a-1.m4s":    "a1", "https://origin.example/a-2.m4s": "a2",
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
	result, err := manager.materialize(context.Background(), models.Stream{ID: "dash", OriginalURL: "https://origin.example/manifest.mpd", Format: models.FormatDASH, RequestedDurationSeconds: 12}, workspace)
	if err != nil {
		t.Fatal(err)
	}
	if result.duration != 12 {
		t.Fatalf("duration = %v", result.duration)
	}
	mpd, err := os.ReadFile(filepath.Join(workspace, "manifest.mpd"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(mpd), "origin.example") || !strings.Contains(string(mpd), "dash/video/segments/000000.m4s") {
		t.Fatalf("MPD is not local: %s", mpd)
	}
	if _, err := os.Stat(filepath.Join(workspace, "dash", "audio", "segments", "000001.m4s")); err != nil {
		t.Fatal(err)
	}
}

func TestDASHCloneRejectsDynamicAndDRM(t *testing.T) {
	for _, manifest := range []string{
		"<MPD type=\"dynamic\"><Period/></MPD>",
		"<MPD type=\"static\" mediaPresentationDuration=\"PT10S\"><ContentProtection/><Period/></MPD>",
	} {
		manager := NewManager(config.Config{CloneMaxBytes: 1 << 20, HTTPTimeout: time.Second}, nil)
		manager.source = &sourceClient{client: &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(manifest)), Header: make(http.Header), Request: request}, nil
		})}}
		if _, err := manager.materializeDASH(context.Background(), models.Stream{OriginalURL: "https://origin.example/manifest.mpd", Format: models.FormatDASH}, t.TempDir()); err == nil {
			t.Fatal("expected unsupported manifest")
		}
	}
}

func TestExpandDASHSegmentList(t *testing.T) {
	base, _ := url.Parse("https://origin.example/video/")
	segments, duration, err := expandDASHSegments(dashTrack{base: base, hasSegmentList: true, segmentList: dashSegmentList{Timescale: 1, Duration: 5, Segments: []dashSegmentURL{{Media: "one.m4s"}, {Media: "two.m4s"}}}}, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(segments) != 2 || duration != 10 || segments[1].url != "https://origin.example/video/two.m4s" {
		t.Fatalf("unexpected segments: %#v, %v", segments, duration)
	}
}
