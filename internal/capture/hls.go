package capture

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

type playlist struct {
	master         bool
	variants       []variant
	audio          []audioRendition
	segments       []segment
	targetDuration float64
	mediaSequence  int
	hasEndList     bool
}

type variant struct {
	url          string
	bandwidth    int
	resolution   string
	codecs       string
	audioGroupID string
}

type audioRendition struct {
	url        string
	groupID    string
	name       string
	language   string
	defaulted  bool
	autoselect bool
}

type segment struct {
	url           string
	duration      float64
	sequence      int
	discontinuity bool
}

func parsePlaylist(text string, base *url.URL) (playlist, error) {
	var out playlist
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	if len(lines) == 0 || strings.TrimPrefix(strings.TrimSpace(lines[0]), "\ufeff") != "#EXTM3U" {
		return out, unsupported("source is not an HLS playlist")
	}
	var pendingVariant map[string]string
	var pendingDuration *float64
	pendingDiscontinuity := false
	nextSequence := 0
	for _, raw := range lines[1:] {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		switch {
		case strings.HasPrefix(line, "#EXT-X-STREAM-INF:"):
			pendingVariant = parseAttributes(strings.TrimPrefix(line, "#EXT-X-STREAM-INF:"))
			out.master = true
		case strings.HasPrefix(line, "#EXT-X-MEDIA:"):
			attrs := parseAttributes(strings.TrimPrefix(line, "#EXT-X-MEDIA:"))
			if strings.EqualFold(attrs["TYPE"], "AUDIO") && attrs["URI"] != "" {
				resolved, err := resolve(base, attrs["URI"])
				if err != nil {
					return out, err
				}
				out.audio = append(out.audio, audioRendition{url: resolved, groupID: attrs["GROUP-ID"], name: attrs["NAME"], language: attrs["LANGUAGE"], defaulted: strings.EqualFold(attrs["DEFAULT"], "YES"), autoselect: strings.EqualFold(attrs["AUTOSELECT"], "YES")})
			}
		case strings.HasPrefix(line, "#EXTINF:"):
			value := strings.TrimPrefix(line, "#EXTINF:")
			if comma := strings.IndexByte(value, ','); comma >= 0 {
				value = value[:comma]
			}
			duration, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
			if err != nil || duration <= 0 {
				return out, unsupported("invalid EXTINF duration")
			}
			pendingDuration = &duration
		case strings.HasPrefix(line, "#EXT-X-TARGETDURATION:"):
			value, err := strconv.ParseFloat(strings.TrimSpace(strings.TrimPrefix(line, "#EXT-X-TARGETDURATION:")), 64)
			if err != nil || value <= 0 {
				return out, unsupported("invalid target duration")
			}
			out.targetDuration = value
		case strings.HasPrefix(line, "#EXT-X-MEDIA-SEQUENCE:"):
			value, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(line, "#EXT-X-MEDIA-SEQUENCE:")))
			if err != nil || value < 0 {
				return out, unsupported("invalid media sequence")
			}
			nextSequence, out.mediaSequence = value, value
		case line == "#EXT-X-DISCONTINUITY":
			pendingDiscontinuity = true
		case line == "#EXT-X-ENDLIST":
			out.hasEndList = true
		case strings.HasPrefix(line, "#EXT-X-KEY:"):
			attrs := parseAttributes(strings.TrimPrefix(line, "#EXT-X-KEY:"))
			if !strings.EqualFold(attrs["METHOD"], "NONE") {
				return out, unsupported("encrypted HLS is not supported yet")
			}
		case strings.HasPrefix(line, "#EXT-X-MAP:"), strings.HasPrefix(line, "#EXT-X-BYTERANGE:"), strings.HasPrefix(line, "#EXT-X-PART:"), strings.HasPrefix(line, "#EXT-X-SKIP:"), strings.HasPrefix(line, "#EXT-X-RENDITION-REPORT:"):
			return out, unsupported("fMP4, byte-range, or low-latency HLS is not supported yet")
		case strings.HasPrefix(line, "#"):
			continue
		default:
			resolved, err := resolve(base, line)
			if err != nil {
				return out, err
			}
			if pendingVariant != nil {
				bandwidth, _ := strconv.Atoi(pendingVariant["BANDWIDTH"])
				out.variants = append(out.variants, variant{url: resolved, bandwidth: bandwidth, resolution: pendingVariant["RESOLUTION"], codecs: pendingVariant["CODECS"], audioGroupID: pendingVariant["AUDIO"]})
				pendingVariant = nil
				continue
			}
			if pendingDuration == nil {
				return out, unsupported("media URI without EXTINF")
			}
			out.segments = append(out.segments, segment{url: resolved, duration: *pendingDuration, sequence: nextSequence, discontinuity: pendingDiscontinuity})
			nextSequence++
			pendingDuration = nil
			pendingDiscontinuity = false
		}
	}
	if pendingVariant != nil || pendingDuration != nil {
		return out, unsupported("incomplete HLS playlist")
	}
	if out.master && len(out.variants) == 0 {
		return out, unsupported("master playlist has no variants")
	}
	return out, nil
}

func parseAttributes(value string) map[string]string {
	attributes := make(map[string]string)
	for index := 0; index < len(value); {
		for index < len(value) && (value[index] == ',' || value[index] == ' ') {
			index++
		}
		start := index
		for index < len(value) && value[index] != '=' && value[index] != ',' {
			index++
		}
		if start == index || index >= len(value) || value[index] != '=' {
			for index < len(value) && value[index] != ',' {
				index++
			}
			continue
		}
		key := strings.ToUpper(strings.TrimSpace(value[start:index]))
		index++
		var parsed string
		if index < len(value) && value[index] == '"' {
			index++
			start = index
			for index < len(value) && value[index] != '"' {
				index++
			}
			parsed = value[start:index]
			if index < len(value) {
				index++
			}
		} else {
			start = index
			for index < len(value) && value[index] != ',' {
				index++
			}
			parsed = strings.TrimSpace(value[start:index])
		}
		attributes[key] = parsed
	}
	return attributes
}

func resolve(base *url.URL, ref string) (string, error) {
	parsed, err := url.Parse(ref)
	if err != nil {
		return "", fmt.Errorf("invalid HLS URI: %w", err)
	}
	return base.ResolveReference(parsed).String(), nil
}

func selectSegments(media playlist, capSeconds float64) ([]segment, float64, error) {
	if !media.hasEndList {
		return nil, 0, unsupported("live HLS is not supported yet")
	}
	var selected []segment
	var duration float64
	for _, item := range media.segments {
		if duration+item.duration > capSeconds+0.000001 {
			break
		}
		selected = append(selected, item)
		duration += item.duration
	}
	if len(selected) == 0 {
		return nil, 0, unsupported("requested duration is shorter than the first segment")
	}
	return selected, duration, nil
}

func chooseAudio(items []audioRendition, groupID string) *audioRendition {
	var candidates []audioRendition
	for _, item := range items {
		if item.groupID == groupID {
			candidates = append(candidates, item)
		}
	}
	if len(candidates) == 0 {
		return nil
	}
	for i := range candidates {
		if candidates[i].defaulted {
			return &candidates[i]
		}
	}
	for i := range candidates {
		if candidates[i].autoselect {
			return &candidates[i]
		}
	}
	return &candidates[0]
}

type captureError struct{ code, message string }

func (e *captureError) Error() string { return e.message }
func unsupported(message string) error {
	return &captureError{code: "UNSUPPORTED_MANIFEST", message: message}
}
