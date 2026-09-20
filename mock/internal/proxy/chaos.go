package proxy

import (
	"math/rand"
	"net/http"
	"sync"
	"time"
)

const (
	presetClean             = "clean"
	presetSubway3G          = "subway_3g"
	presetCDNDegradation    = "cdn_degradation"
	presetStaleLiveManifest = "stale_live_manifest"
)

type Chaos struct {
	mu              sync.Mutex
	rng             *rand.Rand
	sleep           func(time.Duration)
	licenseAttempts map[string]int
}

func NewChaos() *Chaos {
	return &Chaos{
		rng:             rand.New(rand.NewSource(time.Now().UnixNano())),
		sleep:           time.Sleep,
		licenseAttempts: make(map[string]int),
	}
}

type chaosEffect struct {
	addedLatency    time.Duration
	injectedStatus  int
	bytesPerSecond  int64
	name            string
	corruptKey      bool
	malformedBody   bool
}

func (e chaosEffect) handled() bool {
	return e.injectedStatus != 0
}

func (e chaosEffect) intervention() string {
	if e.name != "" {
		return e.name
	}
	name := ""
	if e.bytesPerSecond > 0 {
		name = "bandwidth"
	}
	if e.addedLatency > 0 {
		if name == "" {
			name = "latency"
		} else {
			name = "bandwidth_latency"
		}
	}
	if e.injectedStatus != 0 {
		if name == "" {
			name = "http_error"
		} else {
			name += "_and_http_error"
		}
	}
	return name
}

func (c *Chaos) intn(n int) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.rng.Intn(n)
}

func (c *Chaos) float64() float64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.rng.Float64()
}

func (c *Chaos) addLatency(delay time.Duration) {
	if c.sleep != nil {
		c.sleep(delay)
		return
	}
	time.Sleep(delay)
}

// Apply evaluates the request against the active preset and, when a fault is
// triggered, writes the error response itself and reports the exact effect.
// When no status is injected the caller should proceed with normal proxying.
func (c *Chaos) Apply(w http.ResponseWriter, r *http.Request, isManifest bool, preset string) chaosEffect {
	effect := chaosEffect{}
	switch preset {
	case presetSubway3G:
		if isManifest {
			return effect
		}
		// Shaped throughput is the binding constraint so the player's ABR
		// observes a genuinely narrow pipe; latency stays modest and the
		// intermittent 504 keeps the "subway" character.
		effect.bytesPerSecond = int64(150_000 + c.intn(150_001)) // 1.2-2.4 Mbps
		delay := 100 + c.intn(301)                               // 100ms..400ms
		effect.addedLatency = time.Duration(delay) * time.Millisecond
		c.addLatency(effect.addedLatency)
		if c.float64() < 0.10 {
			effect.injectedStatus = http.StatusGatewayTimeout
			http.Error(w, "subway_3g: induced HTTP 504 Gateway Timeout", effect.injectedStatus)
			return effect
		}
	case presetCDNDegradation:
		if isManifest {
			return effect
		}
		if c.float64() < 0.20 {
			effect.injectedStatus = http.StatusInternalServerError
			http.Error(w, "cdn_degradation: induced HTTP 500 Internal Server Error", effect.injectedStatus)
			return effect
		}
	case presetStaleLiveManifest:
		if isManifest {
			effect.addedLatency = 4 * time.Second
			c.addLatency(effect.addedLatency)
		}
	}
	return effect
}

// ApplyLicense extends the normal playback presets with deterministic DRM
// failure modes. It keeps retry state per stream so the recovery preset is
// reproducible and useful in browser tests.
func (c *Chaos) ApplyLicense(w http.ResponseWriter, r *http.Request, streamID, preset string) chaosEffect {
	effect := chaosEffect{}
	switch preset {
	case "drm_license_latency":
		effect.addedLatency = 3 * time.Second
		effect.name = "license_latency"
		c.addLatency(effect.addedLatency)
	case "drm_license_failure":
		effect.injectedStatus = http.StatusServiceUnavailable
		effect.name = "license_http_error"
		http.Error(w, "drm_license_failure: induced HTTP 503", effect.injectedStatus)
	case "drm_license_recovery":
		c.mu.Lock()
		c.licenseAttempts[streamID]++
		attempt := c.licenseAttempts[streamID]
		c.mu.Unlock()
		if attempt <= 2 {
			effect.injectedStatus = http.StatusServiceUnavailable
			effect.name = "license_retry"
			http.Error(w, "drm_license_recovery: retry the license request", effect.injectedStatus)
		}
	case "drm_wrong_key":
		effect.corruptKey = true
		effect.name = "wrong_clearkey"
	case "drm_malformed_license":
		effect.malformedBody = true
		effect.name = "malformed_license"
	default:
		// Existing network presets also affect license delivery so a session can
		// exercise combined media and DRM failures.
		return c.Apply(w, r, false, preset)
	}
	return effect
}
