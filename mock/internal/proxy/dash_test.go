package proxy

import (
	"encoding/base64"
	"net/url"
	"strings"
	"testing"
)

func TestTransformDASHManifestRewritesBaseURLAndPreservesTemplateTokens(t *testing.T) {
	source, err := url.Parse("https://origin.example/live/manifest.mpd")
	if err != nil {
		t.Fatal(err)
	}
	body := []byte(`<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><AdaptationSet><Representation id="v"><SegmentTemplate media="chunk-$Number%05d$.m4s" initialization="init.mp4"/></Representation></AdaptationSet></Period></MPD>`)
	got, err := (&Engine{}).transformDASHManifest(body, source, "dash-test")
	if err != nil {
		t.Fatal(err)
	}
	encoded := base64.RawURLEncoding.EncodeToString([]byte("https://origin.example/live/"))
	text := string(got)
	if !strings.Contains(text, "/s/dash-test/d/"+encoded+"/") {
		t.Fatalf("root BaseURL was not proxied: %s", text)
	}
	if !strings.Contains(text, "chunk-$Number%05d$.m4s") {
		t.Fatalf("DASH template token changed: %s", text)
	}
}

func TestTransformDASHManifestRejectsDoctype(t *testing.T) {
	source, _ := url.Parse("https://origin.example/manifest.mpd")
	if _, err := (&Engine{}).transformDASHManifest([]byte("<!DOCTYPE MPD><MPD/>"), source, "dash-test"); err == nil {
		t.Fatal("expected DOCTYPE rejection")
	}
}
