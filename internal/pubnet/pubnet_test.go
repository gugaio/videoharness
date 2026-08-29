package pubnet

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestValidateURLStructuralRules(t *testing.T) {
	cases := []struct {
		raw     string
		wantErr bool
	}{
		{"https://example.com/live/master.m3u8", false},
		{"http://8.8.8.8/stream.m3u8", false},
		{"ftp://example.com/live.m3u8", true},
		{"https://user:pass@example.com/live.m3u8", true},
		{"", true},
		{"/relative/path.m3u8", true},
	}
	for _, tc := range cases {
		err := ValidateURL(tc.raw)
		if gotErr := err != nil; gotErr != tc.wantErr {
			t.Errorf("ValidateURL(%q) err=%v, wantErr %v", tc.raw, err, tc.wantErr)
		}
	}
}

func TestValidateURLRejectsPrivateTargetsByDefault(t *testing.T) {
	private := []string{
		"http://127.0.0.1/master.m3u8",
		"https://10.1.2.3/live.m3u8",
		"https://192.168.0.10/live.m3u8",
		"http://172.16.5.5/live.m3u8",
		"http://169.254.169.254/latest/meta-data/",
		"http://[::1]/master.m3u8",
		"http://0.0.0.0/x",
	}
	for _, raw := range private {
		parsed, err := url.Parse(raw)
		if err != nil {
			t.Fatal(err)
		}
		if net.ParseIP(parsed.Hostname()) == nil {
			continue // hostname-based targets are checked at dial time, not validation time
		}
		if err := ValidateURL(raw); err == nil {
			t.Errorf("ValidateURL(%q) = nil, want private-address error", raw)
		}
	}
	if err := ValidateURL("https://203.0.113.7/public.m3u8"); err != nil {
		t.Errorf("public IP rejected: %v", err)
	}
}

func TestValidateURLAllowsPrivateWhenOptedOut(t *testing.T) {
	t.Setenv("STREAMMOCK_ALLOW_PRIVATE_TARGETS", "true")
	if !AllowPrivateTargets() {
		t.Fatal("expected opt-out to be honored")
	}
	if err := ValidateURL("http://127.0.0.1:8080/live.m3u8"); err != nil {
		t.Fatalf("expected private target allowed under opt-out, got %v", err)
	}
}

func TestClientBlocksLoopbackAndAllowsLocalUnderOptOut(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "#EXTM3U\n")
	}))
	defer upstream.Close()

	blocked := NewHTTPClient(0)
	resp, err := blocked.Get(upstream.URL)
	if err == nil {
		resp.Body.Close()
		t.Fatal("request to loopback should fail without opt-out")
	} else if resp != nil {
		resp.Body.Close()
	}

	t.Setenv("STREAMMOCK_ALLOW_PRIVATE_TARGETS", "1")
	allowed := NewHTTPClient(0)
	resp, err = allowed.Get(upstream.URL)
	if err != nil {
		t.Fatalf("request to loopback should succeed under opt-out: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "#EXTM3U") {
		t.Fatalf("unexpected body %q", string(body))
	}
}
