package models

import "time"

type Stream struct {
	ID                       string     `json:"id"`
	Label                    string     `json:"label"`
	OriginalURL              string     `json:"original_url"`
	ProxyPath                string     `json:"proxy_path"`
	ActivePreset             string     `json:"active_preset"`
	OwnerID                  *string    `json:"owner_id"`
	WorkspaceSlug            *string    `json:"workspace_slug,omitempty"`
	Mode                     string     `json:"mode"`
	CaptureStatus            string     `json:"capture_status"`
	RequestedDurationSeconds float64    `json:"requested_duration_seconds"`
	DurationSeconds          *float64   `json:"duration_seconds,omitempty"`
	TotalBytes               *int64     `json:"total_bytes,omitempty"`
	ResourceCount            *int       `json:"resource_count,omitempty"`
	StorageKey               *string    `json:"storage_key,omitempty"`
	ErrorCode                *string    `json:"error_code,omitempty"`
	ErrorMessage             *string    `json:"error_message,omitempty"`
	Format                   string     `json:"format"`
	ProtectionMode           string     `json:"protection_mode"`
	TrackSelection           string     `json:"track_selection"`
	LicensePath              *string    `json:"license_path,omitempty"`
	CaptureProgress          int        `json:"capture_progress"`
	VideoTrackCount          int        `json:"video_track_count"`
	AudioTrackCount          int        `json:"audio_track_count"`
	SubtitleTrackCount       int        `json:"subtitle_track_count"`
	SourceLive               bool       `json:"source_live"`
	ExpiresAt                *time.Time `json:"expires_at,omitempty"`
	CreatedAt                time.Time  `json:"created_at"`
	UpdatedAt                time.Time  `json:"updated_at"`
}

const (
	ModeProxy = "proxy"
	ModeClone = "clone"

	CaptureQueued    = "queued"
	CaptureCapturing = "capturing"
	CaptureReady     = "ready"
	CaptureFailed    = "failed"
)

const (
	FormatHLS  = "hls"
	FormatDASH = "dash"
)

const (
	ProtectionClear    = "clear"
	ProtectionClearKey = "clearkey"

	TracksHighest = "highest"
	TracksAll     = "all"
)

func ValidFormat(value string) bool {
	return value == FormatHLS || value == FormatDASH
}

func ValidProtection(value string) bool {
	return value == ProtectionClear || value == ProtectionClearKey
}

func ValidTrackSelection(value string) bool {
	return value == TracksHighest || value == TracksAll
}

// DRMKey is intentionally a test key, not a commercial DRM secret. KeyHex is
// never included in stream API responses and is only returned through the
// W3C ClearKey license exchange.
type DRMKey struct {
	StreamID string
	KIDHex   string
	KeyHex   string
	Label    string
}

type Resource struct {
	StreamID    string
	LogicalPath string
	Kind        string
	ContentType string
	SizeBytes   int64
	SHA256      string
}

type Preset struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

var Presets = []Preset{
	{Key: "clean", Label: "Clean", Description: "Pass-through with zero modification."},
	{Key: "subway_3g", Label: "Subway 3G", Description: "Throttled ~1.2-2.4 Mbps transfer, 100-400ms latency and a 10% chance of HTTP 504."},
	{Key: "cdn_degradation", Label: "CDN Degradation", Description: "20% of segment requests fail with HTTP 500."},
	{Key: "stale_live_manifest", Label: "Stale Live Manifest", Description: "Manifest refresh responses delayed by 4000ms."},
	{Key: "drm_license_latency", Label: "DRM License Latency", Description: "ClearKey license responses are delayed by 3000ms."},
	{Key: "drm_license_failure", Label: "DRM License Failure", Description: "ClearKey license requests fail with HTTP 503."},
	{Key: "drm_license_recovery", Label: "DRM License Recovery", Description: "The first two ClearKey license requests fail, then recover."},
	{Key: "drm_wrong_key", Label: "DRM Wrong Key", Description: "The license response contains a deliberately incorrect content key."},
	{Key: "drm_malformed_license", Label: "DRM Malformed License", Description: "The license server returns malformed JSON."},
}

func ValidPreset(key string) bool {
	for _, p := range Presets {
		if p.Key == key {
			return true
		}
	}
	return false
}
