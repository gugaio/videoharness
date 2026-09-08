package ratelimit

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestAllowBurstsThenRejects(t *testing.T) {
	l := New(60, 3)
	for i := 0; i < 3; i++ {
		if !l.Allow("ip1") {
			t.Fatalf("request %d should pass within burst", i+1)
		}
	}
	if l.Allow("ip1") {
		t.Fatal("fourth request should be rejected once burst is spent")
	}
	if !l.Allow("ip2") {
		t.Fatal("different key must have its own bucket")
	}
}

func TestRefillsOverTime(t *testing.T) {
	l := New(60, 2) // one token per second
	now := time.Unix(0, 0)
	l.now = func() time.Time { return now }

	if !l.Allow("k") || !l.Allow("k") {
		t.Fatal("burst tokens should be available")
	}
	if l.Allow("k") {
		t.Fatal("burst exhausted")
	}
	now = now.Add(2 * time.Second) // refill exactly two tokens
	if !l.Allow("k") || !l.Allow("k") {
		t.Fatal("tokens should refill at the configured rate")
	}
}

func TestCleanupEvictsIdleBuckets(t *testing.T) {
	l := New(60, 5)
	now := time.Now()
	l.now = func() time.Time { return now }
	_ = l.Allow("old")
	now = now.Add(time.Hour)
	_ = l.Allow("fresh")
	l.Cleanup(10 * time.Minute)
	l.mu.Lock()
	_, oldExists := l.buckets["old"]
	_, freshExists := l.buckets["fresh"]
	l.mu.Unlock()
	if oldExists {
		t.Fatal("idle bucket should have been evicted")
	}
	if !freshExists {
		t.Fatal("active bucket should survive cleanup")
	}
}

func TestClientIPFallsBackToRemoteAddr(t *testing.T) {
	r := httptest.NewRequest("GET", "/p.m3u8", nil)
	r.RemoteAddr = "203.0.113.9:55555"
	if got := ClientIP(r); got != "203.0.113.9" {
		t.Fatalf("ClientIP = %q, want 203.0.113.9", got)
	}
	r.Header.Set("X-Forwarded-For", "198.51.100.7, 10.0.0.1")
	if got := ClientIP(r); got != "198.51.100.7" {
		t.Fatalf("ClientIP with XFF = %q, want first hop", got)
	}
}
