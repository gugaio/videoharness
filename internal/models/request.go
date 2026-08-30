package models

import (
	"errors"
	"time"

	"streammock/internal/cmcd"
)

// Proxy request kinds recorded on workspace boards.
const (
	KindMaster  = "master"
	KindVariant = "variant"
	KindSegment = "segment"
	KindAsset   = "asset"
	KindLicense = "license"
)

// ProxyRequest is one playback request served for a workspace.
type ProxyRequest struct {
	ID               int64        `json:"id"`
	WorkspaceSlug    string       `json:"workspace_slug"`
	StreamID         string       `json:"stream_id"`
	StreamMode       string       `json:"stream_mode"`
	Kind             string       `json:"kind"`
	TargetURL        string       `json:"target_url"`
	Status           int          `json:"status"`
	DurationMS       int64        `json:"duration_ms"`
	Bytes            int64        `json:"bytes"`
	ClientIP         string       `json:"client_ip"`
	ActivePreset     string       `json:"active_preset"`
	ClientRange      string       `json:"client_range,omitempty"`
	ForwardedRange   string       `json:"forwarded_range,omitempty"`
	UpstreamStatus   int          `json:"upstream_status,omitempty"`
	ContentRange     string       `json:"content_range,omitempty"`
	ContentLength    int64        `json:"content_length,omitempty"`
	RangeResult      string       `json:"range_result"`
	Diagnostic       string       `json:"diagnostic,omitempty"`
	Intervention     string       `json:"intervention,omitempty"`
	AddedLatencyMS   int64        `json:"added_latency_ms,omitempty"`
	InjectedStatus   int          `json:"injected_status,omitempty"`
	StartedAtMS      int64        `json:"started_at_ms"`
	CompletedAtMS    int64        `json:"completed_at_ms"`
	UserAgent        string       `json:"user_agent,omitempty"`
	DNSMS            *int64       `json:"dns_ms,omitempty"`
	ConnectMS        *int64       `json:"connect_ms,omitempty"`
	TLSMS            *int64       `json:"tls_ms,omitempty"`
	TTFBMS           *int64       `json:"ttfb_ms,omitempty"`
	RelayMS          *int64       `json:"relay_ms,omitempty"`
	OriginBodyMS     *int64       `json:"origin_body_ms,omitempty"`
	LocalServeMS     *int64       `json:"local_serve_ms,omitempty"`
	ConnectionReused *bool        `json:"connection_reused,omitempty"`
	TransportError   string       `json:"transport_error,omitempty"`
	CMCD             *RequestCMCD `json:"cmcd,omitempty"`
	HitCount         int64        `json:"hit_count"`
	FirstSeenAt      time.Time    `json:"first_seen_at"`
	LastSeenAt       time.Time    `json:"last_seen_at"`
}

// RequestCMCD is the storage/API projection for CMCD v1. Optional numeric
// fields remain pointers so an unknown value is never confused with zero.
type RequestCMCD struct {
	Version                 uint8                       `json:"version"`
	Valid                   bool                        `json:"valid"`
	ValidationErrors        []cmcd.Issue                `json:"validation_errors,omitempty"`
	SessionID               *string                     `json:"sid,omitempty"`
	ContentID               *string                     `json:"cid,omitempty"`
	ObjectType              *string                     `json:"ot,omitempty"`
	StreamingFormat         *string                     `json:"sf,omitempty"`
	StreamType              *string                     `json:"st,omitempty"`
	BitrateKbps             *int64                      `json:"br_kbps,omitempty"`
	TopBitrateKbps          *int64                      `json:"tb_kbps,omitempty"`
	MeasuredThroughputKbps  *int64                      `json:"mtp_kbps,omitempty"`
	RequestedThroughputKbps *int64                      `json:"rtp_kbps,omitempty"`
	BufferLengthMS          *int64                      `json:"bl_ms,omitempty"`
	DeadlineMS              *int64                      `json:"dl_ms,omitempty"`
	ObjectDurationMS        *int64                      `json:"object_duration_ms,omitempty"`
	PlaybackRate            *float64                    `json:"playback_rate,omitempty"`
	NextObjectRequest       *string                     `json:"nor,omitempty"`
	NextRangeRequest        *string                     `json:"nrr,omitempty"`
	Startup                 *bool                       `json:"startup,omitempty"`
	BufferStarvation        *bool                       `json:"buffer_starvation,omitempty"`
	RawValue                string                      `json:"raw_value,omitempty"`
	CanonicalValue          string                      `json:"canonical_value,omitempty"`
	Custom                  map[string]cmcd.CustomValue `json:"custom,omitempty"`
	SessionInternalID       *string                     `json:"session_id,omitempty"`
}

// NewRequestCMCD converts the decoder boundary into the persistence/API
// projection. Validation failures retain the partially decoded value.
func NewRequestCMCD(value cmcd.NormalizedCMCD, decodeErr error) *RequestCMCD {
	if !value.Present && decodeErr == nil {
		return nil
	}
	projection := &RequestCMCD{
		Version:                 uint8(value.Version),
		Valid:                   decodeErr == nil,
		SessionID:               value.SessionID,
		ContentID:               value.ContentID,
		BitrateKbps:             scalar(value.BitrateKbps),
		TopBitrateKbps:          scalar(value.TopBitrateKbps),
		MeasuredThroughputKbps:  scalar(value.MeasuredThroughputKbps),
		RequestedThroughputKbps: scalar(value.RequestedThroughputKbps),
		BufferLengthMS:          scalar(value.BufferLengthMS),
		DeadlineMS:              value.DeadlineMS,
		ObjectDurationMS:        value.ObjectDurationMS,
		PlaybackRate:            value.PlaybackRate,
		NextObjectRequest:       value.NextObjectRequest,
		NextRangeRequest:        value.NextRangeRequest,
		Startup:                 value.Startup,
		BufferStarvation:        value.BufferStarvation,
		RawValue:                value.RawValue,
		CanonicalValue:          value.CanonicalValue,
		Custom:                  value.Custom,
	}
	if value.ObjectType != nil {
		v := string(*value.ObjectType)
		projection.ObjectType = &v
	}
	if value.StreamingFormat != nil {
		v := string(*value.StreamingFormat)
		projection.StreamingFormat = &v
	}
	if value.StreamType != nil {
		v := string(*value.StreamType)
		projection.StreamType = &v
	}
	if decodeErr != nil {
		var validation *cmcd.ValidationError
		if errors.As(decodeErr, &validation) {
			projection.ValidationErrors = append([]cmcd.Issue(nil), validation.Issues...)
		} else {
			projection.ValidationErrors = []cmcd.Issue{{Code: cmcd.IssueDecoderError}}
		}
	}
	return projection
}

func scalar(values *cmcd.ObjectValues[int64]) *int64 {
	if values == nil {
		return nil
	}
	return values.Scalar
}

// Workspace is a request-inspection board scoped to one authenticated owner.
type Workspace struct {
	Slug      string    `json:"slug"`
	OwnerID   string    `json:"owner_id"`
	CreatedAt time.Time `json:"created_at"`
}
