package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Addr               string
	DBPath             string
	TruncateSeconds    float64
	StorageDir         string
	CloneMaxBytes      int64
	BBBDemoURL         string
	HTTPTimeout        time.Duration
	ClerkSecretKey     string
	RateLimitPerMinute float64
	RateLimitBurst     int
	EphemeralTTL       time.Duration
	SweeperInterval    time.Duration
}

func Load() Config {
	loadEnvFiles(".env", ".env.local")
	return Config{
		Addr:            envOr("STREAMMOCK_ADDR", ":8080"),
		DBPath:          envOr("STREAMMOCK_DB", "streammock.db"),
		TruncateSeconds: 60.0,
		StorageDir:      envOr("STREAMMOCK_STORAGE", "streammock-data"),
		CloneMaxBytes:   1 << 30,
		BBBDemoURL:      envOr("STREAMMOCK_BBB_URL", "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"),
		HTTPTimeout:     30 * time.Second,
		ClerkSecretKey:  envOr("CLERK_SECRET_KEY", ""),

		RateLimitPerMinute: envFloat("STREAMMOCK_RATELIMIT_RPM", 10),
		RateLimitBurst:     envInt("STREAMMOCK_RATELIMIT_BURST", 5),
		EphemeralTTL:       time.Duration(envInt("STREAMMOCK_EPHEMERAL_TTL_MINUTES", 60)) * time.Minute,
		SweeperInterval:    10 * time.Minute,
	}
}

func envFloat(key string, fallback float64) float64 {
	if v := os.Getenv(key); v != "" {
		if parsed, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil && parsed > 0 {
			return parsed
		}
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if parsed, err := strconv.Atoi(strings.TrimSpace(v)); err == nil && parsed > 0 {
			return parsed
		}
	}
	return fallback
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// loadEnvFiles sources KEY=VALUE files (e.g. .env.local written by `clerk env
// pull`) without overriding variables already set in the process environment.
func loadEnvFiles(paths ...string) {
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			k, v, ok := strings.Cut(line, "=")
			if !ok {
				continue
			}
			k = strings.TrimSpace(k)
			if os.Getenv(k) != "" {
				continue
			}
			os.Setenv(k, strings.Trim(strings.TrimSpace(v), `"'`))
		}
	}
}
