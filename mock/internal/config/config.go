package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Addr                      string
	DBPath                    string
	TruncateSeconds           float64
	StorageDir                string
	CloneMaxBytes             int64
	UserQuotaBytes            int64
	CloneTTL                  time.Duration
	CloneJanitorInterval      time.Duration
	PackagerBinary            string
	PackagerTimeout           time.Duration
	BBBDemoURL                string
	HTTPTimeout               time.Duration
	ClerkSecretKey            string
	ServiceToken              string
	RateLimitPerMinute        float64
	RateLimitBurst            int
	LicenseRateLimitPerMinute float64
	LicenseRateLimitBurst     int
	EphemeralTTL              time.Duration
	SweeperInterval           time.Duration
}

func Load() Config {
	loadEnvFiles(".env", ".env.local")
	return Config{
		Addr:                 envOr("STREAMMOCK_ADDR", ":8080"),
		DBPath:               envOr("STREAMMOCK_DB", "streammock.db"),
		TruncateSeconds:      60.0,
		StorageDir:           envOr("STREAMMOCK_STORAGE", "streammock-data"),
		CloneMaxBytes:        envInt64("STREAMMOCK_CLONE_MAX_BYTES", 1<<30),
		UserQuotaBytes:       envNonNegativeInt64("STREAMMOCK_USER_QUOTA_BYTES", 5<<30),
		CloneTTL:             time.Duration(envNonNegativeInt("STREAMMOCK_CLONE_TTL_HOURS", 0)) * time.Hour,
		CloneJanitorInterval: time.Duration(envInt("STREAMMOCK_CLONE_JANITOR_MINUTES", 30)) * time.Minute,
		PackagerBinary:       envOr("STREAMMOCK_PACKAGER_BIN", "packager"),
		PackagerTimeout:      time.Duration(envInt("STREAMMOCK_PACKAGER_TIMEOUT_MINUTES", 10)) * time.Minute,
		BBBDemoURL:           envOr("STREAMMOCK_BBB_URL", "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"),
		HTTPTimeout:          30 * time.Second,
		ClerkSecretKey:       envOr("CLERK_SECRET_KEY", ""),
		ServiceToken:         envOr("STREAMMOCK_SERVICE_TOKEN", ""),

		RateLimitPerMinute:        envFloat("STREAMMOCK_RATELIMIT_RPM", 10),
		RateLimitBurst:            envInt("STREAMMOCK_RATELIMIT_BURST", 5),
		LicenseRateLimitPerMinute: envFloat("STREAMMOCK_LICENSE_RATELIMIT_RPM", 120),
		LicenseRateLimitBurst:     envInt("STREAMMOCK_LICENSE_RATELIMIT_BURST", 20),
		EphemeralTTL:              time.Duration(envInt("STREAMMOCK_EPHEMERAL_TTL_MINUTES", 60)) * time.Minute,
		SweeperInterval:           10 * time.Minute,
	}
}

func envInt64(key string, fallback int64) int64 {
	if v := os.Getenv(key); v != "" {
		if parsed, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64); err == nil && parsed > 0 {
			return parsed
		}
	}
	return fallback
}

func envNonNegativeInt64(key string, fallback int64) int64 {
	if v := os.Getenv(key); v != "" {
		if parsed, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64); err == nil && parsed >= 0 {
			return parsed
		}
	}
	return fallback
}

func envNonNegativeInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if parsed, err := strconv.Atoi(strings.TrimSpace(v)); err == nil && parsed >= 0 {
			return parsed
		}
	}
	return fallback
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
