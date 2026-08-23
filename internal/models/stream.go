package models

import "time"

type Stream struct {
	ID           string    `json:"id"`
	OriginalURL  string    `json:"original_url"`
	ProxyPath    string    `json:"proxy_path"`
	ActivePreset string    `json:"active_preset"`
	OwnerID      *string   `json:"owner_id"`
	CreatedAt    time.Time `json:"created_at"`
}

type Preset struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

var Presets = []Preset{
	{Key: "clean", Label: "Clean", Description: "Pass-through with zero modification."},
	{Key: "subway_3g", Label: "Subway 3G", Description: "1500-3000ms artificial latency and a 10% chance of HTTP 504."},
	{Key: "cdn_degradation", Label: "CDN Degradation", Description: "20% of segment requests fail with HTTP 500."},
	{Key: "stale_live_manifest", Label: "Stale Live Manifest", Description: "Manifest refresh responses delayed by 4000ms."},
}

func ValidPreset(key string) bool {
	for _, p := range Presets {
		if p.Key == key {
			return true
		}
	}
	return false
}
