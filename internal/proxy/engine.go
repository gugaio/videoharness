package proxy

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"streammock/internal/config"
	"streammock/internal/models"
	"streammock/internal/store"
)

var uriAttrRe = regexp.MustCompile(`URI="([^"]+)"`)

type Engine struct {
	store           *store.MemoryStore
	chaos           *Chaos
	client          *http.Client
	truncateSeconds float64
}

func NewEngine(cfg config.Config, st *store.MemoryStore, chaos *Chaos) *Engine {
	return &Engine{
		store: st,
		chaos: chaos,
		client: &http.Client{
			Timeout: cfg.HTTPTimeout,
		},
		truncateSeconds: cfg.TruncateSeconds,
	}
}

func (e *Engine) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /s/{id}/master.m3u8", e.serveMaster)
	mux.HandleFunc("GET /s/{id}/r/{encoded}", e.serveProxied)
}

func (e *Engine) serveMaster(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	st, ok := e.store.Get(id)
	if !ok {
		http.NotFound(w, r)
		return
	}
	if e.chaos.Apply(w, r, true, st.ActivePreset) {
		return
	}
	e.servePlaylist(w, r, st, st.OriginalURL)
}

func (e *Engine) serveProxied(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	enc := r.PathValue("encoded")

	target, err := base64.RawURLEncoding.DecodeString(enc)
	if err != nil {
		http.Error(w, "invalid proxied url", http.StatusBadRequest)
		return
	}
	st, ok := e.store.Get(id)
	if !ok {
		http.NotFound(w, r)
		return
	}

	targetURL := string(target)
	isManifest := strings.HasSuffix(strings.Split(targetURL, "?")[0], ".m3u8")
	if isManifest {
		if e.chaos.Apply(w, r, true, st.ActivePreset) {
			return
		}
		e.servePlaylist(w, r, st, targetURL)
		return
	}

	if e.chaos.Apply(w, r, false, st.ActivePreset) {
		return
	}
	e.serveSegment(w, r, st, targetURL)
}

func (e *Engine) servePlaylist(w http.ResponseWriter, r *http.Request, st *models.Stream, rawURL string) {
	base, err := url.Parse(rawURL)
	if err != nil {
		http.Error(w, "invalid playlist url", http.StatusBadRequest)
		return
	}

	body, err := e.fetch(r.Context(), rawURL)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to fetch upstream playlist: %v", err), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	transformed := e.transformPlaylist(body, base, st.ID)
	_, _ = w.Write(transformed)
}

func (e *Engine) serveSegment(w http.ResponseWriter, r *http.Request, st *models.Stream, rawURL string) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, rawURL, nil)
	if err != nil {
		http.Error(w, "invalid segment url", http.StatusBadRequest)
		return
	}
	req.Header.Set("User-Agent", "StreamMock/0.1 (HLS proxy)")

	resp, err := e.client.Do(req)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to fetch upstream segment: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	copyHeaders(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)
	if resp.StatusCode == http.StatusOK {
		_, _ = io.Copy(w, resp.Body)
	}
}

func (e *Engine) fetch(ctx context.Context, rawURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "StreamMock/0.1 (HLS proxy)")

	resp, err := e.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil, fmt.Errorf("upstream returned %s", resp.Status)
	}
	return io.ReadAll(resp.Body)
}

// transformPlaylist rewrites every URI so it routes back through StreamMock and
// truncates the media sequence once the cumulative #EXTINF duration reaches the
// 60-second cap, closing the playlist with #EXT-X-ENDLIST.
func (e *Engine) transformPlaylist(body []byte, base *url.URL, streamID string) []byte {
	var out bytes.Buffer
	sc := bufio.NewScanner(bytes.NewReader(body))
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	var cumulative float64
	truncated := false

	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			out.WriteByte('\n')
			continue
		}
		if truncated {
			continue
		}
		if strings.HasPrefix(line, "#EXTINF:") {
			if dur, ok := parseEXTINFDuration(line); ok {
				cumulative += dur
			}
			if cumulative > e.truncateSeconds {
				truncated = true
				continue
			}
		}
		if strings.HasPrefix(line, "#EXT-X-ENDLIST") {
			continue
		}
		out.WriteString(e.rewriteLine(line, base, streamID))
		out.WriteByte('\n')
	}
	out.WriteString("#EXT-X-ENDLIST\n")
	return out.Bytes()
}

func (e *Engine) rewriteLine(line string, base *url.URL, streamID string) string {
	if strings.HasPrefix(line, "#") {
		if strings.Contains(line, `URI="`) {
			line = uriAttrRe.ReplaceAllStringFunc(line, func(m string) string {
				inner := strings.TrimSuffix(strings.TrimPrefix(m, `URI="`), `"`)
				return `URI="` + e.proxiedURL(streamID, base, inner) + `"`
			})
		}
		return line
	}
	return e.proxiedURL(streamID, base, line)
}

func (e *Engine) proxiedURL(streamID string, base *url.URL, ref string) string {
	u, err := url.Parse(ref)
	if err != nil {
		return ref
	}
	resolved := base.ResolveReference(u).String()
	enc := base64.RawURLEncoding.EncodeToString([]byte(resolved))
	return "/s/" + streamID + "/r/" + enc
}

func parseEXTINFDuration(line string) (float64, bool) {
	rest := strings.TrimPrefix(line, "#EXTINF:")
	if rest == line {
		return 0, false
	}
	rest = strings.TrimSpace(rest)
	if i := strings.IndexByte(rest, ','); i >= 0 {
		rest = rest[:i]
	}
	d, err := strconv.ParseFloat(strings.TrimSpace(rest), 64)
	if err != nil {
		return 0, false
	}
	return d, true
}

func copyHeaders(dst, src http.Header) {
	for k, vv := range src {
		for _, v := range vv {
			dst.Add(k, v)
		}
	}
	for _, h := range []string{
		"Connection",
		"Keep-Alive",
		"Proxy-Authenticate",
		"Proxy-Authorization",
		"Te",
		"Trailer",
		"Transfer-Encoding",
		"Upgrade",
		"Content-Length",
		"Content-Encoding",
	} {
		dst.Del(h)
	}
}
