package proxy

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"streammock/internal/config"
	"streammock/internal/db"
	"streammock/internal/models"
	"streammock/internal/store"
)

func TestClearKeyLicenseReturnsOnlyRequestedStreamKey(t *testing.T) {
	database, err := db.Open(filepath.Join(t.TempDir(), "license.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := database.Migrate(); err != nil {
		t.Fatal(err)
	}
	streams := store.New(database)
	now := time.Now().UTC()
	licensePath := "/s/protected/license/clearkey"
	stream := models.Stream{ID: "protected", OriginalURL: "https://origin.example/master.m3u8", ProxyPath: "/s/protected/master.m3u8", ActivePreset: "clean", Mode: models.ModeClone, CaptureStatus: models.CaptureReady, RequestedDurationSeconds: 60, Format: models.FormatHLS, ProtectionMode: models.ProtectionClearKey, TrackSelection: models.TracksAll, LicensePath: &licensePath, CaptureProgress: 100, CreatedAt: now, UpdatedAt: now}
	if err := streams.Add(stream, true); err != nil {
		t.Fatal(err)
	}
	key := models.DRMKey{StreamID: stream.ID, KIDHex: "102b08cb433d5563ad2b501e05572e50", KeyHex: "3ed2014066b1421558239f723700021b", Label: "STREAMMOCK"}
	if err := streams.AddDRMKey(key); err != nil {
		t.Fatal(err)
	}

	engine := NewEngine(config.Config{}, streams, NewChaos())
	mux := http.NewServeMux()
	engine.Register(mux)
	kid, _ := hex.DecodeString(key.KIDHex)
	body, _ := json.Marshal(map[string]any{"kids": []string{base64.RawURLEncoding.EncodeToString(kid)}, "type": "temporary"})
	request := httptest.NewRequest(http.MethodPost, licensePath, bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var decoded clearKeyResponse
	if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
		t.Fatal(err)
	}
	wantKey, _ := hex.DecodeString(key.KeyHex)
	if len(decoded.Keys) != 1 || decoded.Keys[0].KID != base64.RawURLEncoding.EncodeToString(kid) || decoded.Keys[0].Key != base64.RawURLEncoding.EncodeToString(wantKey) {
		t.Fatalf("unexpected license: %+v", decoded)
	}
	if response.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatal("license response misses CORS")
	}
}
