package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"streammock/internal/capture"
	"streammock/internal/config"
	"streammock/internal/db"
	"streammock/internal/models"
	"streammock/internal/proxy"
	"streammock/internal/pubnet"
	"streammock/internal/ratelimit"
	"streammock/internal/store"

	"github.com/clerk/clerk-sdk-go/v2"
	"github.com/clerk/clerk-sdk-go/v2/jwt"
)

type Server struct {
	cfg     config.Config
	store   *store.MemoryStore
	engine  *proxy.Engine
	capture *capture.Manager
	limiter *ratelimit.Limiter
	db      *db.DB
}

// handlerError carries an HTTP status alongside its user-facing message.
type handlerError struct {
	status int
	msg    string
}

func (e *handlerError) Error() string { return e.msg }

type StreamVM struct {
	Stream  models.Stream
	Presets []models.Preset
}

func (v StreamVM) MarshalJSON() ([]byte, error) {
	type streamJSON struct {
		models.Stream
		Presets []models.Preset `json:"presets"`
	}
	return json.Marshal(streamJSON{Stream: v.Stream, Presets: v.Presets})
}

func main() {
	cfg := config.Load()

	clerk.SetKey(cfg.ClerkSecretKey)
	if cfg.ClerkSecretKey == "" {
		log.Println("warning: CLERK_SECRET_KEY not set; workspace endpoints will reject authenticated requests")
	}

	database, err := db.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer database.Close()

	if err := database.Migrate(); err != nil {
		log.Fatalf("db migrate: %v", err)
	}

	streams, err := database.ListStreams()
	if err != nil {
		log.Fatalf("db list streams: %v", err)
	}

	mem := store.New(database)
	mem.LoadAll(streams)

	if err := seedBBBDemo(mem, cfg); err != nil {
		log.Fatalf("seed demo stream: %v", err)
	}

	chaos := proxy.NewChaos()
	engine := proxy.NewEngine(cfg, mem, chaos)
	engine = engine.WithRequestSink(func(req models.ProxyRequest) {
		if err := database.InsertProxyRequest(req); err != nil {
			log.Printf("record proxy request: %v", err)
		}
	})
	captureManager := capture.NewManager(cfg, mem)
	bgCtx, cancelBG := context.WithCancel(context.Background())
	defer cancelBG()
	captureManager.Start(bgCtx)

	limiter := ratelimit.New(cfg.RateLimitPerMinute, cfg.RateLimitBurst)
	go limiter.StartCleanup(bgCtx, time.Minute, 15*time.Minute)
	go mem.StartSweeper(bgCtx, cfg.EphemeralTTL, cfg.SweeperInterval)
	go retainProxyRequests(bgCtx, database)

	srv := &Server{
		cfg:     cfg,
		store:   mem,
		engine:  engine,
		capture: captureManager,
		limiter: limiter,
		db:      database,
	}

	mux := http.NewServeMux()
	registerFrontend(mux)
	mux.HandleFunc("GET /api/health", handleHealth)
	mux.HandleFunc("GET /api/streams", srv.handleListStreams)
	mux.HandleFunc("GET /api/streams/{id}", srv.handleGetStream)
	mux.HandleFunc("POST /api/streams", srv.handleAddStream)
	mux.HandleFunc("POST /api/streams/{id}/preset", srv.handleSetPreset)
	mux.HandleFunc("GET /api/workspace", srv.handleGetWorkspace)
	mux.HandleFunc("GET /api/workspace/requests", srv.handleWorkspaceRequests)
	mux.HandleFunc("GET /p.m3u8", srv.handleOnDemand)
	mux.HandleFunc("GET /p", srv.handleOnDemand)
	mux.HandleFunc("OPTIONS /p.m3u8", handlePreflight)
	mux.HandleFunc("OPTIONS /p", handlePreflight)
	mux.HandleFunc("GET /ws/{slug}/p.m3u8", srv.handleWorkspaceOnDemand)
	mux.HandleFunc("GET /ws/{slug}/p", srv.handleWorkspaceOnDemand)
	mux.HandleFunc("OPTIONS /ws/{slug}/p.m3u8", handlePreflight)
	mux.HandleFunc("OPTIONS /ws/{slug}/p", handlePreflight)
	srv.engine.Register(mux)

	httpServer := &http.Server{
		Addr:    cfg.Addr,
		Handler: mux,
	}

	done := make(chan struct{})
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		<-sig
		log.Println("shutting down...")
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(ctx); err != nil {
			log.Printf("shutdown: %v", err)
		}
		close(done)
	}()

	log.Printf("StreamMock listening on %s", cfg.Addr)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server: %v", err)
	}
	<-done
}

func handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func seedBBBDemo(mem *store.MemoryStore, cfg config.Config) error {
	if _, ok := mem.Get("big-buck-bunny"); ok {
		return nil
	}
	return mem.Add(models.Stream{
		ID:                       "big-buck-bunny",
		OriginalURL:              cfg.BBBDemoURL,
		ProxyPath:                "/s/big-buck-bunny/master.m3u8",
		ActivePreset:             "clean",
		Mode:                     models.ModeProxy,
		CaptureStatus:            models.CaptureReady,
		RequestedDurationSeconds: 60,
		CreatedAt:                time.Now().UTC(),
		UpdatedAt:                time.Now().UTC(),
	}, true)
}

func (s *Server) handleListStreams(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.authenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"streams": streamVMs(s.store.ListByOwner(userID), models.Presets),
	})
}

func (s *Server) handleGetStream(w http.ResponseWriter, r *http.Request) {
	st, ok := s.store.Get(r.PathValue("id"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"stream": StreamVM{Stream: *st, Presets: models.Presets},
	})
}

func (s *Server) handleAddStream(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL             string  `json:"url"`
		DurationSeconds float64 `json:"duration_seconds"`
		Mode            string  `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	rawURL := strings.TrimSpace(body.URL)
	if err := validateURL(rawURL); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	mode := strings.TrimSpace(body.Mode)
	if mode == "" {
		mode = models.ModeClone
	}
	if mode != models.ModeClone && mode != models.ModeProxy {
		http.Error(w, `mode must be "proxy" or "clone"`, http.StatusBadRequest)
		return
	}
	duration, err := capture.ValidateDuration(body.DurationSeconds)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	id, err := newID()
	if err != nil {
		http.Error(w, "failed to generate id", http.StatusInternalServerError)
		return
	}

	captureStatus := models.CaptureQueued
	if mode == models.ModeProxy {
		captureStatus = models.CaptureReady
	}
	st := models.Stream{
		ID:                       id,
		OriginalURL:              rawURL,
		ProxyPath:                fmt.Sprintf("/s/%s/master.m3u8", id),
		ActivePreset:             "clean",
		Mode:                     mode,
		CaptureStatus:            captureStatus,
		RequestedDurationSeconds: duration,
		CreatedAt:                time.Now().UTC(),
		UpdatedAt:                time.Now().UTC(),
	}
	userID, authed := s.authenticatedUserID(r)
	if authed {
		st.OwnerID = &userID
	}
	// Clone bytes live on disk, so every clone needs durable metadata even when
	// created anonymously. Ownership still controls workspace listing and edits.
	if err := s.store.Add(st, true); err != nil {
		http.Error(w, fmt.Sprintf("failed to persist stream: %v", err), http.StatusInternalServerError)
		return
	}
	if mode == models.ModeClone {
		s.capture.Enqueue(st.ID)
	}

	writeJSON(w, http.StatusAccepted, map[string]any{
		"stream": StreamVM{Stream: st, Presets: models.Presets},
	})
}

func (s *Server) handleSetPreset(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	st, ok := s.store.Get(id)
	if !ok {
		http.NotFound(w, r)
		return
	}
	// Anonymous streams (no owner) can be changed by anyone holding the link;
	// owned streams only by their owner.
	if st.OwnerID != nil {
		userID, authed := s.authenticatedUserID(r)
		if !authed || userID != *st.OwnerID {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
	}
	preset, err := bodyParam(r, "preset")
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	preset = strings.TrimSpace(preset)
	if !models.ValidPreset(preset) {
		http.Error(w, "unknown preset", http.StatusBadRequest)
		return
	}
	if err := s.store.SetPreset(id, preset); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"stream": StreamVM{Stream: *st, Presets: models.Presets},
	})
}

// handleOnDemand is the public no-signup entry point: /p.m3u8?url=<hls>&preset=&duration=
// It proxies the given HLS stream on the fly (nothing is recorded), reusing a
// deterministic stream ID per source URL so player refreshes keep working and
// preset changes survive. These streams are anonymous, memory-only and never
// appear in any workspace.
func (s *Server) handleOnDemand(w http.ResponseWriter, r *http.Request) {
	s.serveOnDemand(w, r, nil)
}

// handleWorkspaceOnDemand is the workspace-scoped variant:
// /ws/{slug}/p.m3u8?url=<hls>&preset=&duration= — no auth (HLS players cannot
// send headers), but the slug must be a registered workspace. Playback through
// it is attributed to the workspace and shows up on its request board.
func (s *Server) handleWorkspaceOnDemand(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if _, ok := s.db.WorkspaceOwner(slug); !ok {
		http.NotFound(w, r)
		return
	}
	s.serveOnDemand(w, r, &slug)
}

func (s *Server) serveOnDemand(w http.ResponseWriter, r *http.Request, slug *string) {
	if !s.limiter.Allow(ratelimit.ClientIP(r)) {
		w.Header().Set("Retry-After", "30")
		http.Error(w, "rate limit exceeded; slow down or try again later", http.StatusTooManyRequests)
		return
	}
	st, herr := s.buildOnDemandStream(r, slug)
	if herr != nil {
		http.Error(w, herr.msg, herr.status)
		return
	}
	if err := s.store.Add(*st, false); err != nil {
		http.Error(w, "failed to register stream", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Access-Control-Allow-Origin", "*")
	live, _ := s.store.Get(st.ID)
	s.engine.ServeMasterStream(w, r, live)
}

// buildOnDemandStream validates the query parameters and returns the
// memory-only stream for the request, reusing deterministic IDs so identical
// URLs (and workspace scopes) share one stream instead of allocating
// unbounded memory. When slug is nil the stream is public/anonymous; the
// reused stream keeps its prior creation time and, unless a preset is
// explicitly requested, its active preset.
func (s *Server) buildOnDemandStream(r *http.Request, slug *string) (*models.Stream, *handlerError) {
	q := r.URL.Query()
	rawURL := strings.TrimSpace(q.Get("url"))
	if err := pubnet.ValidateURL(rawURL); err != nil {
		return nil, &handlerError{http.StatusBadRequest, "invalid url: " + err.Error()}
	}
	preset := strings.TrimSpace(q.Get("preset"))
	if preset != "" && !models.ValidPreset(preset) {
		return nil, &handlerError{http.StatusBadRequest, fmt.Sprintf("unknown preset %q; valid presets: %s", preset, presetKeys())}
	}
	duration, err := parseOnDemandDuration(q.Get("duration"))
	if err != nil {
		return nil, &handlerError{http.StatusBadRequest, err.Error()}
	}

	id := onDemandID(rawURL, slug)
	now := time.Now().UTC()
	st := &models.Stream{
		ID:                       id,
		OriginalURL:              rawURL,
		ProxyPath:                fmt.Sprintf("/s/%s/master.m3u8", id),
		ActivePreset:             preset,
		Mode:                     models.ModeProxy,
		CaptureStatus:            models.CaptureReady,
		RequestedDurationSeconds: duration,
		WorkspaceSlug:            slug,
		CreatedAt:                now,
		UpdatedAt:                now,
	}
	if existing, ok := s.store.Get(id); ok {
		st.CreatedAt = existing.CreatedAt
		if preset == "" {
			st.ActivePreset = existing.ActivePreset
		}
	} else if preset == "" {
		st.ActivePreset = models.Presets[0].Key
	}
	return st, nil
}

// parseOnDemandDuration mirrors capture.ValidateDuration but with messages
// phrased for the public ?duration= query parameter.
func parseOnDemandDuration(raw string) (float64, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 60, nil
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, errors.New("invalid duration: must be a number of seconds")
	}
	duration, err := capture.ValidateDuration(value)
	if err != nil {
		return 0, errors.New("duration must be between 1 and 300 seconds")
	}
	return duration, nil
}

// onDemandID derives a stable stream ID from the source URL and, when the
// stream belongs to a workspace, from the workspace slug — so two boards
// proxying the same URL never collide.
func onDemandID(rawURL string, slug *string) string {
	key := strings.TrimSpace(rawURL)
	if slug != nil && *slug != "" {
		key = *slug + "\x00" + key
	}
	sum := sha256.Sum256([]byte(key))
	return "od-" + hex.EncodeToString(sum[:8])
}

func presetKeys() string {
	keys := make([]string, 0, len(models.Presets))
	for _, p := range models.Presets {
		keys = append(keys, p.Key)
	}
	return strings.Join(keys, ", ")
}

// retainProxyRequests enforces the board retention policy: requests older than
// 24h are purged and each workspace keeps at most 1,000 most recent rows.
func retainProxyRequests(ctx context.Context, database *db.DB) {
	ticker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := database.PurgeProxyRequests(24 * time.Hour); err != nil {
				log.Printf("purge proxy requests: %v", err)
			}
			if _, err := database.TrimProxyRequests(1000); err != nil {
				log.Printf("trim proxy requests: %v", err)
			}
		}
	}
}

// handleGetWorkspace returns (creating on first call) the caller's workspace
// slug and the matching on-demand playback URL.
func (s *Server) handleGetWorkspace(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.authenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	slug, err := s.db.EnsureWorkspace(userID)
	if err != nil {
		log.Printf("ensure workspace: %v", err)
		http.Error(w, "failed to load workspace", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"slug":         slug,
		"playback_url": fmt.Sprintf("/ws/%s/p.m3u8", slug),
	})
}

// handleWorkspaceRequests serves the request board: the caller's own recent
// proxy requests, newest first. Another workspace's slug may not be inspected.
func (s *Server) handleWorkspaceRequests(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.authenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	slug := strings.TrimSpace(r.URL.Query().Get("workspace"))
	if slug == "" {
		own, err := s.db.EnsureWorkspace(userID)
		if err != nil {
			log.Printf("ensure workspace: %v", err)
			http.Error(w, "failed to load workspace", http.StatusInternalServerError)
			return
		}
		slug = own
	} else if owner, exists := s.db.WorkspaceOwner(slug); !exists || owner != userID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	requests, err := s.db.ListProxyRequests(slug, 100)
	if err != nil {
		log.Printf("list proxy requests: %v", err)
		http.Error(w, "failed to load requests", http.StatusInternalServerError)
		return
	}
	if requests == nil {
		requests = []models.ProxyRequest{}
	}
	total, err := s.db.CountProxyRequests(slug, time.Now().Add(-24*time.Hour))
	if err != nil {
		log.Printf("count proxy requests: %v", err)
		http.Error(w, "failed to count requests", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"requests":  requests,
		"total_24h": total,
	})
}

func handlePreflight(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Range, Origin, Content-Type")
	w.Header().Set("Access-Control-Max-Age", "86400")
	w.WriteHeader(http.StatusNoContent)
}

// authenticatedUserID verifies the Clerk session JWT from the Authorization
// header and returns the user ID. A missing or invalid token yields (_, false),
// i.e. an anonymous request.
func (s *Server) authenticatedUserID(r *http.Request) (string, bool) {
	auth := r.Header.Get("Authorization")
	token, ok := strings.CutPrefix(auth, "Bearer ")
	if !ok || strings.TrimSpace(token) == "" {
		return "", false
	}
	claims, err := jwt.Verify(r.Context(), &jwt.VerifyParams{Token: strings.TrimSpace(token)})
	if err != nil {
		log.Printf("auth verify: %v", err)
		return "", false
	}
	return claims.Subject, true
}

func bodyParam(r *http.Request, key string) (string, error) {
	var body map[string]string
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return "", err
	}
	return body[key], nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("write json: %v", err)
	}
}

// registerFrontend serves the compiled React app from web/dist.
func registerFrontend(mux *http.ServeMux) {
	dist := filepath.Join("web", "dist")
	if _, err := os.Stat(dist); err != nil {
		mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "frontend not built; run `make build`", http.StatusServiceUnavailable)
		})
		return
	}

	fs := http.FileServer(http.Dir(dist))
	spa := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(dist, filepath.Clean(strings.TrimPrefix(r.URL.Path, "/")))
		if info, err := os.Stat(path); err != nil || info.IsDir() {
			r.URL.Path = "/"
		}
		fs.ServeHTTP(w, r)
	})
	mux.Handle("GET /", spa)
}

func validateURL(raw string) error {
	if raw == "" {
		return errors.New("url is required")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return errors.New("invalid url")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return errors.New("url must be http(s)")
	}
	if u.Host == "" {
		return errors.New("url must include a host")
	}
	return nil
}

func newID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func streamVMs(streams []models.Stream, presets []models.Preset) []StreamVM {
	out := make([]StreamVM, 0, len(streams))
	for _, st := range streams {
		out = append(out, StreamVM{Stream: st, Presets: presets})
	}
	return out
}
