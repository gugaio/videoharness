// Package telemetry contains stable domain contracts for the Playback
// Inspector. Persistence and HTTP handlers are introduced in later phases.
package telemetry

// UnixMillis is a UTC wall-clock timestamp persisted as Unix epoch
// milliseconds. A separate monotonic value is carried for browser events.
type UnixMillis int64

type SessionID string

type Session struct {
	ID                SessionID   `json:"id"`
	WorkspaceSlug     string      `json:"workspace_slug"`
	StreamID          string      `json:"stream_id"`
	CMCDSessionID     string      `json:"cmcd_session_id"`
	ContentID         *string     `json:"content_id,omitempty"`
	CMCDVersion       uint8       `json:"cmcd_version"`
	PlayerName        *string     `json:"player_name,omitempty"`
	PlayerVersion     *string     `json:"player_version,omitempty"`
	UserAgent         *string     `json:"user_agent,omitempty"`
	InitialPreset     string      `json:"initial_preset"`
	ObserverConnected bool        `json:"observer_connected"`
	StartedAtMS       UnixMillis  `json:"started_at_ms"`
	LastSeenAtMS      UnixMillis  `json:"last_seen_at_ms"`
	EndedAtMS         *UnixMillis `json:"ended_at_ms,omitempty"`
	CreatedAtMS       UnixMillis  `json:"created_at_ms"`
}

type SessionSummary struct {
	ObservedDurationMS int64    `json:"observed_duration_ms"`
	RequestCount       int64    `json:"request_count"`
	Bytes              int64    `json:"bytes"`
	ErrorCount         int64    `json:"error_count"`
	UrgentRequestCount int64    `json:"urgent_request_count"`
	StarvationCount    int64    `json:"starvation_count"`
	DeadlineMissCount  int64    `json:"deadline_miss_count"`
	InterventionCount  int64    `json:"intervention_count"`
	MinimumBitrateKbps *int64   `json:"minimum_bitrate_kbps,omitempty"`
	MaximumBitrateKbps *int64   `json:"maximum_bitrate_kbps,omitempty"`
	AverageBitrateKbps *float64 `json:"average_bitrate_kbps,omitempty"`
}

type TimelineEntryKind string

const (
	TimelineEntryRequest TimelineEntryKind = "request"
	TimelineEntryEvent   TimelineEntryKind = "event"
)

// TimelineEntry has exactly one populated payload, selected by Kind.
type TimelineEntry struct {
	Kind    TimelineEntryKind `json:"kind"`
	AtMS    UnixMillis        `json:"at_ms"`
	Request *RequestPoint     `json:"request,omitempty"`
	Event   *PlaybackEvent    `json:"event,omitempty"`
}

type RequestPoint struct {
	RequestID     int64        `json:"request_id"`
	StartedAtMS   UnixMillis   `json:"started_at_ms"`
	CompletedAtMS UnixMillis   `json:"completed_at_ms"`
	DurationMS    int64        `json:"duration_ms"`
	Status        int          `json:"status"`
	Bytes         int64        `json:"bytes"`
	Kind          string       `json:"kind"`
	TargetURL     string       `json:"target_url"`
	ActivePreset  string       `json:"active_preset"`
	Intervention  *string      `json:"intervention,omitempty"`
	CMCD          *RequestCMCD `json:"cmcd,omitempty"`
}

// RequestCMCD is the v1 projection used by the timeline. It deliberately
// preserves optionality; zero never means an unknown metric.
type RequestCMCD struct {
	Valid                  bool     `json:"valid"`
	ValidationErrors       []string `json:"validation_errors,omitempty"`
	SessionID              *string  `json:"sid,omitempty"`
	ContentID              *string  `json:"cid,omitempty"`
	ObjectType             *string  `json:"ot,omitempty"`
	BitrateKbps            *int64   `json:"br_kbps,omitempty"`
	BufferLengthMS         *int64   `json:"bl_ms,omitempty"`
	MeasuredThroughputKbps *int64   `json:"mtp_kbps,omitempty"`
	DeadlineMS             *int64   `json:"dl_ms,omitempty"`
	Startup                *bool    `json:"startup,omitempty"`
	BufferStarvation       *bool    `json:"buffer_starvation,omitempty"`
}

type PlaybackEvent struct {
	ID             string     `json:"id"`
	SequenceNumber int64      `json:"sequence_number"`
	EventType      string     `json:"event_type"`
	WallTimeMS     UnixMillis `json:"wall_time_ms"`
	MonotonicMS    int64      `json:"monotonic_ms"`
	MediaTimeMS    *int64     `json:"media_time_ms,omitempty"`
	BufferAheadMS  *int64     `json:"buffer_ahead_ms,omitempty"`
	BitrateKbps    *int64     `json:"bitrate_kbps,omitempty"`
	ThroughputKbps *int64     `json:"throughput_kbps,omitempty"`
	PayloadJSON    *string    `json:"payload_json,omitempty"`
	ReceivedAtMS   UnixMillis `json:"received_at_ms"`
}

type Timeline struct {
	Session Session         `json:"session"`
	Summary SessionSummary  `json:"summary"`
	Entries []TimelineEntry `json:"entries"`
}
