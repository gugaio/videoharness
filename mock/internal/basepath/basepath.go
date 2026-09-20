// Package basepath stores the public base path that is prefixed to every
// data-plane URL emitted by StreamMock (playback, ingest, license and the
// resource paths rewritten into HLS/DASH manifests).
//
// The HTTP routes themselves stay at their usual paths (/s, /ws, /p, /i); the
// reverse proxy in front of the engine strips the configured prefix before
// forwarding. Only URLs meant for the browser/player carry the prefix.
package basepath

import "strings"

var prefix string

// Set configures the base path. Empty disables it. A leading slash is added if
// missing and a trailing slash is trimmed, so "/mock/" and "mock" both become
// "/mock".
func Set(value string) {
	prefix = normalize(value)
}

// Path returns p prefixed with the configured base path. p is expected to start
// with "/". When no base path is set, p is returned unchanged.
func Path(p string) string {
	if prefix == "" {
		return p
	}
	if !strings.HasPrefix(p, "/") {
		return prefix + "/" + p
	}
	return prefix + p
}

func normalize(value string) string {
	value = strings.TrimSpace(value)
	value = strings.TrimRight(value, "/")
	if value == "" {
		return ""
	}
	if !strings.HasPrefix(value, "/") {
		value = "/" + value
	}
	return value
}
