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
	rng *rand.Rand
}

func NewChaos() *Chaos {
	return &Chaos{
		rng: rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

// Apply evaluates the request against the active preset and, when a fault is
// triggered, writes the error response itself and returns true. When it returns
// false the caller should proceed with the normal proxying path.
func (c *Chaos) Apply(w http.ResponseWriter, r *http.Request, isManifest bool, preset string) bool {
	switch preset {
	case presetSubway3G:
		if isManifest {
			return false
		}
		delay := 1500 + c.rng.Intn(1501) // 1500ms..3000ms
		time.Sleep(time.Duration(delay) * time.Millisecond)
		if c.rng.Float64() < 0.10 {
			http.Error(w, "subway_3g: induced HTTP 504 Gateway Timeout", http.StatusGatewayTimeout)
			return true
		}
	case presetCDNDegradation:
		if isManifest {
			return false
		}
		if c.rng.Float64() < 0.20 {
			http.Error(w, "cdn_degradation: induced HTTP 500 Internal Server Error", http.StatusInternalServerError)
			return true
		}
	case presetStaleLiveManifest:
		if isManifest {
			time.Sleep(4 * time.Second)
		}
	}
	return false
}
