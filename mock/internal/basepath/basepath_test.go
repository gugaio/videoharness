package basepath

import "testing"

func TestNormalize(t *testing.T) {
	cases := map[string]string{
		"":         "",
		"   ":      "",
		"/":        "",
		"mock":     "/mock",
		"/mock":    "/mock",
		"/mock/":   "/mock",
		" /mock/ ": "/mock",
	}
	for input, want := range cases {
		Set(input)
		if want == "" {
			if got := Path("/s/x"); got != "/s/x" {
				t.Fatalf("Set(%q): Path = %q, want /s/x", input, got)
			}
			continue
		}
		if got := Path("/s/x"); got != want+"/s/x" {
			t.Fatalf("Set(%q): Path = %q, want %q", input, got, want+"/s/x")
		}
	}
}

func TestPathWithoutBase(t *testing.T) {
	Set("")
	if got := Path("/i/tok/events"); got != "/i/tok/events" {
		t.Fatalf("Path = %q, want unchanged", got)
	}
}

func TestPathAddsLeadingSlash(t *testing.T) {
	Set("/mock")
	if got := Path("s/x"); got != "/mock/s/x" {
		t.Fatalf("Path = %q, want /mock/s/x", got)
	}
}
