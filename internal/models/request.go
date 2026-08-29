package models

import "time"

// Proxy request kinds recorded on workspace boards.
const (
	KindMaster  = "master"
	KindVariant = "variant"
	KindSegment = "segment"
	KindAsset   = "asset"
)

// ProxyRequest is one aggregated playback request served for a workspace.
// Repeated requests to the same (workspace, stream, target URL) collapse into
// a single row whose HitCount grows.
type ProxyRequest struct {
	WorkspaceSlug string    `json:"workspace_slug"`
	StreamID      string    `json:"stream_id"`
	Kind          string    `json:"kind"`
	TargetURL     string    `json:"target_url"`
	Status        int       `json:"status"`
	DurationMS    int64     `json:"duration_ms"`
	Bytes         int64     `json:"bytes"`
	ClientIP      string    `json:"client_ip"`
	ActivePreset  string    `json:"active_preset"`
	HitCount      int64     `json:"hit_count"`
	FirstSeenAt   time.Time `json:"first_seen_at"`
	LastSeenAt    time.Time `json:"last_seen_at"`
}

// Workspace is a request-inspection board scoped to one authenticated owner.
type Workspace struct {
	Slug      string    `json:"slug"`
	OwnerID   string    `json:"owner_id"`
	CreatedAt time.Time `json:"created_at"`
}
