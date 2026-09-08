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
	"streammock/internal/diagnostics"
	"streammock/internal/live"
	"streammock/internal/models"
	"streammock/internal/proxy"
	"streammock/internal/pubnet"
	"streammock/internal/ratelimit"
	"streammock/internal/store"
	"streammock/internal/telemetry"

	"github.com/clerk/clerk-sdk-go/v2"
	"github.com/clerk/clerk-sdk-go/v2/jwt"
	"github.com/google/uuid"
)

type Server struct {
	cfg           config.Config
	store         *store.MemoryStore
	engine        *proxy.Engine
	capture       *capture.Manager
	limiter       *ratelimit.Limiter
	ingestLimiter *ratelimit.Limiter
	db            *db.DB
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
	ingestLimiter := ratelimit.New(240, 40)
	go limiter.StartCleanup(bgCtx, time.Minute, 15*time.Minute)
	go ingestLimiter.StartCleanup(bgCtx, time.Minute, 15*time.Minute)
	go mem.StartSweeper(bgCtx, cfg.EphemeralTTL, cfg.SweeperInterval)
	go engine.StartMaintenance(bgCtx)
	go retainProxyRequests(bgCtx, database)

	srv := &Server{
		cfg:           cfg,
		store:         mem,
		engine:        engine,
		capture:       captureManager,
		limiter:       limiter,
		ingestLimiter: ingestLimiter,
		db:            database,
	}
	go srv.runCloneJanitor(bgCtx)

	mux := http.NewServeMux()
	registerFrontend(mux)
	mux.HandleFunc("GET /api/health", handleHealth)
	mux.HandleFunc("GET /api/streams", srv.handleListStreams)
	mux.HandleFunc("GET /api/streams/{id}", srv.handleGetStream)
	mux.HandleFunc("DELETE /api/streams/{id}", srv.handleDeleteStream)
	mux.HandleFunc("POST /api/streams", srv.handleAddStream)
	mux.HandleFunc("POST /api/streams/{id}/preset", srv.handleSetPreset)
	mux.HandleFunc("GET /api/streams/{id}/live", srv.handleLiveMock)
	mux.HandleFunc("POST /api/streams/{id}/live", srv.handleLiveMock)
	mux.HandleFunc("GET /api/workspace", srv.handleGetWorkspace)
	mux.HandleFunc("GET /api/workspace/requests", srv.handleWorkspaceRequests)
	mux.HandleFunc("DELETE /api/workspace/requests", srv.handleWorkspaceRequests)
	mux.HandleFunc("GET /api/playback/sessions", srv.handlePlaybackSessions)
	mux.HandleFunc("POST /api/playback/sessions", srv.handleCreatePlaybackSession)
	mux.HandleFunc("GET /api/playback/sessions/{id}", srv.handlePlaybackSession)
	mux.HandleFunc("GET /api/playback/sessions/{id}/timeline", srv.handlePlaybackTimeline)
	mux.HandleFunc("GET /api/playback/sessions/{id}/export", srv.handlePlaybackExport)
	mux.HandleFunc("POST /i/{token}/events", srv.handlePlaybackEvents)
	mux.HandleFunc("OPTIONS /i/{token}/events", srv.handlePlaybackEventsPreflight)
	mux.HandleFunc("GET /p.m3u8", srv.handleOnDemand)
	mux.HandleFunc("GET /p.mpd", srv.handleOnDemand)
	mux.HandleFunc("GET /p", srv.handleOnDemand)
	mux.HandleFunc("OPTIONS /p.m3u8", handlePreflight)
	mux.HandleFunc("OPTIONS /p.mpd", handlePreflight)
	mux.HandleFunc("OPTIONS /p", handlePreflight)
	mux.HandleFunc("GET /ws/{slug}/p.m3u8", srv.handleWorkspaceOnDemand)
	mux.HandleFunc("GET /ws/{slug}/p.mpd", srv.handleWorkspaceOnDemand)
	mux.HandleFunc("GET /ws/{slug}/p", srv.handleWorkspaceOnDemand)
	mux.HandleFunc("OPTIONS /ws/{slug}/p.m3u8", handlePreflight)
	mux.HandleFunc("OPTIONS /ws/{slug}/p.mpd", handlePreflight)
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
		Format:                   models.FormatHLS,
		ProtectionMode:           models.ProtectionClear,
		TrackSelection:           models.TracksHighest,
		CaptureProgress:          100,
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

func (s *Server) handleDeleteStream(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	st, ok := s.store.Get(id)
	if !ok {
		http.NotFound(w, r)
		return
	}
	if st.Mode != models.ModeClone {
		http.Error(w, "only cloned streams can be deleted", http.StatusBadRequest)
		return
	}
	userID, authed := s.authenticatedUserID(r)
	if !authed || st.OwnerID == nil || *st.OwnerID != userID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if st.CaptureStatus == models.CaptureQueued || st.CaptureStatus == models.CaptureCapturing {
		http.Error(w, "cannot delete a clone while capture is in progress", http.StatusConflict)
		return
	}
	if err := s.deleteCloneData(id); err != nil {
		http.Error(w, "failed to delete clone", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteCloneData(id string) error {
	cloneRoot := filepath.Clean(filepath.Join(s.cfg.StorageDir, "clones"))
	cloneDir := filepath.Join(cloneRoot, id)
	if filepath.Dir(cloneDir) != cloneRoot {
		return errors.New("invalid clone path")
	}
	trashRoot := filepath.Join(s.cfg.StorageDir, "trash")
	trashDir := filepath.Join(trashRoot, id+"-"+strconv.FormatInt(time.Now().UnixNano(), 10))
	moved := false
	if _, err := os.Stat(cloneDir); err == nil {
		if err := os.MkdirAll(trashRoot, 0o755); err != nil {
			return err
		}
		if err := os.Rename(cloneDir, trashDir); err != nil {
			return err
		}
		moved = true
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := s.store.Delete(id); err != nil {
		if moved {
			_ = os.Rename(trashDir, cloneDir)
		}
		return err
	}
	if moved {
		if err := os.RemoveAll(trashDir); err != nil {
			log.Printf("remove clone trash %s: %v", id, err)
		}
	}
	return nil
}

func (s *Server) runCloneJanitor(ctx context.Context) {
	interval := s.cfg.CloneJanitorInterval
	if interval <= 0 {
		interval = 30 * time.Minute
	}
	s.sweepCloneStorage()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.sweepCloneStorage()
		}
	}
}

func (s *Server) sweepCloneStorage() {
	expired, err := s.db.ListExpiredClones(time.Now().UTC())
	if err != nil {
		log.Printf("list expired clones: %v", err)
	} else {
		for _, stream := range expired {
			if stream.CaptureStatus == models.CaptureQueued || stream.CaptureStatus == models.CaptureCapturing {
				continue
			}
			if err := s.deleteCloneData(stream.ID); err != nil {
				log.Printf("expire clone %s: %v", stream.ID, err)
			}
		}
	}
	cleanupOldDirectories(filepath.Join(s.cfg.StorageDir, "staging"), 24*time.Hour)
	cleanupOldDirectories(filepath.Join(s.cfg.StorageDir, "trash"), time.Hour)
	known := make(map[string]bool)
	for _, stream := range s.store.All() {
		if stream.Mode == models.ModeClone {
			known[stream.ID] = true
		}
	}
	entries, readErr := os.ReadDir(filepath.Join(s.cfg.StorageDir, "clones"))
	if readErr == nil {
		for _, entry := range entries {
			if !entry.IsDir() || known[entry.Name()] {
				continue
			}
			info, statErr := entry.Info()
			if statErr == nil && time.Since(info.ModTime()) > time.Hour {
				_ = os.RemoveAll(filepath.Join(s.cfg.StorageDir, "clones", entry.Name()))
			}
		}
	}
}

func cleanupOldDirectories(root string, age time.Duration) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err == nil && time.Since(info.ModTime()) > age {
			_ = os.RemoveAll(filepath.Join(root, entry.Name()))
		}
	}
}

func (s *Server) handleAddStream(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL             string  `json:"url"`
		Label           string  `json:"label"`
		DurationSeconds float64 `json:"duration_seconds"`
		Mode            string  `json:"mode"`
		Format          string  `json:"format"`
		ProtectionMode  string  `json:"protection_mode"`
		TrackSelection  string  `json:"track_selection"`
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
	label := strings.TrimSpace(body.Label)
	if len(label) > 120 {
		http.Error(w, "label must be 120 characters or fewer", http.StatusBadRequest)
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
	format := strings.ToLower(strings.TrimSpace(body.Format))
	if format == "" {
		format = formatFromURL(rawURL)
	}
	if !models.ValidFormat(format) {
		http.Error(w, `format must be "hls" or "dash"`, http.StatusBadRequest)
		return
	}
	protection := strings.ToLower(strings.TrimSpace(body.ProtectionMode))
	if protection == "" {
		protection = models.ProtectionClear
	}
	if !models.ValidProtection(protection) {
		http.Error(w, `protection_mode must be "clear" or "clearkey"`, http.StatusBadRequest)
		return
	}
	tracks := strings.ToLower(strings.TrimSpace(body.TrackSelection))
	if tracks == "" {
		tracks = models.TracksHighest
		if protection == models.ProtectionClearKey {
			tracks = models.TracksAll
		}
	}
	if !models.ValidTrackSelection(tracks) {
		http.Error(w, `track_selection must be "highest" or "all"`, http.StatusBadRequest)
		return
	}
	if protection == models.ProtectionClearKey && (mode != models.ModeClone || format != models.FormatHLS) {
		http.Error(w, "ClearKey packaging currently requires an HLS clone source", http.StatusBadRequest)
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
		Label:                    label,
		OriginalURL:              rawURL,
		ProxyPath:                streamProxyPath(id, format),
		ActivePreset:             "clean",
		Mode:                     mode,
		CaptureStatus:            captureStatus,
		RequestedDurationSeconds: duration,
		Format:                   format,
		ProtectionMode:           protection,
		TrackSelection:           tracks,
		CreatedAt:                time.Now().UTC(),
		UpdatedAt:                time.Now().UTC(),
	}
	userID, authed := s.authenticatedUserID(r)
	if authed {
		st.OwnerID = &userID
		if slug, err := s.db.EnsureWorkspace(userID); err != nil {
			log.Printf("ensure workspace for stream: %v", err)
			http.Error(w, "failed to prepare workspace", http.StatusInternalServerError)
			return
		} else {
			st.WorkspaceSlug = &slug
		}
		if mode == models.ModeClone && s.cfg.UserQuotaBytes > 0 {
			used, err := s.store.OwnerStoredBytes(userID)
			if err != nil {
				http.Error(w, "failed to check storage quota", http.StatusInternalServerError)
				return
			}
			if used >= s.cfg.UserQuotaBytes {
				http.Error(w, "workspace clone storage quota exceeded", http.StatusConflict)
				return
			}
		}
	}
	if mode == models.ModeClone && s.cfg.CloneTTL > 0 {
		expires := time.Now().UTC().Add(s.cfg.CloneTTL)
		st.ExpiresAt = &expires
	}
	if protection == models.ProtectionClearKey {
		licensePath := "/s/" + id + "/license/clearkey"
		st.LicensePath = &licensePath
		// CENC raw-key signaling is interoperable through DASH Common PSSH.
		// The HLS source is still preserved as the capture input, but protected
		// playback uses the packaged local MPD.
		st.ProxyPath = "/s/" + id + "/manifest.mpd"
	}
	// Clone bytes live on disk, so every clone needs durable metadata even when
	// created anonymously. Ownership still controls workspace listing and edits.
	if err := s.store.Add(st, true); err != nil {
		http.Error(w, fmt.Sprintf("failed to persist stream: %v", err), http.StatusInternalServerError)
		return
	}
	if protection == models.ProtectionClearKey {
		key, err := newDRMKey(st.ID)
		if err != nil {
			_ = s.store.Delete(st.ID)
			http.Error(w, "failed to generate ClearKey material", http.StatusInternalServerError)
			return
		}
		if err := s.store.AddDRMKey(key); err != nil {
			_ = s.store.Delete(st.ID)
			http.Error(w, "failed to persist ClearKey material", http.StatusInternalServerError)
			return
		}
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

// handleLiveMock controls the in-memory HLS live projection of a ready clone.
// The clone itself stays immutable; stopping or restarting only changes the
// generated playlists, never its stored media files.
func (s *Server) handleLiveMock(w http.ResponseWriter, r *http.Request) {
	st, ok := s.store.Get(r.PathValue("id"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	userID, authed := s.authenticatedUserID(r)
	if !authed || st.OwnerID == nil || *st.OwnerID != userID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if r.Method == http.MethodGet {
		state, err := s.engine.Live().State(st)
		if err != nil {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"live": state})
		return
	}
	var body struct {
		Action         string `json:"action"`
		WindowSegments int    `json:"window_segments"`
		Loop           *bool  `json:"loop"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	state, err := s.engine.Live().Control(st, body.Action, live.Options{WindowSegments: body.WindowSegments, Loop: body.Loop})
	if err != nil {
		status := http.StatusBadRequest
		if state.Status == "stopped" && strings.TrimSpace(body.Action) != "start" && strings.TrimSpace(body.Action) != "restart" {
			status = http.StatusConflict
		}
		http.Error(w, err.Error(), status)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"live": state})
}

// handleOnDemand is the public no-signup entry point: /p.m3u8?url=<hls>&preset=&duration=
// It proxies the given HLS stream on the fly (nothing is recorded), reusing a
// deterministic stream ID per playback configuration so player refreshes keep
// working without mixing presets or duration limits. These streams are
// anonymous, memory-only and never appear in any workspace.
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
// playback configurations (including workspace scope, preset, and duration)
// share one stream instead of allocating unbounded memory. When slug is nil
// the stream is public/anonymous.
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
	if preset == "" {
		preset = models.Presets[0].Key
	}

	format := formatForRequest(r, rawURL)
	if !models.ValidFormat(format) {
		return nil, &handlerError{http.StatusBadRequest, `format must be "hls" or "dash"`}
	}
	id := onDemandIDForFormat(rawURL, slug, preset, duration, format)
	now := time.Now().UTC()
	st := &models.Stream{
		ID:                       id,
		OriginalURL:              rawURL,
		ProxyPath:                streamProxyPath(id, format),
		ActivePreset:             preset,
		Mode:                     models.ModeProxy,
		CaptureStatus:            models.CaptureReady,
		RequestedDurationSeconds: duration,
		WorkspaceSlug:            slug,
		CreatedAt:                now,
		UpdatedAt:                now,
		Format:                   format,
	}
	if existing, ok := s.store.Get(id); ok {
		st.CreatedAt = existing.CreatedAt
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

// onDemandID derives a stable stream ID from a full playback configuration, so
// simultaneous presets or duration limits for one source cannot overwrite one
// another in the in-memory store.
func onDemandID(rawURL string, slug *string, preset string, duration float64) string {
	return onDemandIDForFormat(rawURL, slug, preset, duration, formatFromURL(rawURL))
}

func onDemandIDForFormat(rawURL string, slug *string, preset string, duration float64, format string) string {
	key := strings.TrimSpace(rawURL)
	if slug != nil && *slug != "" {
		key = *slug + "\x00" + key
	}
	key += "\x00" + preset + "\x00" + strconv.FormatFloat(duration, 'f', -1, 64) + "\x00" + format
	sum := sha256.Sum256([]byte(key))
	return "od-" + hex.EncodeToString(sum[:8])
}

func formatForRequest(r *http.Request, rawURL string) string {
	if strings.HasSuffix(strings.ToLower(r.URL.Path), ".mpd") {
		return models.FormatDASH
	}
	if value := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format"))); value != "" {
		return value
	}
	return formatFromURL(rawURL)
}

func formatFromURL(rawURL string) string {
	if strings.HasSuffix(strings.ToLower(strings.Split(rawURL, "?")[0]), ".mpd") {
		return models.FormatDASH
	}
	return models.FormatHLS
}

func streamProxyPath(id, format string) string {
	if format == models.FormatDASH {
		return fmt.Sprintf("/s/%s/manifest.mpd", id)
	}
	return fmt.Sprintf("/s/%s/master.m3u8", id)
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
			if err := database.PurgePlaybackTelemetry(24*time.Hour, 7*24*time.Hour); err != nil {
				log.Printf("purge playback telemetry: %v", err)
			}
			if _, err := database.TrimProxyRequests(1000); err != nil {
				log.Printf("trim proxy requests: %v", err)
			}
		}
	}
}

type sessionListItem struct {
	Session telemetry.Session        `json:"session"`
	Summary telemetry.SessionSummary `json:"summary"`
}

func (s *Server) ownedWorkspace(r *http.Request) (string, bool) {
	userID, ok := s.authenticatedUserID(r)
	if !ok {
		return "", false
	}
	slug, err := s.db.EnsureWorkspace(userID)
	if err != nil {
		log.Printf("ensure workspace: %v", err)
		return "", false
	}
	return slug, true
}

func (s *Server) handlePlaybackSessions(w http.ResponseWriter, r *http.Request) {
	slug, ok := s.ownedWorkspace(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	streamID := strings.TrimSpace(r.URL.Query().Get("stream"))
	if streamID == "" {
		source := strings.TrimSpace(r.URL.Query().Get("source"))
		if source != "" {
			preset := strings.TrimSpace(r.URL.Query().Get("preset"))
			if preset == "" {
				preset = "clean"
			}
			streamID = onDemandID(source, &slug, preset, 60)
		}
	}
	sessions, err := s.db.ListPlaybackSessions(slug, streamID, 50)
	if err != nil {
		log.Printf("list playback sessions: %v", err)
		http.Error(w, "failed to load sessions", http.StatusInternalServerError)
		return
	}
	items := make([]sessionListItem, 0, len(sessions))
	for _, session := range sessions {
		timeline, err := s.db.PlaybackTimeline(slug, string(session.ID))
		if err != nil {
			log.Printf("summarize playback session: %v", err)
			continue
		}
		items = append(items, sessionListItem{Session: session, Summary: timeline.Summary})
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": items})
}

func (s *Server) handleCreatePlaybackSession(w http.ResponseWriter, r *http.Request) {
	slug, ok := s.ownedWorkspace(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var body struct {
		Source          string  `json:"source"`
		StreamID        string  `json:"stream_id"`
		Preset          string  `json:"preset"`
		Format          string  `json:"format"`
		PlayerName      string  `json:"player_name"`
		ContentID       string  `json:"content_id"`
		AllowedOrigin   string  `json:"allowed_origin"`
		DurationSeconds float64 `json:"duration_seconds"`
		Live            bool    `json:"live"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64*1024)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	body.Source = strings.TrimSpace(body.Source)
	body.StreamID = strings.TrimSpace(body.StreamID)
	body.Preset = strings.TrimSpace(body.Preset)
	body.Format = strings.ToLower(strings.TrimSpace(body.Format))
	if body.Preset == "" {
		body.Preset = "clean"
	}
	if !models.ValidPreset(body.Preset) {
		http.Error(w, "unknown preset", http.StatusBadRequest)
		return
	}
	duration, err := capture.ValidateDuration(body.DurationSeconds)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	streamID := body.StreamID
	playbackURL := ""
	protectionMode := models.ProtectionClear
	licenseURL := ""
	format := body.Format
	if body.Source != "" {
		if err := pubnet.ValidateURL(body.Source); err != nil {
			http.Error(w, "invalid url: "+err.Error(), http.StatusBadRequest)
			return
		}
		if format == "" {
			format = formatFromURL(body.Source)
		}
		if !models.ValidFormat(format) {
			http.Error(w, "invalid format", http.StatusBadRequest)
			return
		}
		streamID = onDemandIDForFormat(body.Source, &slug, body.Preset, duration, format)
		params := url.Values{"url": {body.Source}}
		if body.Preset != "clean" {
			params.Set("preset", body.Preset)
		}
		if duration != 60 {
			params.Set("duration", strconv.FormatFloat(duration, 'f', -1, 64))
		}
		if format == models.FormatDASH {
			playbackURL = "/ws/" + slug + "/p.mpd?" + params.Encode()
		} else {
			playbackURL = "/ws/" + slug + "/p.m3u8?" + params.Encode()
		}
	} else if streamID != "" {
		stream, exists := s.store.Get(streamID)
		if !exists || stream.WorkspaceSlug == nil || *stream.WorkspaceSlug != slug {
			http.Error(w, "stream not found", http.StatusNotFound)
			return
		}
		playbackURL = stream.ProxyPath
		format = stream.Format
		protectionMode = stream.ProtectionMode
		if body.Live {
			state, stateErr := s.engine.Live().State(stream)
			if stateErr != nil || state.Status == "stopped" {
				http.Error(w, "live mock is not running", http.StatusConflict)
				return
			}
			playbackURL = state.PlaybackPath
			format = models.FormatHLS
		}
		if stream.LicensePath != nil {
			licenseURL = *stream.LicensePath
		}
	} else {
		http.Error(w, "source or stream_id is required", http.StatusBadRequest)
		return
	}
	contentID := strings.TrimSpace(body.ContentID)
	if contentID == "" {
		sum := sha256.Sum256([]byte(streamID))
		contentID = "sm-" + hex.EncodeToString(sum[:8])
	}
	if len([]rune(contentID)) > 64 {
		http.Error(w, "content_id is too long", http.StatusBadRequest)
		return
	}
	cmcdSID := uuid.NewString()
	token, err := newOpaqueToken(24)
	if err != nil {
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}
	tokenHash := sha256.Sum256([]byte(token))
	expiresAt := time.Now().UTC().Add(time.Hour).UnixMilli()
	allowedOrigin := strings.TrimSpace(body.AllowedOrigin)
	if allowedOrigin == "" {
		allowedOrigin = strings.TrimSpace(r.Header.Get("Origin"))
	}
	session, err := s.db.CreatePlaybackSession(db.PlaybackSessionCreate{
		WorkspaceSlug: slug, StreamID: streamID, CMCDSessionID: cmcdSID, ContentID: &contentID,
		InitialPreset: body.Preset, UserAgent: r.UserAgent(), TokenHash: hex.EncodeToString(tokenHash[:]), TokenExpiresMS: expiresAt, AllowedOrigin: allowedOrigin,
	})
	if err != nil {
		log.Printf("create playback session: %v", err)
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"session": session, "cmcd_session_id": cmcdSID, "content_id": contentID, "playback_url": playbackURL,
		"ingest_url": "/i/" + token + "/events", "ingest_expires_at_ms": expiresAt,
		"protection_mode": protectionMode, "license_url": licenseURL,
	})
}

func (s *Server) playbackTimelineForOwner(w http.ResponseWriter, r *http.Request) (telemetry.Timeline, bool) {
	slug, ok := s.ownedWorkspace(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return telemetry.Timeline{}, false
	}
	timeline, err := s.db.PlaybackTimeline(slug, r.PathValue("id"))
	if err != nil {
		if db.IsNotFound(err) {
			http.NotFound(w, r)
		} else {
			log.Printf("load playback timeline: %v", err)
			http.Error(w, "failed to load playback session", http.StatusInternalServerError)
		}
		return telemetry.Timeline{}, false
	}
	return timeline, true
}

func (s *Server) handlePlaybackSession(w http.ResponseWriter, r *http.Request) {
	timeline, ok := s.playbackTimelineForOwner(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": timeline.Session, "summary": timeline.Summary, "findings": diagnostics.Analyze(timeline)})
}

func (s *Server) handlePlaybackTimeline(w http.ResponseWriter, r *http.Request) {
	timeline, ok := s.playbackTimelineForOwner(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"timeline": timeline, "findings": diagnostics.Analyze(timeline)})
}

func (s *Server) handlePlaybackExport(w http.ResponseWriter, r *http.Request) {
	timeline, ok := s.playbackTimelineForOwner(w, r)
	if !ok {
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="streammock-playback-`+r.PathValue("id")+`.json"`)
	writeJSON(w, http.StatusOK, map[string]any{"schema_version": 1, "exported_at_ms": time.Now().UTC().UnixMilli(), "timeline": timeline, "findings": diagnostics.Analyze(timeline)})
}

func (s *Server) handlePlaybackEventsPreflight(w http.ResponseWriter, r *http.Request) {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		origin = "*"
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Access-Control-Max-Age", "600")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handlePlaybackEvents(w http.ResponseWriter, r *http.Request) {
	rawToken := r.PathValue("token")
	if len(rawToken) < 24 || len(rawToken) > 128 {
		http.Error(w, "invalid ingest token", http.StatusUnauthorized)
		return
	}
	tokenHash := sha256.Sum256([]byte(rawToken))
	hash := hex.EncodeToString(tokenHash[:])
	if s.ingestLimiter != nil && !s.ingestLimiter.Allow(hash[:16]+":"+ratelimit.ClientIP(r)) {
		http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
		return
	}
	session, allowedOrigin, err := s.db.ResolveIngestSession(hash, time.Now().UTC().UnixMilli())
	if err != nil {
		http.Error(w, "invalid or expired ingest token", http.StatusUnauthorized)
		return
	}
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if allowedOrigin != "" && origin != "" && origin != allowedOrigin {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	if origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	}
	r.Body = http.MaxBytesReader(w, r.Body, 256*1024)
	var batch struct {
		Events []telemetry.PlaybackEvent `json:"events"`
	}
	if err := json.NewDecoder(r.Body).Decode(&batch); err != nil {
		http.Error(w, "invalid event batch", http.StatusBadRequest)
		return
	}
	if len(batch.Events) == 0 || len(batch.Events) > 20 {
		http.Error(w, "event batch must contain 1 to 20 events", http.StatusBadRequest)
		return
	}
	for i := range batch.Events {
		if err := validatePlaybackEvent(batch.Events[i]); err != nil {
			http.Error(w, fmt.Sprintf("invalid event %d: %v", i, err), http.StatusBadRequest)
			return
		}
	}
	inserted, err := s.db.InsertPlaybackEvents(string(session.ID), batch.Events)
	if err != nil {
		log.Printf("ingest playback events: %v", err)
		http.Error(w, "failed to ingest events", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"accepted": inserted, "duplicates": int64(len(batch.Events)) - inserted})
}

var playbackEventTypes = map[string]bool{
	"session_started": true, "session_ended": true, "play_requested": true, "first_frame": true, "playing": true,
	"buffering_started": true, "buffering_ended": true, "seek_started": true, "seek_ended": true, "paused": true, "resumed": true,
	"ended": true, "media_error": true, "visibility_changed": true, "media_snapshot": true,
	"manifest_loading": true, "manifest_loaded": true, "manifest_parsed": true, "fragment_loading": true, "fragment_loaded": true,
	"fragment_parsed": true, "fragment_buffered": true, "buffer_appended": true, "buffer_append_error": true,
	"level_switching": true, "level_switched": true, "emergency_downswitch": true, "fps_drop": true,
	"stall_detected": true, "stall_resolved": true, "hls_error": true,
	"adaptation": true, "quality_changed": true, "gap_jumped": true,
	"segment_downloaded": true, "segment_download_failed": true, "shaka_error": true,
	"drm_session_updated": true, "drm_key_status_changed": true, "drm_expiration_updated": true,
	"license_request_completed": true, "license_request_failed": true,
}

func validatePlaybackEvent(event telemetry.PlaybackEvent) error {
	if _, err := uuid.Parse(event.ID); err != nil {
		return errors.New("id must be a UUID")
	}
	if !playbackEventTypes[event.EventType] {
		return errors.New("unknown event_type")
	}
	if event.SequenceNumber < 0 || event.WallTimeMS <= 0 || event.MonotonicMS < 0 {
		return errors.New("invalid timestamp or sequence")
	}
	if event.PayloadJSON != nil {
		if len(*event.PayloadJSON) > 16*1024 || !json.Valid([]byte(*event.PayloadJSON)) {
			return errors.New("payload_json must be valid JSON up to 16 KiB")
		}
	}
	return nil
}

func newOpaqueToken(bytes int) (string, error) {
	buffer := make([]byte, bytes)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return hex.EncodeToString(buffer), nil
}

func newDRMKey(streamID string) (models.DRMKey, error) {
	kid := make([]byte, 16)
	key := make([]byte, 16)
	if _, err := rand.Read(kid); err != nil {
		return models.DRMKey{}, err
	}
	if _, err := rand.Read(key); err != nil {
		return models.DRMKey{}, err
	}
	return models.DRMKey{StreamID: streamID, KIDHex: hex.EncodeToString(kid), KeyHex: hex.EncodeToString(key), Label: "STREAMMOCK"}, nil
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
	storedBytes, err := s.store.OwnerStoredBytes(userID)
	if err != nil {
		http.Error(w, "failed to load workspace storage", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"slug":            slug,
		"playback_url":    fmt.Sprintf("/ws/%s/p.m3u8", slug),
		"stored_bytes":    storedBytes,
		"quota_bytes":     s.cfg.UserQuotaBytes,
		"clone_ttl_hours": int(s.cfg.CloneTTL.Hours()),
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
	mode := strings.TrimSpace(r.URL.Query().Get("mode"))
	if mode == "" {
		mode = models.ModeProxy
	}
	if mode != models.ModeProxy && mode != models.ModeClone {
		http.Error(w, "invalid mode", http.StatusBadRequest)
		return
	}
	streamID := strings.TrimSpace(r.URL.Query().Get("stream"))
	if mode == models.ModeProxy && streamID == "" {
		source := strings.TrimSpace(r.URL.Query().Get("source"))
		if source != "" {
			preset := strings.TrimSpace(r.URL.Query().Get("preset"))
			if preset == "" {
				preset = models.Presets[0].Key
			}
			streamID = onDemandID(source, &slug, preset, 60)
		}
	}
	if r.Method == http.MethodDelete {
		if streamID == "" {
			http.Error(w, "a stream is required to clear activity", http.StatusBadRequest)
			return
		}
		if _, err := s.db.DeleteProxyRequests(slug, mode, streamID); err != nil {
			log.Printf("clear proxy requests: %v", err)
			http.Error(w, "failed to clear activity", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	requests, err := s.db.ListProxyRequests(slug, mode, streamID, 20)
	if err != nil {
		log.Printf("list proxy requests: %v", err)
		http.Error(w, "failed to load requests", http.StatusInternalServerError)
		return
	}
	if requests == nil {
		requests = []models.ProxyRequest{}
	}
	rangeSummary := map[string]int{"requested": 0, "satisfied": 0, "issues": 0}
	for _, req := range requests {
		if req.ClientRange == "" {
			continue
		}
		rangeSummary["requested"]++
		if req.RangeResult == "satisfied" {
			rangeSummary["satisfied"]++
		} else {
			rangeSummary["issues"]++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"requests":      requests,
		"range_summary": rangeSummary,
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
