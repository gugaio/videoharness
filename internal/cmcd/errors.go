package cmcd

import "strings"

type IssueCode string

const (
	IssueBadQueryEncoding   IssueCode = "bad_query_encoding"
	IssueDuplicateParameter IssueCode = "duplicate_parameter"
	IssuePayloadTooLarge    IssueCode = "payload_too_large"
	IssueEmptyPayload       IssueCode = "empty_payload"
	IssueTooManyKeys        IssueCode = "too_many_keys"
	IssueTooManyCustomKeys  IssueCode = "too_many_custom_keys"
	IssueKeyTooLong         IssueCode = "key_too_long"
	IssueInvalidKey         IssueCode = "invalid_key"
	IssueDuplicateKey       IssueCode = "duplicate_key"
	IssueMissingValue       IssueCode = "missing_value"
	IssueUnexpectedValue    IssueCode = "unexpected_value"
	IssueUnterminatedString IssueCode = "unterminated_string"
	IssueInvalidEscape      IssueCode = "invalid_escape"
	IssueStringTooLong      IssueCode = "string_too_long"
	IssueInvalidNumber      IssueCode = "invalid_number"
	IssueOutOfRange         IssueCode = "out_of_range"
	IssueInvalidEnum        IssueCode = "invalid_enum"
	IssueUnknownKey         IssueCode = "unknown_key"
	IssueInvalidRange       IssueCode = "invalid_range"
)

// Issue is serializable so a future persistence layer can expose a precise
// conformance finding without persisting parser-specific error text.
type Issue struct {
	Code IssueCode `json:"code"`
	Key  string    `json:"key,omitempty"`
}

// ValidationError reports one or more independent CMCD conformance failures.
// Decoding remains fail-open: callers can use the partial normalized value.
type ValidationError struct {
	Issues []Issue
}

func (e *ValidationError) Error() string {
	parts := make([]string, 0, len(e.Issues))
	for _, issue := range e.Issues {
		if issue.Key == "" {
			parts = append(parts, string(issue.Code))
			continue
		}
		parts = append(parts, string(issue.Code)+":"+issue.Key)
	}
	return "invalid CMCD: " + strings.Join(parts, ", ")
}
