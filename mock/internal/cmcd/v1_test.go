package cmcd

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"
)

type fixture struct {
	Name   string        `json:"name"`
	URL    string        `json:"url"`
	Want   fixtureOutput `json:"want"`
	Issues []Issue       `json:"issues"`
}

type fixtureOutput struct {
	Present                 bool                     `json:"present"`
	Version                 Version                  `json:"version"`
	RawValue                string                   `json:"raw_value"`
	CanonicalValue          string                   `json:"canonical_value"`
	SessionID               *string                  `json:"sid,omitempty"`
	ContentID               *string                  `json:"cid,omitempty"`
	ObjectType              *ObjectType              `json:"ot,omitempty"`
	StreamingFormat         *StreamingFormat         `json:"sf,omitempty"`
	StreamType              *StreamType              `json:"st,omitempty"`
	BitrateKbps             *int64                   `json:"br_kbps,omitempty"`
	TopBitrateKbps          *int64                   `json:"tb_kbps,omitempty"`
	MeasuredThroughputKbps  *int64                   `json:"mtp_kbps,omitempty"`
	RequestedThroughputKbps *int64                   `json:"rtp_kbps,omitempty"`
	BufferLengthMS          *int64                   `json:"bl_ms,omitempty"`
	DeadlineMS              *int64                   `json:"dl_ms,omitempty"`
	ObjectDurationMS        *int64                   `json:"object_duration_ms,omitempty"`
	PlaybackRate            *float64                 `json:"playback_rate,omitempty"`
	NextObjectRequest       *string                  `json:"nor,omitempty"`
	NextRangeRequest        *string                  `json:"nrr,omitempty"`
	Startup                 *bool                    `json:"startup,omitempty"`
	BufferStarvation        *bool                    `json:"buffer_starvation,omitempty"`
	Custom                  map[string]fixtureCustom `json:"custom,omitempty"`
}

type fixtureCustom struct {
	Kind    CustomValueKind `json:"kind"`
	Boolean *bool           `json:"boolean,omitempty"`
	Integer *int64          `json:"integer,omitempty"`
	Decimal *float64        `json:"decimal,omitempty"`
	String  *string         `json:"string,omitempty"`
	Token   *string         `json:"token,omitempty"`
}

func TestV1DecoderFixtures(t *testing.T) {
	paths, err := filepath.Glob("testdata/*.json")
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) == 0 {
		t.Fatal("no CMCD fixtures found")
	}
	decoder := NewV1Decoder(DefaultLimits())
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var fx fixture
		if err := json.Unmarshal(data, &fx); err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		t.Run(fx.Name, func(t *testing.T) {
			req := httptest.NewRequest("GET", fx.URL, nil)
			originalURL := req.URL.String()
			got, err := decoder.DecodeRequest(req)
			if req.URL.String() != originalURL {
				t.Fatalf("decoder mutated request URL: got %q want %q", req.URL.String(), originalURL)
			}
			if actual := fixtureFromNormalized(got); !reflect.DeepEqual(actual, fx.Want) {
				gotJSON, _ := json.MarshalIndent(actual, "", "  ")
				wantJSON, _ := json.MarshalIndent(fx.Want, "", "  ")
				t.Fatalf("normalized output mismatch\n got: %s\nwant: %s", gotJSON, wantJSON)
			}
			var validation *ValidationError
			if len(fx.Issues) == 0 {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if !errors.As(err, &validation) {
				t.Fatalf("error = %v, want ValidationError", err)
			}
			if !reflect.DeepEqual(validation.Issues, fx.Issues) {
				t.Fatalf("issues = %#v, want %#v", validation.Issues, fx.Issues)
			}
		})
	}
}

func TestDecoderImplementationsSatisfyContract(t *testing.T) {
	var decoder Decoder = NewV1Decoder(DefaultLimits())
	if decoder == nil {
		t.Fatal("decoder is nil")
	}
}

func TestV1DecoderLimitsAndMalformedQuery(t *testing.T) {
	decoder := NewV1Decoder(DefaultLimits())
	cases := []struct {
		name  string
		query string
		want  []Issue
	}{
		{"oversized payload", "CMCD=" + strings.Repeat("a", DefaultLimits().MaxRawValueBytes+1), []Issue{{Code: IssuePayloadTooLarge}}},
		{"oversized custom string", "CMCD=com.example-label%3D%22" + strings.Repeat("a", DefaultLimits().MaxStringBytes+1) + "%22", []Issue{{Code: IssueStringTooLong, Key: "com.example-label"}}},
		{"too many custom keys", "CMCD=" + manyCustomKeys(DefaultLimits().MaxCustomKeys+1), []Issue{{Code: IssueTooManyCustomKeys}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := decoder.DecodeRequest(httptest.NewRequest("GET", "/?"+tc.query, nil))
			var validation *ValidationError
			if !errors.As(err, &validation) || !reflect.DeepEqual(validation.Issues, tc.want) {
				t.Fatalf("issues = %#v, want %#v", validation, tc.want)
			}
		})
	}
	request := httptest.NewRequest("GET", "/", nil)
	request.URL = &url.URL{Path: "/", RawQuery: "CMCD=%"}
	_, err := decoder.DecodeRequest(request)
	var validation *ValidationError
	if !errors.As(err, &validation) || !reflect.DeepEqual(validation.Issues, []Issue{{Code: IssueBadQueryEncoding, Key: QueryParameter}}) {
		t.Fatalf("malformed query issues = %#v", validation)
	}
}

func TestV1DecoderLimitBoundaries(t *testing.T) {
	defaults := DefaultLimits()
	decoder := NewV1Decoder(defaults)

	exactString := strings.Repeat("a", defaults.MaxStringBytes)
	if _, err := decoder.DecodeRequest(requestWithCMCD(`com.example-label="` + exactString + `"`)); err != nil {
		t.Fatalf("string at limit rejected: %v", err)
	}

	exactSessionID := strings.Repeat("s", defaults.MaxSessionIDRunes)
	if _, err := decoder.DecodeRequest(requestWithCMCD(`sid="` + exactSessionID + `"`)); err != nil {
		t.Fatalf("sid at limit rejected: %v", err)
	}

	keyTooLong := strings.Repeat("a", defaults.MaxKeyBytes-1) + "-x"
	assertIssues(t, decoder, keyTooLong, []Issue{{Code: IssueKeyTooLong, Key: keyTooLong}})

	keyLimits := defaults
	keyLimits.MaxCustomKeys = defaults.MaxKeys + 1
	keyDecoder := NewV1Decoder(keyLimits)
	if _, err := keyDecoder.DecodeRequest(requestWithCMCD(manyCustomKeys(defaults.MaxKeys))); err != nil {
		t.Fatalf("payload at key-count limit rejected: %v", err)
	}
	assertIssues(t, keyDecoder, manyCustomKeys(defaults.MaxKeys+1), []Issue{{Code: IssueTooManyKeys}})

	rawLimits := defaults
	rawLimits.MaxRawValueBytes = len(`sid="s"`)
	rawDecoder := NewV1Decoder(rawLimits)
	if _, err := rawDecoder.DecodeRequest(requestWithCMCD(`sid="s"`)); err != nil {
		t.Fatalf("payload at raw limit rejected: %v", err)
	}
	assertIssues(t, rawDecoder, `sid="ss"`, []Issue{{Code: IssuePayloadTooLarge}})
}

func TestV1DecoderAcceptsLongNextObjectRequest(t *testing.T) {
	defaults := DefaultLimits()
	decoder := NewV1Decoder(defaults)

	// Players such as hls.js base64url-encode the next segment URL into nor
	// (CTA-5004-B); signed CDN URLs routinely exceed 1 KiB.
	nor := "aHR0cDovL2xpdmUtYmVyLnZpZGVvLmdsb2JvLmNvbS9zZWdtZW50cy8" + strings.Repeat("Q", 1200)
	got, err := decoder.DecodeRequest(requestWithCMCD(`nor="` + nor + `"`))
	if err != nil {
		t.Fatalf("long nor rejected: %v", err)
	}
	if got.NextObjectRequest == nil || *got.NextObjectRequest != nor {
		t.Fatalf("nor was not preserved")
	}

	assertIssues(t, decoder, `nor="`+strings.Repeat("Q", defaults.MaxStringBytes+1)+`"`, []Issue{{Code: IssueStringTooLong, Key: "nor"}})
}

func TestV1DecoderValidatesRequiredHundredIncrements(t *testing.T) {
	decoder := NewV1Decoder(DefaultLimits())
	for _, key := range []string{"bl", "dl", "mtp", "rtp"} {
		t.Run(key, func(t *testing.T) {
			assertIssues(t, decoder, key+"=150", []Issue{{Code: IssueInvalidIncrement, Key: key}})
		})
	}
}

func TestV1DecoderAcceptsCMCDV1RangeForms(t *testing.T) {
	decoder := NewV1Decoder(DefaultLimits())
	for _, value := range []string{"10-", "10-20", "-20"} {
		t.Run(value, func(t *testing.T) {
			got, err := decoder.DecodeRequest(requestWithCMCD(`nrr="` + value + `"`))
			if err != nil {
				t.Fatal(err)
			}
			if got.NextRangeRequest == nil || *got.NextRangeRequest != value {
				t.Fatalf("nrr = %v, want %q", got.NextRangeRequest, value)
			}
		})
	}
	for _, value := range []string{"-", "10--20", "20-10", "-0", "+1-2", "1-a"} {
		t.Run("invalid_"+value, func(t *testing.T) {
			assertIssues(t, decoder, `nrr="`+value+`"`, []Issue{{Code: IssueInvalidRange, Key: "nrr"}})
		})
	}
}

func TestV1DecoderRejectsInvalidUTF8(t *testing.T) {
	decoder := NewV1Decoder(DefaultLimits())
	request := httptest.NewRequest("GET", "/", nil)
	request.URL = &url.URL{Path: "/", RawQuery: "CMCD=%FF"}
	_, err := decoder.DecodeRequest(request)
	var validation *ValidationError
	if !errors.As(err, &validation) || !reflect.DeepEqual(validation.Issues, []Issue{{Code: IssueInvalidUTF8}}) {
		t.Fatalf("invalid UTF-8 issues = %#v", validation)
	}
}

func FuzzV1Decoder(f *testing.F) {
	for _, seed := range []string{
		"CMCD=br%3D3200%2Csid%3D%22seed%22",
		"CMCD=cid%3D%22unterminated",
		"CMCD=%25",
		"CMCD=bs%2Csu",
	} {
		f.Add(seed)
	}
	decoder := NewV1Decoder(DefaultLimits())
	f.Fuzz(func(t *testing.T, rawQuery string) {
		if len(rawQuery) > 32*1024 {
			t.Skip()
		}
		req := httptest.NewRequest("GET", "/s/test/master.m3u8?"+rawQuery, nil)
		_, _ = decoder.DecodeRequest(req)
	})
}

func fixtureFromNormalized(value NormalizedCMCD) fixtureOutput {
	output := fixtureOutput{
		Present: value.Present, Version: value.Version, RawValue: value.RawValue, CanonicalValue: value.CanonicalValue,
		SessionID: value.SessionID, ContentID: value.ContentID, ObjectType: value.ObjectType,
		StreamingFormat: value.StreamingFormat, StreamType: value.StreamType, DeadlineMS: value.DeadlineMS,
		ObjectDurationMS: value.ObjectDurationMS, PlaybackRate: value.PlaybackRate, NextObjectRequest: value.NextObjectRequest,
		NextRangeRequest: value.NextRangeRequest, Startup: value.Startup, BufferStarvation: value.BufferStarvation,
	}
	if value.BitrateKbps != nil {
		output.BitrateKbps = value.BitrateKbps.Scalar
	}
	if value.TopBitrateKbps != nil {
		output.TopBitrateKbps = value.TopBitrateKbps.Scalar
	}
	if value.MeasuredThroughputKbps != nil {
		output.MeasuredThroughputKbps = value.MeasuredThroughputKbps.Scalar
	}
	if value.RequestedThroughputKbps != nil {
		output.RequestedThroughputKbps = value.RequestedThroughputKbps.Scalar
	}
	if value.BufferLengthMS != nil {
		output.BufferLengthMS = value.BufferLengthMS.Scalar
	}
	if len(value.Custom) > 0 {
		output.Custom = make(map[string]fixtureCustom, len(value.Custom))
		for key, custom := range value.Custom {
			output.Custom[key] = fixtureCustom{Kind: custom.Kind, Boolean: custom.Boolean, Integer: custom.Integer, Decimal: custom.Decimal, String: custom.String, Token: custom.Token}
		}
	}
	return output
}

func TestCanonicalOrderIsDeterministic(t *testing.T) {
	decoder := NewV1Decoder(DefaultLimits())
	values := []string{
		"CMCD=su%2Cbr%3D3200%2Ccid%3D%22content%22%2Ccom.example-z%3D1%2Ccom.example-a",
		"CMCD=com.example-a%2Ccid%3D%22content%22%2Ccom.example-z%3D1%2Cbr%3D3200%2Csu",
	}
	canonical := make([]string, 0, len(values))
	for _, query := range values {
		got, err := decoder.DecodeRequest(httptest.NewRequest("GET", "/?"+query, nil))
		if err != nil {
			t.Fatal(err)
		}
		canonical = append(canonical, got.CanonicalValue)
	}
	if canonical[0] != canonical[1] {
		t.Fatalf("canonical values differ: %q vs %q", canonical[0], canonical[1])
	}
	parts := strings.Split(canonical[0], ",")
	sorted := append([]string(nil), parts...)
	sort.Strings(sorted)
	if !reflect.DeepEqual(parts, sorted) {
		t.Fatalf("canonical fields are not sorted: %q", canonical[0])
	}
}

func manyCustomKeys(count int) string {
	parts := make([]string, 0, count)
	for i := 0; i < count; i++ {
		parts = append(parts, "com.example-"+strconv.Itoa(i))
	}
	return strings.Join(parts, ",")
}

func requestWithCMCD(raw string) *http.Request {
	return httptest.NewRequest("GET", "/?CMCD="+url.QueryEscape(raw), nil)
}

func assertIssues(t *testing.T, decoder Decoder, raw string, want []Issue) {
	t.Helper()
	_, err := decoder.DecodeRequest(requestWithCMCD(raw))
	var validation *ValidationError
	if !errors.As(err, &validation) || !reflect.DeepEqual(validation.Issues, want) {
		t.Fatalf("issues = %#v, want %#v", validation, want)
	}
}
