package cmcd

import (
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// V1Decoder decodes CMCD v1 Request Mode query parameters. It intentionally
// does not inspect CMCD headers; headers are planned for a later phase.
type V1Decoder struct {
	limits Limits
}

func NewV1Decoder(limits Limits) *V1Decoder {
	defaults := DefaultLimits()
	if limits.MaxRawValueBytes <= 0 {
		limits.MaxRawValueBytes = defaults.MaxRawValueBytes
	}
	if limits.MaxEncodedValueBytes <= 0 {
		limits.MaxEncodedValueBytes = defaults.MaxEncodedValueBytes
	}
	if limits.MaxKeys <= 0 {
		limits.MaxKeys = defaults.MaxKeys
	}
	if limits.MaxCustomKeys <= 0 {
		limits.MaxCustomKeys = defaults.MaxCustomKeys
	}
	if limits.MaxKeyBytes <= 0 {
		limits.MaxKeyBytes = defaults.MaxKeyBytes
	}
	if limits.MaxStringBytes <= 0 {
		limits.MaxStringBytes = defaults.MaxStringBytes
	}
	if limits.MaxSessionIDRunes <= 0 {
		limits.MaxSessionIDRunes = defaults.MaxSessionIDRunes
	}
	if limits.MaxContentIDRunes <= 0 {
		limits.MaxContentIDRunes = defaults.MaxContentIDRunes
	}
	return &V1Decoder{limits: limits}
}

func (d *V1Decoder) DecodeRequest(r *http.Request) (NormalizedCMCD, error) {
	if r == nil || r.URL == nil {
		return NormalizedCMCD{}, nil
	}

	rawValue, present, issues := d.extractQueryValue(r.URL.RawQuery)
	if !present {
		return NormalizedCMCD{}, nil
	}
	out := NormalizedCMCD{Present: true, Version: VersionV1}
	if len(rawValue) > d.limits.MaxRawValueBytes {
		issues = append(issues, Issue{Code: IssuePayloadTooLarge})
		return out, validationError(issues)
	}
	if !utf8.ValidString(rawValue) {
		issues = append(issues, Issue{Code: IssueInvalidUTF8})
		return out, validationError(issues)
	}
	out.RawValue = rawValue
	if rawValue == "" {
		if len(issues) == 0 {
			issues = append(issues, Issue{Code: IssueEmptyPayload})
		}
		return out, validationError(issues)
	}

	entries, tokenizeIssues := tokenize(rawValue, d.limits)
	issues = append(issues, tokenizeIssues...)
	seen := make(map[string]struct{}, len(entries))
	customCount := 0
	for _, entry := range entries {
		if len(seen) >= d.limits.MaxKeys {
			issues = append(issues, Issue{Code: IssueTooManyKeys})
			break
		}
		if _, ok := seen[entry.key]; ok {
			issues = append(issues, Issue{Code: IssueDuplicateKey, Key: entry.key})
			continue
		}
		seen[entry.key] = struct{}{}
		if isStandardKey(entry.key) {
			issues = append(issues, d.assignStandard(&out, entry)...)
			continue
		}
		if !validCustomKey(entry.key) {
			issues = append(issues, Issue{Code: IssueUnknownKey, Key: entry.key})
			continue
		}
		customCount++
		if customCount > d.limits.MaxCustomKeys {
			issues = append(issues, Issue{Code: IssueTooManyCustomKeys})
			continue
		}
		value, valueIssues := d.customValue(entry)
		issues = append(issues, valueIssues...)
		if len(valueIssues) == 0 {
			if out.Custom == nil {
				out.Custom = make(map[string]CustomValue)
			}
			out.Custom[entry.key] = value
		}
	}
	out.CanonicalValue = canonical(out)
	return out, validationError(issues)
}

func (d *V1Decoder) extractQueryValue(rawQuery string) (string, bool, []Issue) {
	if rawQuery == "" {
		return "", false, nil
	}
	var value string
	present := false
	var issues []Issue
	for _, pair := range strings.Split(rawQuery, "&") {
		keyRaw, valueRaw, hasValue := strings.Cut(pair, "=")
		key, err := url.QueryUnescape(keyRaw)
		if err != nil {
			if strings.HasPrefix(keyRaw, QueryParameter) {
				issues = append(issues, Issue{Code: IssueBadQueryEncoding, Key: QueryParameter})
			}
			continue
		}
		if key != QueryParameter {
			continue
		}
		if present {
			issues = append(issues, Issue{Code: IssueDuplicateParameter, Key: QueryParameter})
			continue
		}
		present = true
		if !hasValue {
			issues = append(issues, Issue{Code: IssueEmptyPayload, Key: QueryParameter})
			continue
		}
		if len(valueRaw) > d.limits.MaxEncodedValueBytes {
			issues = append(issues, Issue{Code: IssuePayloadTooLarge, Key: QueryParameter})
			continue
		}
		decoded, err := url.QueryUnescape(valueRaw)
		if err != nil {
			issues = append(issues, Issue{Code: IssueBadQueryEncoding, Key: QueryParameter})
			continue
		}
		value = decoded
	}
	return value, present, issues
}

type token struct {
	key      string
	value    string
	quoted   bool
	implicit bool
}

func tokenize(raw string, limits Limits) ([]token, []Issue) {
	var tokens []token
	var issues []Issue
	for _, part := range splitFields(raw, &issues) {
		part = strings.TrimSpace(part)
		if part == "" {
			issues = append(issues, Issue{Code: IssueMissingValue})
			continue
		}
		key, value, hasValue := strings.Cut(part, "=")
		key = strings.TrimSpace(key)
		if !validKey(key) {
			issues = append(issues, Issue{Code: IssueInvalidKey, Key: key})
			continue
		}
		if len(key) > limits.MaxKeyBytes {
			issues = append(issues, Issue{Code: IssueKeyTooLong, Key: key})
			continue
		}
		t := token{key: key, implicit: !hasValue}
		if hasValue {
			decoded, quoted, decodeIssues := parseValue(strings.TrimSpace(value), key, limits)
			issues = append(issues, decodeIssues...)
			if len(decodeIssues) > 0 {
				continue
			}
			t.value, t.quoted = decoded, quoted
		}
		tokens = append(tokens, t)
	}
	return tokens, issues
}

func splitFields(raw string, issues *[]Issue) []string {
	var fields []string
	start := 0
	inQuote := false
	escaped := false
	for i := 0; i < len(raw); i++ {
		switch {
		case escaped:
			escaped = false
		case inQuote && raw[i] == '\\':
			escaped = true
		case raw[i] == '"':
			inQuote = !inQuote
		case raw[i] == ',' && !inQuote:
			fields = append(fields, raw[start:i])
			start = i + 1
		}
	}
	if inQuote {
		*issues = append(*issues, Issue{Code: IssueUnterminatedString})
	}
	if escaped {
		*issues = append(*issues, Issue{Code: IssueInvalidEscape})
	}
	fields = append(fields, raw[start:])
	return fields
}

func parseValue(raw, key string, limits Limits) (string, bool, []Issue) {
	if raw == "" {
		return "", false, []Issue{{Code: IssueMissingValue, Key: key}}
	}
	if raw[0] != '"' {
		if strings.ContainsAny(raw, "\\\"") {
			return "", false, []Issue{{Code: IssueUnexpectedValue, Key: key}}
		}
		if len(raw) > limits.MaxStringBytes {
			return "", false, []Issue{{Code: IssueStringTooLong, Key: key}}
		}
		return raw, false, nil
	}
	if len(raw) < 2 || raw[len(raw)-1] != '"' {
		return "", true, []Issue{{Code: IssueUnterminatedString, Key: key}}
	}
	var builder strings.Builder
	for i := 1; i < len(raw)-1; i++ {
		if raw[i] != '\\' {
			if raw[i] == '"' {
				return "", true, []Issue{{Code: IssueUnexpectedValue, Key: key}}
			}
			builder.WriteByte(raw[i])
			continue
		}
		i++
		if i >= len(raw)-1 || (raw[i] != '\\' && raw[i] != '"') {
			return "", true, []Issue{{Code: IssueInvalidEscape, Key: key}}
		}
		builder.WriteByte(raw[i])
	}
	value := builder.String()
	if len(value) > limits.MaxStringBytes {
		return "", true, []Issue{{Code: IssueStringTooLong, Key: key}}
	}
	return value, true, nil
}

func (d *V1Decoder) assignStandard(out *NormalizedCMCD, entry token) []Issue {
	key := entry.key
	if key == "su" || key == "bs" {
		if !entry.implicit {
			return []Issue{{Code: IssueUnexpectedValue, Key: key}}
		}
		value := true
		if key == "su" {
			out.Startup = &value
		} else {
			out.BufferStarvation = &value
		}
		return nil
	}
	if entry.implicit {
		return []Issue{{Code: IssueMissingValue, Key: key}}
	}

	switch key {
	case "sid", "cid":
		if !entry.quoted {
			return []Issue{{Code: IssueUnexpectedValue, Key: key}}
		}
		maxRunes := d.limits.MaxSessionIDRunes
		if key == "cid" {
			maxRunes = d.limits.MaxContentIDRunes
		}
		if utf8.RuneCountInString(entry.value) > maxRunes {
			return []Issue{{Code: IssueStringTooLong, Key: key}}
		}
		if key == "sid" {
			out.SessionID = stringPtr(entry.value)
		} else {
			out.ContentID = stringPtr(entry.value)
		}
	case "ot":
		value := ObjectType(entry.value)
		if !validObjectType(value) {
			return []Issue{{Code: IssueInvalidEnum, Key: key}}
		}
		out.ObjectType = &value
	case "sf":
		value := StreamingFormat(entry.value)
		if !validStreamingFormat(value) {
			return []Issue{{Code: IssueInvalidEnum, Key: key}}
		}
		out.StreamingFormat = &value
	case "st":
		value := StreamType(entry.value)
		if value != StreamTypeVOD && value != StreamTypeLive {
			return []Issue{{Code: IssueInvalidEnum, Key: key}}
		}
		out.StreamType = &value
	case "br", "tb", "mtp", "rtp", "bl", "dl", "d":
		value, issue := positiveInteger(entry.value, key, key == "bl" || key == "dl" || key == "d")
		if issue != nil {
			return []Issue{*issue}
		}
		if requiresHundredIncrement(key) && value%100 != 0 {
			return []Issue{{Code: IssueInvalidIncrement, Key: key}}
		}
		switch key {
		case "br":
			out.BitrateKbps = scalar(value)
		case "tb":
			out.TopBitrateKbps = scalar(value)
		case "mtp":
			out.MeasuredThroughputKbps = scalar(value)
		case "rtp":
			out.RequestedThroughputKbps = scalar(value)
		case "bl":
			out.BufferLengthMS = scalar(value)
		case "dl":
			out.DeadlineMS = &value
		case "d":
			out.ObjectDurationMS = &value
		}
	case "pr":
		value, err := strconv.ParseFloat(entry.value, 64)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
			return []Issue{{Code: IssueInvalidNumber, Key: key}}
		}
		if value < 0 {
			return []Issue{{Code: IssueOutOfRange, Key: key}}
		}
		out.PlaybackRate = &value
	case "nor":
		if !entry.quoted {
			return []Issue{{Code: IssueUnexpectedValue, Key: key}}
		}
		value, err := url.PathUnescape(entry.value)
		if err != nil || !utf8.ValidString(value) {
			return []Issue{{Code: IssueBadValueEncoding, Key: key}}
		}
		out.NextObjectRequest = stringPtr(value)
	case "nrr":
		if !entry.quoted || !validRange(entry.value) {
			return []Issue{{Code: IssueInvalidRange, Key: key}}
		}
		out.NextRangeRequest = stringPtr(entry.value)
	}
	return nil
}

func (d *V1Decoder) customValue(entry token) (CustomValue, []Issue) {
	if entry.implicit {
		value := true
		return CustomValue{Kind: CustomBoolean, Boolean: &value}, nil
	}
	if entry.quoted {
		return CustomValue{Kind: CustomString, String: stringPtr(entry.value)}, nil
	}
	if integer, err := strconv.ParseInt(entry.value, 10, 64); err == nil {
		return CustomValue{Kind: CustomInteger, Integer: &integer}, nil
	}
	if decimal, err := strconv.ParseFloat(entry.value, 64); err == nil && !math.IsNaN(decimal) && !math.IsInf(decimal, 0) {
		return CustomValue{Kind: CustomDecimal, Decimal: &decimal}, nil
	}
	if !validToken(entry.value) {
		return CustomValue{}, []Issue{{Code: IssueInvalidNumber, Key: entry.key}}
	}
	return CustomValue{Kind: CustomToken, Token: stringPtr(entry.value)}, nil
}

func positiveInteger(raw, key string, allowZero bool) (int64, *Issue) {
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, &Issue{Code: IssueInvalidNumber, Key: key}
	}
	if value < 0 || (!allowZero && value == 0) {
		return 0, &Issue{Code: IssueOutOfRange, Key: key}
	}
	return value, nil
}

func isStandardKey(key string) bool {
	switch key {
	case "br", "bl", "bs", "cid", "d", "dl", "mtp", "nor", "nrr", "ot", "pr", "rtp", "sf", "sid", "st", "su", "tb":
		return true
	default:
		return false
	}
}

func validCustomKey(value string) bool {
	separator := strings.IndexByte(value, '-')
	return separator > 0 && separator < len(value)-1
}

func requiresHundredIncrement(key string) bool {
	switch key {
	case "bl", "dl", "mtp", "rtp":
		return true
	default:
		return false
	}
}

func validKey(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-' {
			continue
		}
		return false
	}
	return true
}

func validToken(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' || r == '/' || r == ':' {
			continue
		}
		return false
	}
	return true
}

func validObjectType(value ObjectType) bool {
	switch value {
	case ObjectTypeManifest, ObjectTypeAudio, ObjectTypeVideo, ObjectTypeMuxedAV, ObjectTypeInit, ObjectTypeCaption, ObjectTypeTimedText, ObjectTypeKey, ObjectTypeOther:
		return true
	default:
		return false
	}
}

func validStreamingFormat(value StreamingFormat) bool {
	switch value {
	case StreamingFormatDASH, StreamingFormatHLS, StreamingFormatSmooth, StreamingFormatOther:
		return true
	default:
		return false
	}
}

func validRange(value string) bool {
	start, end, found := strings.Cut(value, "-")
	if !found || strings.Contains(end, "-") || (start == "" && end == "") {
		return false
	}
	if start != "" && !decimalDigits(start) {
		return false
	}
	if end != "" && !decimalDigits(end) {
		return false
	}
	if start == "" {
		suffix, err := strconv.ParseUint(end, 10, 64)
		return err == nil && suffix > 0
	}
	startValue, startErr := strconv.ParseUint(start, 10, 64)
	if end == "" {
		return startErr == nil
	}
	endValue, endErr := strconv.ParseUint(end, 10, 64)
	return startErr == nil && endErr == nil && startValue <= endValue
}

func decimalDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func scalar[T any](value T) *ObjectValues[T] { return &ObjectValues[T]{Scalar: &value} }
func stringPtr(value string) *string         { return &value }

func validationError(issues []Issue) error {
	if len(issues) == 0 {
		return nil
	}
	return &ValidationError{Issues: issues}
}

func canonical(out NormalizedCMCD) string {
	values := map[string]string{}
	if out.BitrateKbps != nil && out.BitrateKbps.Scalar != nil {
		values["br"] = strconv.FormatInt(*out.BitrateKbps.Scalar, 10)
	}
	if out.BufferLengthMS != nil && out.BufferLengthMS.Scalar != nil {
		values["bl"] = strconv.FormatInt(*out.BufferLengthMS.Scalar, 10)
	}
	if out.BufferStarvation != nil && *out.BufferStarvation {
		values["bs"] = ""
	}
	if out.ContentID != nil {
		values["cid"] = quote(*out.ContentID)
	}
	if out.ObjectDurationMS != nil {
		values["d"] = strconv.FormatInt(*out.ObjectDurationMS, 10)
	}
	if out.DeadlineMS != nil {
		values["dl"] = strconv.FormatInt(*out.DeadlineMS, 10)
	}
	if out.MeasuredThroughputKbps != nil && out.MeasuredThroughputKbps.Scalar != nil {
		values["mtp"] = strconv.FormatInt(*out.MeasuredThroughputKbps.Scalar, 10)
	}
	if out.NextObjectRequest != nil {
		values["nor"] = quote(encodeURIComponent(*out.NextObjectRequest))
	}
	if out.NextRangeRequest != nil {
		values["nrr"] = quote(*out.NextRangeRequest)
	}
	if out.ObjectType != nil {
		values["ot"] = string(*out.ObjectType)
	}
	if out.PlaybackRate != nil {
		values["pr"] = strconv.FormatFloat(*out.PlaybackRate, 'f', -1, 64)
	}
	if out.RequestedThroughputKbps != nil && out.RequestedThroughputKbps.Scalar != nil {
		values["rtp"] = strconv.FormatInt(*out.RequestedThroughputKbps.Scalar, 10)
	}
	if out.StreamingFormat != nil {
		values["sf"] = string(*out.StreamingFormat)
	}
	if out.SessionID != nil {
		values["sid"] = quote(*out.SessionID)
	}
	if out.StreamType != nil {
		values["st"] = string(*out.StreamType)
	}
	if out.Startup != nil && *out.Startup {
		values["su"] = ""
	}
	if out.TopBitrateKbps != nil && out.TopBitrateKbps.Scalar != nil {
		values["tb"] = strconv.FormatInt(*out.TopBitrateKbps.Scalar, 10)
	}
	for key, value := range out.Custom {
		values[key] = formatCustom(value)
	}
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		if values[key] == "" {
			parts = append(parts, key)
		} else {
			parts = append(parts, key+"="+values[key])
		}
	}
	return strings.Join(parts, ",")
}

func encodeURIComponent(value string) string {
	const hex = "0123456789ABCDEF"
	var builder strings.Builder
	for _, b := range []byte(value) {
		if (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') || strings.ContainsRune("-_.!~*'()", rune(b)) {
			builder.WriteByte(b)
			continue
		}
		builder.WriteByte('%')
		builder.WriteByte(hex[b>>4])
		builder.WriteByte(hex[b&0x0f])
	}
	return builder.String()
}

func quote(value string) string {
	return `"` + strings.ReplaceAll(strings.ReplaceAll(value, `\`, `\\`), `"`, `\"`) + `"`
}

func formatCustom(value CustomValue) string {
	switch value.Kind {
	case CustomBoolean:
		return ""
	case CustomInteger:
		return strconv.FormatInt(*value.Integer, 10)
	case CustomDecimal:
		return strconv.FormatFloat(*value.Decimal, 'f', -1, 64)
	case CustomString:
		return quote(*value.String)
	case CustomToken:
		return *value.Token
	default:
		return ""
	}
}
