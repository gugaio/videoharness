package main

import (
	"context"
	"crypto/rand"
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
	"strings"
	"syscall"
	"time"

	"streammock/internal/capture"
	"streammock/internal/config"
	"streammock/internal/db"
	"streammock/internal/models"
	"streammock/internal/proxy"
	"streammock/internal/store"

	"github.com/clerk/clerk-sdk-go/v2"
	"github.com/clerk/clerk-sdk-go/v2/jwt"
)

type Server struct {
	cfg     config.Config
	store   *store.MemoryStore
	engine  *proxy.Engine
	capture *capture.Manager
}

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
	captureManager := capture.NewManager(cfg, mem)
	captureCtx, cancelCapture := context.WithCancel(context.Background())
	defer cancelCapture()
	captureManager.Start(captureCtx)

	srv := &Server{
		cfg:     cfg,
		store:   mem,
		engine:  engine,
		capture: captureManager,
	}

	mux := http.NewServeMux()
	registerFrontend(mux)
	mux.HandleFunc("GET /api/health", handleHealth)
	mux.HandleFunc("GET /api/streams", srv.handleListStreams)
	mux.HandleFunc("GET /api/streams/{id}", srv.handleGetStream)
	mux.HandleFunc("POST /api/streams", srv.handleAddStream)
	mux.HandleFunc("POST /api/streams/{id}/preset", srv.handleSetPreset)
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
