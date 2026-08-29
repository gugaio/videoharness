package proxy

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"streammock/internal/cmcd"
	"streammock/internal/config"
	"streammock/internal/models"
	"streammock/internal/pubnet"
	"streammock/internal/store"
)

var uriAttrRe = regexp.MustCompile(`URI="([^"]+)"`)

type Engine struct {
	store           *store.MemoryStore
	chaos           *Chaos
	client          *http.Client
	truncateSeconds float64
	storageDir      string
	sink            RequestSink
	cmcdDecoder     cmcd.Decoder
}

func NewEngine(cfg config.Config, st *store.MemoryStore, chaos *Chaos) *Engine {
	return &Engine{
		store:           st,
		chaos:           chaos,
		client:          pubnet.NewHTTPClient(cfg.HTTPTimeout),
		truncateSeconds: cfg.TruncateSeconds,
		storageDir:      cfg.StorageDir,
		cmcdDecoder:     cmcd.NewV1Decoder(cmcd.DefaultLimits()),
	}
}

func (e *Engine) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /s/{id}/master.m3u8", e.serveMaster)
	mux.HandleFunc("GET /s/{id}/r/{encoded}", e.serveProxied)
	mux.HandleFunc("GET /s/{id}/{resource...}", e.serveLocal)
	mux.HandleFunc("OPTIONS /s/{id}/master.m3u8", handlePreflight)
	mux.HandleFunc("OPTIONS /s/{id}/r/{encoded}", handlePreflight)
	mux.HandleFunc("OPTIONS /s/{id}/{resource...}", handlePreflight)
}

// ServeMasterStream serves the entry playlist for a proxy stream (and
// delegates to local storage for clones). Exported so the public on-demand
// endpoint can reuse the playback path without an HTTP redirect.
func (e *Engine) ServeMasterStream(w http.ResponseWriter, r *http.Request, st *models.Stream) {
	sw, done := e.track(w, r, st, models.KindMaster, st.OriginalURL)
	defer done()
	if st.Mode == models.ModeClone {
		e.serveLocalResource(sw, r, st, "master.m3u8")
		return
	}
	if e.applyChaos(sw, r, true, st.ActivePreset) {
		return
	}
	e.servePlaylist(sw, r, st, st.OriginalURL)
}

// handlePreflight answers CORS preflight requests for all playback routes so
// browser-based HLS players hosted on other origins can fetch streams.
func handlePreflight(w http.ResponseWriter, _ *http.Request) {
	setCORS(w.Header())
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Range, Origin, Content-Type")
	w.Header().Set("Access-Control-Max-Age", "86400")
	w.WriteHeader(http.StatusNoContent)
}

func setCORS(h http.Header) {
	h.Set("Access-Control-Allow-Origin", "*")
}

// playlistTruncateSeconds picks the per-stream duration cap, falling back to
// the global default (60s) when the stream does not request one.
func (e *Engine) playlistTruncateSeconds(st *models.Stream) float64 {
	if st.RequestedDurationSeconds > 0 {
		return st.RequestedDurationSeconds
	}
	return e.truncateSeconds
}

func (e *Engine) serveMaster(w http.ResponseWriter, r *http.Request) {
	st, ok := e.store.Get(r.PathValue("id"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	e.ServeMasterStream(w, r, st)
}

func (e *Engine) serveProxied(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	enc := r.PathValue("encoded")

	target, err := base64.RawURLEncoding.DecodeString(strings.SplitN(enc, "~", 2)[0])
	if err != nil {
		http.Error(w, "invalid proxied url", http.StatusBadRequest)
		return
	}
	st, ok := e.store.Get(id)
	if !ok {
		http.NotFound(w, r)
		return
	}
	if st.Mode == models.ModeClone {
		http.NotFound(w, r)
		return
	}

	targetURL := string(target)
	isManifest := strings.HasSuffix(strings.Split(targetURL, "?")[0], ".m3u8")
	kind := models.KindSegment
	if isManifest {
		kind = models.KindVariant
	}
	sw, done := e.track(w, r, st, kind, targetURL)
	defer done()
	if isManifest {
		if e.applyChaos(sw, r, true, st.ActivePreset) {
			return
		}
		e.servePlaylist(sw, r, st, targetURL)
		return
	}

	if e.applyChaos(sw, r, false, st.ActivePreset) {
		return
	}
	e.serveSegment(sw, r, st, targetURL)
}

func (e *Engine) serveLocal(w http.ResponseWriter, r *http.Request) {
	st, ok := e.store.Get(r.PathValue("id"))
	if !ok || st.Mode != models.ModeClone {
		http.NotFound(w, r)
		return
	}
	logicalPath := r.PathValue("resource")
	sw, done := e.track(w, r, st, kindForPlaylistPath(logicalPath), logicalPath)
	defer done()
	e.serveLocalResource(sw, r, st, logicalPath)
}

func (e *Engine) serveLocalResource(w http.ResponseWriter, r *http.Request, st *models.Stream, logicalPath string) {
	if st.CaptureStatus != models.CaptureReady {
		message := "clone is not ready"
		if st.CaptureStatus == models.CaptureFailed {
			message = "clone capture failed"
		}
		http.Error(w, message, http.StatusConflict)
		return
	}
	if !validLogicalPath(logicalPath) {
		http.NotFound(w, r)
		return
	}
	resource, ok := e.store.GetResource(st.ID, logicalPath)
	if !ok || st.StorageKey == nil {
		http.NotFound(w, r)
		return
	}
	isManifest := resource.Kind == "master" || resource.Kind == "media-playlist"
	if e.applyChaos(w, r, isManifest, st.ActivePreset) {
		return
	}
	root := filepath.Join(e.storageDir, filepath.FromSlash(*st.StorageKey))
	path := filepath.Join(root, filepath.FromSlash(logicalPath))
	cleanRoot, err := filepath.Abs(root)
	if err != nil {
		http.Error(w, "storage error", http.StatusInternalServerError)
		return
	}
	cleanPath, err := filepath.Abs(path)
	if err != nil || !strings.HasPrefix(cleanPath, cleanRoot+string(os.PathSeparator)) {
		http.NotFound(w, r)
		return
	}
	file, err := os.Open(cleanPath)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", resource.ContentType)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Accept-Ranges", "bytes")
	setCORS(w.Header())
	http.ServeContent(w, r, filepath.Base(logicalPath), info.ModTime(), file)
}

func validLogicalPath(value string) bool {
	if value == "" || len(value) > 512 {
		return false
	}
	for _, part := range strings.Split(value, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}

func (e *Engine) servePlaylist(w http.ResponseWriter, r *http.Request, st *models.Stream, rawURL string) {
	base, err := url.Parse(rawURL)
	if err != nil {
		http.Error(w, "invalid playlist url", http.StatusBadRequest)
		return
	}

	body, err := e.fetch(r.Context(), rawURL, statusWriterFrom(w))
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to fetch upstream playlist: %v", err), http.StatusBadGateway)
		return
	}

	setCORS(w.Header())
	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	transformed := e.transformPlaylist(body, base, st.ID, e.playlistTruncateSeconds(st))
	_, _ = w.Write(transformed)
}

func (e *Engine) serveSegment(w http.ResponseWriter, r *http.Request, st *models.Stream, rawURL string) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, rawURL, nil)
	if err != nil {
		http.Error(w, "invalid segment url", http.StatusBadRequest)
		return
	}
	for _, header := range []string{"Range", "If-Range", "Accept", "User-Agent"} {
		if value := r.Header.Get(header); value != "" {
			req.Header.Set(header, value)
		}
	}
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", "StreamMock/0.1 (HLS proxy)")
	}

	if sw := statusWriterFrom(w); sw != nil {
		req = req.WithContext(httptrace.WithClientTrace(req.Context(), sw.clientTrace()))
	}
	resp, err := e.client.Do(req)
	if err != nil {
		if sw := statusWriterFrom(w); sw != nil {
			sw.transportError = err.Error()
		}
		http.Error(w, fmt.Sprintf("failed to fetch upstream segment: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	reader := &timedReadCloser{ReadCloser: resp.Body}
	if sw, ok := w.(*statusWriter); ok {
		sw.forwardedRange = req.Header.Get("Range")
		sw.upstreamStatus = resp.StatusCode
		sw.contentRange = resp.Header.Get("Content-Range")
		sw.contentLength = resp.ContentLength
		if requested := r.Header.Get("Range"); requested != "" {
			switch {
			case resp.StatusCode == http.StatusOK:
				sw.rangeResult = "ignored"
				sw.diagnostic = "origin ignored the player's Range request and returned 200 OK"
			case resp.StatusCode == http.StatusPartialContent && sw.contentRange == "":
				sw.rangeResult = "missing_content_range"
				sw.diagnostic = "origin returned 206 Partial Content without Content-Range"
			case resp.StatusCode == http.StatusPartialContent:
				sw.rangeResult = "satisfied"
			default:
				sw.rangeResult = "failed"
				sw.diagnostic = fmt.Sprintf("origin returned %s to the player's Range request", resp.Status)
			}
		}
	}

	copyHeaders(w.Header(), resp.Header)
	setCORS(w.Header())
	w.WriteHeader(resp.StatusCode)
	if resp.StatusCode >= http.StatusOK && resp.StatusCode < http.StatusMultipleChoices {
		_, _ = io.Copy(w, reader)
	} else {
		_, _ = io.Copy(io.Discard, reader)
	}
	if sw := statusWriterFrom(w); sw != nil {
		sw.originBodyMS = durationPtr(reader.total)
	}
	if sw := statusWriterFrom(w); sw != nil {
		sw.markRelayDone()
	}
}

func (e *Engine) fetch(ctx context.Context, rawURL string, sw *statusWriter) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "StreamMock/0.1 (HLS proxy)")
	if sw != nil {
		req = req.WithContext(httptrace.WithClientTrace(req.Context(), sw.clientTrace()))
	}

	resp, err := e.client.Do(req)
	if err != nil {
		if sw != nil {
			sw.transportError = err.Error()
		}
		return nil, err
	}
	defer resp.Body.Close()
	reader := &timedReadCloser{ReadCloser: resp.Body}
	if sw != nil {
		sw.upstreamStatus = resp.StatusCode
		sw.contentLength = resp.ContentLength
	}

	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, reader)
		if sw != nil {
			sw.originBodyMS = durationPtr(reader.total)
			sw.markRelayDone()
		}
		return nil, fmt.Errorf("upstream returned %s", resp.Status)
	}
	body, err := io.ReadAll(reader)
	if sw != nil {
		sw.originBodyMS = durationPtr(reader.total)
		sw.markRelayDone()
	}
	return body, err
}

// timedReadCloser measures time blocked while reading bytes from the origin.
// It excludes downstream ResponseWriter backpressure, which remains in
// relay_ms.
type timedReadCloser struct {
	io.ReadCloser
	total time.Duration
}

func (r *timedReadCloser) Read(p []byte) (int, error) {
	started := time.Now()
	n, err := r.ReadCloser.Read(p)
	r.total += time.Since(started)
	return n, err
}

func statusWriterFrom(w http.ResponseWriter) *statusWriter {
	sw, _ := w.(*statusWriter)
	return sw
}

// transformPlaylist rewrites every URI so it routes back through StreamMock and
// truncates the media sequence once the cumulative #EXTINF duration reaches the
// per-stream cap, closing the playlist with #EXT-X-ENDLIST.
func (e *Engine) transformPlaylist(body []byte, base *url.URL, streamID string, maxSeconds float64) []byte {
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
			if cumulative > maxSeconds {
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
	resolved := base.ResolveReference(u)
	enc := base64.RawURLEncoding.EncodeToString([]byte(resolved.String()))
	// Append the upstream file name as a readable suffix so the resulting
	// path still hints at whether it is a manifest or a segment.
	if name := path.Base(resolved.Path); name != "" && name != "." && name != "/" {
		enc += "~" + url.PathEscape(name)
	}
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
		"Set-Cookie",
	} {
		dst.Del(h)
	}
}
