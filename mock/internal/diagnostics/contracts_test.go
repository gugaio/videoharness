package diagnostics

import (
	"encoding/json"
	"testing"
)

func TestFindingContractUsesExplicitEvidenceAndUnits(t *testing.T) {
	finding := Finding{
		RuleID: "deadline_miss", RuleVersion: 1, Severity: SeverityWarning, Confidence: ConfidenceMedium,
		Message:      "Request completed after its CMCD deadline.",
		Evidence:     []EvidenceReference{{Kind: EvidenceRequest, ID: "42"}},
		Measurements: []Measurement{{Name: "request_total", Value: 1500, Unit: UnitMilliseconds}, {Name: "deadline", Value: 700, Unit: UnitMilliseconds}},
	}
	data, err := json.Marshal(finding)
	if err != nil {
		t.Fatal(err)
	}
	var decoded Finding
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Confidence != ConfidenceMedium || decoded.Evidence[0].Kind != EvidenceRequest || decoded.Measurements[0].Unit != UnitMilliseconds {
		t.Fatalf("unexpected round trip: %#v", decoded)
	}
}
