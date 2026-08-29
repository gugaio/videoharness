package models

import "time"

type Stream struct {
	ID                       string    `json:"id"`
	Label                    string    `json:"label"`
	OriginalURL              string    `json:"original_url"`
	ProxyPath                string    `json:"proxy_path"`
	ActivePreset             string    `json:"active_preset"`
	OwnerID                  *string   `json:"owner_id"`
	WorkspaceSlug            *string   `json:"workspace_slug,omitempty"`
	Mode                     string    `json:"mode"`
	CaptureStatus            string    `json:"capture_status"`
	RequestedDurationSeconds float64   `json:"requested_duration_seconds"`
	DurationSeconds          *float64  `json:"duration_seconds,omitempty"`
	TotalBytes               *int64    `json:"total_bytes,omitempty"`
	ResourceCount            *int      `json:"resource_count,omitempty"`
	StorageKey               *string   `json:"storage_key,omitempty"`
	ErrorCode                *string   `json:"error_code,omitempty"`
	ErrorMessage             *string   `json:"error_message,omitempty"`
	CreatedAt                time.Time `json:"created_at"`
	UpdatedAt                time.Time `json:"updated_at"`
}

const (
	ModeProxy = "proxy"
	ModeClone = "clone"

	CaptureQueued    = "queued"
	CaptureCapturing = "capturing"
	CaptureReady     = "ready"
	CaptureFailed    = "failed"
)

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
	{Key: "subway_3g", Label: "Subway 3G", Description: "1500-3000ms artificial latency and a 10% chance of HTTP 504."},
	{Key: "cdn_degradation", Label: "CDN Degradation", Description: "20% of segment requests fail with HTTP 500."},
	{Key: "stale_live_manifest", Label: "Stale Live Manifest", Description: "Manifest refresh responses delayed by 4000ms."},
}

func ValidPreset(key string) bool {
	for _, p := range Presets {
		if p.Key == key {
			return true
		}
	}
	return false
}
