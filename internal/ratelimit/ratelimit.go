// Package ratelimit implements a small in-memory token bucket limiter keyed by
// arbitrary strings (usually client IPs). It is meant to protect public
// endpoints from abuse without external dependencies.
package ratelimit

import (
	"context"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Limiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    float64 // tokens per second
	burst   float64
	now     func() time.Time
}

type bucket struct {
	tokens float64
	last   time.Time
}

// New returns a limiter refilling at ratePerMinute tokens per minute with a
// maximum burst capacity.
func New(ratePerMinute float64, burst int) *Limiter {
	if ratePerMinute <= 0 {
		ratePerMinute = 60
	}
	if burst <= 0 {
		burst = int(ratePerMinute)
	}
	return &Limiter{
		buckets: make(map[string]*bucket),
		rate:    ratePerMinute / 60,
		burst:   float64(burst),
		now:     time.Now,
	}
}

// Allow reports whether key may proceed, consuming one token.
func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	b, ok := l.buckets[key]
	if !ok {
		l.buckets[key] = &bucket{tokens: l.burst - 1, last: now}
		return true
	}
	b.tokens += now.Sub(b.last).Seconds() * l.rate
	if b.tokens > l.burst {
		b.tokens = l.burst
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// StartCleanup periodically evicts buckets idle for more than maxAge. Blocks
// until ctx is cancelled.
func (l *Limiter) StartCleanup(ctx context.Context, interval, maxAge time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			l.Cleanup(maxAge)
		}
	}
}

func (l *Limiter) Cleanup(maxAge time.Duration) {
	cutoff := l.now().Add(-maxAge)
	l.mu.Lock()
	defer l.mu.Unlock()
	for key, b := range l.buckets {
		if b.last.Before(cutoff) {
			delete(l.buckets, key)
		}
	}
}

// ClientIP extracts the best-guess client address for rate limiting: the first
// X-Forwarded-For hop when present (reverse proxy setups), otherwise the
// remote socket address.
func ClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		first, _, _ := strings.Cut(xff, ",")
		if ip := strings.TrimSpace(first); ip != "" {
			return ip
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// ParsePositiveFloat parses s as a positive float64, returning fallback when
// s is empty.
func ParsePositiveFloat(s string, fallback float64) (float64, error) {
	if strings.TrimSpace(s) == "" {
		return fallback, nil
	}
	v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil || v <= 0 {
		return 0, strconv.ErrSyntax
	}
	return v, nil
}

// ParsePositiveInt parses s as a positive int, returning fallback when s is
// empty.
func ParsePositiveInt(s string, fallback int) (int, error) {
	if strings.TrimSpace(s) == "" {
		return fallback, nil
	}
	v, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil || v <= 0 {
		return 0, strconv.ErrSyntax
	}
	return v, nil
}
