// Package diagnostics contains stable finding contracts. Rules and database
// queries are intentionally introduced only in the causal-diagnostics phase.
package diagnostics

type Severity string

const (
	SeverityInfo    Severity = "info"
	SeverityWarning Severity = "warning"
	SeverityError   Severity = "error"
)

type Confidence string

const (
	ConfidenceLow    Confidence = "low"
	ConfidenceMedium Confidence = "medium"
	ConfidenceHigh   Confidence = "high"
)

type EvidenceReferenceKind string

const (
	EvidenceRequest EvidenceReferenceKind = "request"
	EvidenceEvent   EvidenceReferenceKind = "event"
)

type EvidenceReference struct {
	Kind EvidenceReferenceKind `json:"kind"`
	ID   string                `json:"id"`
}

type Unit string

const (
	UnitMilliseconds Unit = "ms"
	UnitKbps         Unit = "kbps"
	UnitBytes        Unit = "bytes"
	UnitRatio        Unit = "ratio"
	UnitCount        Unit = "count"
)

// Measurement is intentionally numeric: qualitative details belong in the
// finding message or the referenced request/event payload.
type Measurement struct {
	Name  string  `json:"name"`
	Value float64 `json:"value"`
	Unit  Unit    `json:"unit"`
}

type Finding struct {
	RuleID       string              `json:"rule_id"`
	RuleVersion  uint16              `json:"rule_version"`
	Occurrences  int64               `json:"occurrences,omitempty"`
	Severity     Severity            `json:"severity"`
	Confidence   Confidence          `json:"confidence"`
	Message      string              `json:"message"`
	Evidence     []EvidenceReference `json:"evidence"`
	Measurements []Measurement       `json:"measurements"`
}
