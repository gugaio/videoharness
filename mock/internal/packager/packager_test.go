package packager

import (
	"strings"
	"testing"
)

func TestTrackDescriptor(t *testing.T) {
	descriptor, err := trackDescriptor(Track{Input: "input.ts", Stream: "audio", InitSegment: "audio/init.mp4", SegmentTemplate: "audio/$Number$.m4s", PlaylistName: "audio/index.m3u8", HLSGroupID: "audio", HLSName: "Portuguese, Brazil", Language: "pt"}, "STREAMMOCK")
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"stream=audio", "drm_label=STREAMMOCK", "hls_group_id=audio", "hls_name=Portuguese_ Brazil"} {
		if !strings.Contains(descriptor, expected) {
			t.Fatalf("descriptor %q misses %q", descriptor, expected)
		}
	}
}
