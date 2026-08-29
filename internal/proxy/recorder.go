package proxy

import (
	"net/http"
	"strings"
	"time"

	"streammock/internal/models"
	"streammock/internal/ratelimit"
)

// RequestSink receives one aggregated record per playback request served on
// behalf of a workspace stream. It is invoked synchronously after the response
// is complete.
type RequestSink func(models.ProxyRequest)

// WithRequestSink installs the workspace request logger. Passing nil disables
// logging.
func (e *Engine) WithRequestSink(sink RequestSink) *Engine {
	e.sink = sink
	return e
}

// statusWriter captures the status code and byte count of a response so the
// request sink can record them.
type statusWriter struct {
	http.ResponseWriter
	status         int
	bytes          int64
	forwardedRange string
	upstreamStatus int
	contentRange   string
	contentLength  int64
	rangeResult    string
	diagnostic     string
	intervention   string
	addedLatencyMS int64
	injectedStatus int
}

// applyChaos records the exact StreamMock intervention on the request before
// telling the engine whether the injected response has completed it.
func (e *Engine) applyChaos(w http.ResponseWriter, r *http.Request, isManifest bool, preset string) bool {
	effect := e.chaos.Apply(w, r, isManifest, preset)
	if sw, ok := w.(*statusWriter); ok {
		sw.intervention = effect.intervention()
		sw.addedLatencyMS = effect.addedLatency.Milliseconds()
		sw.injectedStatus = effect.injectedStatus
	}
	return effect.handled()
}

func (w *statusWriter) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	n, err := w.ResponseWriter.Write(b)
	w.bytes += int64(n)
	return n, err
}

func (w *statusWriter) statusOrDefault() int {
	if w.status == 0 {
		return http.StatusOK
	}
	return w.status
}

// track wraps a handler entry: it returns a recording statusWriter and defers
// the sink call for the given kind/target. Handlers pass their own kind.
func (e *Engine) track(w http.ResponseWriter, r *http.Request, st *models.Stream, kind, targetURL string) (*statusWriter, func()) {
	sw := &statusWriter{ResponseWriter: w}
	start := time.Now()
	return sw, func() {
		if e.sink == nil || st.WorkspaceSlug == nil {
			return
		}
		e.sink(models.ProxyRequest{
			WorkspaceSlug:  *st.WorkspaceSlug,
			StreamID:       st.ID,
			StreamMode:     st.Mode,
			Kind:           kind,
			TargetURL:      targetURL,
			Status:         sw.statusOrDefault(),
			DurationMS:     time.Since(start).Milliseconds(),
			Bytes:          sw.bytes,
			ClientIP:       ratelimit.ClientIP(r),
			ActivePreset:   st.ActivePreset,
			ClientRange:    r.Header.Get("Range"),
			ForwardedRange: sw.forwardedRange,
			UpstreamStatus: sw.upstreamStatus,
			ContentRange:   sw.contentRange,
			ContentLength:  sw.contentLength,
			RangeResult:    rangeResult(r.Header.Get("Range"), sw),
			Diagnostic:     sw.diagnostic,
			Intervention:   sw.intervention,
			AddedLatencyMS: sw.addedLatencyMS,
			InjectedStatus: sw.injectedStatus,
		})
	}
}

func rangeResult(clientRange string, sw *statusWriter) string {
	if clientRange == "" {
		return "not_requested"
	}
	if sw.rangeResult != "" {
		return sw.rangeResult
	}
	if sw.statusOrDefault() == http.StatusPartialContent && sw.Header().Get("Content-Range") != "" {
		return "satisfied"
	}
	if sw.statusOrDefault() == http.StatusOK {
		return "ignored"
	}
	return "failed"
}

func kindForPlaylistPath(name string) string {
	if strings.HasSuffix(strings.ToLower(name), ".m3u8") {
		return models.KindVariant
	}
	return models.KindAsset
}
