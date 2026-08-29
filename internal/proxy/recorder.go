package proxy

import (
	"crypto/tls"
	"net/http"
	"net/http/httptrace"
	"strings"
	"sync"
	"time"

	"streammock/internal/cmcd"
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

// WithCMCDDecoder swaps the decoder behind the stable boundary. A nil decoder
// disables capture while keeping playback and request logging operational.
func (e *Engine) WithCMCDDecoder(decoder cmcd.Decoder) *Engine {
	e.cmcdDecoder = decoder
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
	startedAt      time.Time
	local          bool
	transportError string
	trace          originTrace
}

type originTrace struct {
	mu                                       sync.Mutex
	startedAt                                time.Time
	dnsStarted, connectStarted, tlsStarted   time.Time
	firstByteAt                              time.Time
	dnsMS, connectMS, tlsMS, ttfbMS, relayMS *int64
	connectionReused                         *bool
}

func durationPtr(duration time.Duration) *int64 { value := duration.Milliseconds(); return &value }

func (w *statusWriter) clientTrace() *httptrace.ClientTrace {
	w.trace.mu.Lock()
	w.trace.startedAt = time.Now()
	w.trace.mu.Unlock()
	return &httptrace.ClientTrace{
		DNSStart: func(httptrace.DNSStartInfo) { w.trace.mu.Lock(); w.trace.dnsStarted = time.Now(); w.trace.mu.Unlock() },
		DNSDone: func(httptrace.DNSDoneInfo) {
			w.trace.mu.Lock()
			if !w.trace.dnsStarted.IsZero() {
				w.trace.dnsMS = durationPtr(time.Since(w.trace.dnsStarted))
			}
			w.trace.mu.Unlock()
		},
		ConnectStart: func(_, _ string) { w.trace.mu.Lock(); w.trace.connectStarted = time.Now(); w.trace.mu.Unlock() },
		ConnectDone: func(_, _ string, _ error) {
			w.trace.mu.Lock()
			if !w.trace.connectStarted.IsZero() {
				w.trace.connectMS = durationPtr(time.Since(w.trace.connectStarted))
			}
			w.trace.mu.Unlock()
		},
		TLSHandshakeStart: func() { w.trace.mu.Lock(); w.trace.tlsStarted = time.Now(); w.trace.mu.Unlock() },
		TLSHandshakeDone: func(tls.ConnectionState, error) {
			w.trace.mu.Lock()
			if !w.trace.tlsStarted.IsZero() {
				w.trace.tlsMS = durationPtr(time.Since(w.trace.tlsStarted))
			}
			w.trace.mu.Unlock()
		},
		GotConn: func(info httptrace.GotConnInfo) {
			w.trace.mu.Lock()
			value := info.Reused
			w.trace.connectionReused = &value
			w.trace.mu.Unlock()
		},
		GotFirstResponseByte: func() {
			w.trace.mu.Lock()
			w.trace.firstByteAt = time.Now()
			w.trace.ttfbMS = durationPtr(w.trace.firstByteAt.Sub(w.trace.startedAt))
			w.trace.mu.Unlock()
		},
	}
}

func (w *statusWriter) markRelayDone() {
	w.trace.mu.Lock()
	defer w.trace.mu.Unlock()
	if !w.trace.firstByteAt.IsZero() {
		w.trace.relayMS = durationPtr(time.Since(w.trace.firstByteAt))
	}
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
	start := time.Now()
	sw := &statusWriter{ResponseWriter: w, startedAt: start, local: st.Mode == models.ModeClone, trace: originTrace{startedAt: start}}
	var requestCMCD *models.RequestCMCD
	if st.WorkspaceSlug != nil && e.cmcdDecoder != nil {
		decoded, decodeErr := e.cmcdDecoder.DecodeRequest(r)
		requestCMCD = models.NewRequestCMCD(decoded, decodeErr)
	}
	return sw, func() {
		if e.sink == nil || st.WorkspaceSlug == nil {
			return
		}
		completed := time.Now()
		sw.trace.mu.Lock()
		dnsMS, connectMS, tlsMS, ttfbMS, relayMS, reused := sw.trace.dnsMS, sw.trace.connectMS, sw.trace.tlsMS, sw.trace.ttfbMS, sw.trace.relayMS, sw.trace.connectionReused
		sw.trace.mu.Unlock()
		var localMS *int64
		if sw.local {
			localMS = durationPtr(completed.Sub(start))
		}
		e.sink(models.ProxyRequest{
			WorkspaceSlug:    *st.WorkspaceSlug,
			StreamID:         st.ID,
			StreamMode:       st.Mode,
			Kind:             kind,
			TargetURL:        targetURL,
			Status:           sw.statusOrDefault(),
			DurationMS:       completed.Sub(start).Milliseconds(),
			Bytes:            sw.bytes,
			ClientIP:         ratelimit.ClientIP(r),
			ActivePreset:     st.ActivePreset,
			ClientRange:      r.Header.Get("Range"),
			ForwardedRange:   sw.forwardedRange,
			UpstreamStatus:   sw.upstreamStatus,
			ContentRange:     sw.contentRange,
			ContentLength:    sw.contentLength,
			RangeResult:      rangeResult(r.Header.Get("Range"), sw),
			Diagnostic:       sw.diagnostic,
			Intervention:     sw.intervention,
			AddedLatencyMS:   sw.addedLatencyMS,
			InjectedStatus:   sw.injectedStatus,
			StartedAtMS:      start.UTC().UnixMilli(),
			CompletedAtMS:    completed.UTC().UnixMilli(),
			UserAgent:        r.UserAgent(),
			DNSMS:            dnsMS,
			ConnectMS:        connectMS,
			TLSMS:            tlsMS,
			TTFBMS:           ttfbMS,
			RelayMS:          relayMS,
			LocalServeMS:     localMS,
			ConnectionReused: reused,
			TransportError:   sw.transportError,
			CMCD:             requestCMCD,
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
