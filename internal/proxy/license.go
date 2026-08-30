package proxy

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"

	"streammock/internal/models"
	"streammock/internal/ratelimit"
)

const maxClearKeyRequestBytes = 16 << 10

type clearKeyRequest struct {
	Kids []string `json:"kids"`
	Type string   `json:"type"`
}

type clearKeyResponse struct {
	Keys []clearKeyResponseKey `json:"keys"`
	Type string                `json:"type"`
}

type clearKeyResponseKey struct {
	KTY string `json:"kty"`
	KID string `json:"kid"`
	Key string `json:"k"`
}

func handleLicensePreflight(w http.ResponseWriter, _ *http.Request) {
	setCORS(w.Header())
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Origin, Content-Type")
	w.Header().Set("Access-Control-Max-Age", "86400")
	w.WriteHeader(http.StatusNoContent)
}

func (e *Engine) serveClearKeyLicense(w http.ResponseWriter, r *http.Request) {
	st, ok := e.store.Get(r.PathValue("id"))
	if !ok || st.Mode != models.ModeClone || st.ProtectionMode != models.ProtectionClearKey {
		http.NotFound(w, r)
		return
	}
	sw, done := e.track(w, r, st, models.KindLicense, "clearkey")
	defer done()
	setCORS(sw.Header())
	sw.Header().Set("Cache-Control", "no-store")
	sw.Header().Set("Content-Type", "application/json")
	if e.licenseLimiter != nil && !e.licenseLimiter.Allow(ratelimit.ClientIP(r)) {
		sw.Header().Set("Retry-After", "1")
		http.Error(sw, "ClearKey license rate limit exceeded", http.StatusTooManyRequests)
		return
	}

	if st.CaptureStatus != models.CaptureReady {
		http.Error(sw, "clone is not ready", http.StatusConflict)
		return
	}
	contentType := strings.ToLower(r.Header.Get("Content-Type"))
	if contentType != "" && !strings.HasPrefix(contentType, "application/json") {
		http.Error(sw, "ClearKey requests must use application/json", http.StatusUnsupportedMediaType)
		return
	}
	r.Body = http.MaxBytesReader(sw, r.Body, maxClearKeyRequestBytes)
	var request clearKeyRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil || len(request.Kids) == 0 {
		http.Error(sw, "invalid ClearKey license request", http.StatusBadRequest)
		return
	}

	effect := e.chaos.ApplyLicense(sw, r, st.ID, st.ActivePreset)
	sw.intervention = effect.intervention()
	sw.addedLatencyMS = effect.addedLatency.Milliseconds()
	sw.injectedStatus = effect.injectedStatus
	if effect.handled() {
		return
	}
	if effect.malformedBody {
		_, _ = sw.Write([]byte(`{"keys":`))
		return
	}

	stored, err := e.store.DRMKeys(st.ID)
	if err != nil {
		http.Error(sw, "failed to load ClearKey license", http.StatusInternalServerError)
		return
	}
	byKID := make(map[string]models.DRMKey, len(stored))
	for _, key := range stored {
		byKID[strings.ToLower(key.KIDHex)] = key
	}
	response := clearKeyResponse{Keys: make([]clearKeyResponseKey, 0, len(request.Kids)), Type: request.Type}
	if response.Type == "" {
		response.Type = "temporary"
	}
	seen := make(map[string]struct{})
	for _, encodedKID := range request.Kids {
		kidBytes, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(encodedKID, "="))
		if err != nil || len(kidBytes) != 16 {
			http.Error(sw, "invalid ClearKey KID", http.StatusBadRequest)
			return
		}
		kidHex := hex.EncodeToString(kidBytes)
		if _, duplicate := seen[kidHex]; duplicate {
			continue
		}
		seen[kidHex] = struct{}{}
		storedKey, exists := byKID[kidHex]
		if !exists {
			continue
		}
		keyBytes, err := hex.DecodeString(storedKey.KeyHex)
		if err != nil || len(keyBytes) != 16 {
			http.Error(sw, "invalid stored ClearKey", http.StatusInternalServerError)
			return
		}
		if effect.corruptKey {
			keyBytes[len(keyBytes)-1] ^= 0xff
		}
		response.Keys = append(response.Keys, clearKeyResponseKey{
			KTY: "oct", KID: base64.RawURLEncoding.EncodeToString(kidBytes), Key: base64.RawURLEncoding.EncodeToString(keyBytes),
		})
	}
	_ = json.NewEncoder(sw).Encode(response)
}
