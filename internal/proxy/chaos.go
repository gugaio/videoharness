package proxy

import (
	"math/rand"
	"net/http"
	"time"
)

const (
	presetClean             = "clean"
	presetSubway3G          = "subway_3g"
	presetCDNDegradation    = "cdn_degradation"
	presetStaleLiveManifest = "stale_live_manifest"
)

type Chaos struct {
	rng   *rand.Rand
	sleep func(time.Duration)
}

func NewChaos() *Chaos {
	return &Chaos{
		rng:   rand.New(rand.NewSource(time.Now().UnixNano())),
		sleep: time.Sleep,
	}
}

type chaosEffect struct {
	addedLatency   time.Duration
	injectedStatus int
}

func (e chaosEffect) handled() bool {
	return e.injectedStatus != 0
}

func (e chaosEffect) intervention() string {
	switch {
	case e.addedLatency > 0 && e.injectedStatus != 0:
		return "latency_and_http_error"
	case e.addedLatency > 0:
		return "latency"
	case e.injectedStatus != 0:
		return "http_error"
	default:
		return ""
	}
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
		delay := 1500 + c.rng.Intn(1501) // 1500ms..3000ms
		effect.addedLatency = time.Duration(delay) * time.Millisecond
		c.addLatency(effect.addedLatency)
		if c.rng.Float64() < 0.10 {
			effect.injectedStatus = http.StatusGatewayTimeout
			http.Error(w, "subway_3g: induced HTTP 504 Gateway Timeout", effect.injectedStatus)
			return effect
		}
	case presetCDNDegradation:
		if isManifest {
			return effect
		}
		if c.rng.Float64() < 0.20 {
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
