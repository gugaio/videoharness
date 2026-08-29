package models

import "time"

// Proxy request kinds recorded on workspace boards.
const (
	KindMaster  = "master"
	KindVariant = "variant"
	KindSegment = "segment"
	KindAsset   = "asset"
)

// ProxyRequest is one playback request served for a workspace.
type ProxyRequest struct {
	WorkspaceSlug  string    `json:"workspace_slug"`
	StreamID       string    `json:"stream_id"`
	StreamMode     string    `json:"stream_mode"`
	Kind           string    `json:"kind"`
	TargetURL      string    `json:"target_url"`
	Status         int       `json:"status"`
	DurationMS     int64     `json:"duration_ms"`
	Bytes          int64     `json:"bytes"`
	ClientIP       string    `json:"client_ip"`
	ActivePreset   string    `json:"active_preset"`
	ClientRange    string    `json:"client_range,omitempty"`
	ForwardedRange string    `json:"forwarded_range,omitempty"`
	UpstreamStatus int       `json:"upstream_status,omitempty"`
	ContentRange   string    `json:"content_range,omitempty"`
	ContentLength  int64     `json:"content_length,omitempty"`
	RangeResult    string    `json:"range_result"`
	Diagnostic     string    `json:"diagnostic,omitempty"`
	Intervention   string    `json:"intervention,omitempty"`
	AddedLatencyMS int64     `json:"added_latency_ms,omitempty"`
	InjectedStatus int       `json:"injected_status,omitempty"`
	HitCount       int64     `json:"hit_count"`
	FirstSeenAt    time.Time `json:"first_seen_at"`
	LastSeenAt     time.Time `json:"last_seen_at"`
}

// Workspace is a request-inspection board scoped to one authenticated owner.
type Workspace struct {
	Slug      string    `json:"slug"`
	OwnerID   string    `json:"owner_id"`
	CreatedAt time.Time `json:"created_at"`
}
