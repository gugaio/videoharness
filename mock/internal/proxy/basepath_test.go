package proxy

import (
	"net/url"
	"strings"
	"testing"

	"streammock/internal/basepath"
)

func TestEmittedPathsHonorBasePath(t *testing.T) {
	basepath.Set("/mock")
	defer basepath.Set("")

	e := &Engine{}
	origin := &url.URL{Scheme: "https", Host: "origin.example", Path: "/live/"}

	if got := e.proxiedURL("abc", origin, "seg.ts"); !strings.HasPrefix(got, "/mock/s/abc/r/") {
		t.Fatalf("proxiedURL = %q, want /mock/s/abc/r/...", got)
	}
	if got := e.dashProxyBase("abc", &url.URL{Scheme: "https", Host: "origin.example"}); !strings.HasPrefix(got, "/mock/s/abc/d/") {
		t.Fatalf("dashProxyBase = %q, want /mock/s/abc/d/...", got)
	}
}
