// Package cmcd decodes and normalizes Common Media Client Data received by
// StreamMock. It deliberately has no dependency on the HTTP handlers or the
// database so the decoder can evolve independently of the playback path.
package cmcd

import "net/http"

const QueryParameter = "CMCD"

// Decoder is the boundary between HTTP transport and StreamMock's normalized
// CMCD representation. Implementations must not mutate the request.
type Decoder interface {
	DecodeRequest(*http.Request) (NormalizedCMCD, error)
}

// Version identifies the CMCD wire format used for a decoded payload.
type Version uint8

const (
	VersionUnknown Version = 0
	VersionV1      Version = 1
)

// ObjectType is CMCD's ot value.
type ObjectType string

const (
	ObjectTypeManifest  ObjectType = "m"
	ObjectTypeAudio     ObjectType = "a"
	ObjectTypeVideo     ObjectType = "v"
	ObjectTypeMuxedAV   ObjectType = "av"
	ObjectTypeInit      ObjectType = "i"
	ObjectTypeCaption   ObjectType = "c"
	ObjectTypeTimedText ObjectType = "tt"
	ObjectTypeKey       ObjectType = "k"
	ObjectTypeOther     ObjectType = "o"
)

// StreamingFormat is CMCD's sf value.
type StreamingFormat string

const (
	StreamingFormatDASH   StreamingFormat = "d"
	StreamingFormatHLS    StreamingFormat = "h"
	StreamingFormatSmooth StreamingFormat = "s"
	StreamingFormatOther  StreamingFormat = "o"
)

// StreamType is CMCD's st value.
type StreamType string

const (
	StreamTypeVOD  StreamType = "v"
	StreamTypeLive StreamType = "l"
)

// ObjectValue is reserved for CMCD v2, where a metric may be associated with
// one or more object types. CMCD v1 uses Scalar only.
type ObjectValue[T any] struct {
	ObjectType ObjectType `json:"object_type"`
	Value      T          `json:"value"`
}

// ObjectValues represents a scalar v1 value or future values split by object
// type. A nil pointer means the key was absent; an explicit zero is preserved.
type ObjectValues[T any] struct {
	Scalar   *T               `json:"scalar,omitempty"`
	ByObject []ObjectValue[T] `json:"by_object,omitempty"`
}

// CustomValueKind records the wire type of an extension value.
type CustomValueKind string

const (
	CustomBoolean CustomValueKind = "boolean"
	CustomInteger CustomValueKind = "integer"
	CustomDecimal CustomValueKind = "decimal"
	CustomString  CustomValueKind = "string"
	CustomToken   CustomValueKind = "token"
)

// CustomValue preserves custom-field types instead of coercing them to a
// string. Exactly one of the value pointers is non-nil.
type CustomValue struct {
	Kind    CustomValueKind `json:"kind"`
	Boolean *bool           `json:"boolean,omitempty"`
	Integer *int64          `json:"integer,omitempty"`
	Decimal *float64        `json:"decimal,omitempty"`
	String  *string         `json:"string,omitempty"`
	Token   *string         `json:"token,omitempty"`
}

// NormalizedCMCD is the stable, transport-neutral representation stored by a
// later phase. Numeric values use the units in their names.
type NormalizedCMCD struct {
	Present        bool    `json:"present"`
	Version        Version `json:"version,omitempty"`
	RawValue       string  `json:"raw_value,omitempty"`
	CanonicalValue string  `json:"canonical_value,omitempty"`

	SessionID       *string          `json:"sid,omitempty"`
	ContentID       *string          `json:"cid,omitempty"`
	ObjectType      *ObjectType      `json:"ot,omitempty"`
	StreamingFormat *StreamingFormat `json:"sf,omitempty"`
	StreamType      *StreamType      `json:"st,omitempty"`

	BitrateKbps             *ObjectValues[int64]   `json:"br_kbps,omitempty"`
	TopBitrateKbps          *ObjectValues[int64]   `json:"tb_kbps,omitempty"`
	MeasuredThroughputKbps  *ObjectValues[int64]   `json:"mtp_kbps,omitempty"`
	RequestedThroughputKbps *ObjectValues[int64]   `json:"rtp_kbps,omitempty"`
	BufferLengthMS          *ObjectValues[int64]   `json:"bl_ms,omitempty"`
	DeadlineMS              *int64                 `json:"dl_ms,omitempty"`
	ObjectDurationMS        *int64                 `json:"object_duration_ms,omitempty"`
	PlaybackRate            *float64               `json:"playback_rate,omitempty"`
	NextObjectRequest       *string                `json:"nor,omitempty"`
	NextRangeRequest        *string                `json:"nrr,omitempty"`
	Startup                 *bool                  `json:"startup,omitempty"`
	BufferStarvation        *bool                  `json:"buffer_starvation,omitempty"`
	Custom                  map[string]CustomValue `json:"custom,omitempty"`
}

// Limits are intentionally local to decoding. They bound parsing work before
// data reaches logs or persistence.
type Limits struct {
	MaxRawValueBytes     int
	MaxEncodedValueBytes int
	MaxKeys              int
	MaxCustomKeys        int
	MaxKeyBytes          int
	MaxStringBytes       int
	MaxSessionIDRunes    int
	MaxContentIDRunes    int
}

func DefaultLimits() Limits {
	return Limits{
		MaxRawValueBytes:     8 * 1024,
		MaxEncodedValueBytes: 3 * 8 * 1024,
		MaxKeys:              64,
		MaxCustomKeys:        16,
		MaxKeyBytes:          64,
		MaxStringBytes:       1024,
		MaxSessionIDRunes:    64,
		MaxContentIDRunes:    64,
	}
}
