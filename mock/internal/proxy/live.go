package proxy

import (
	"errors"
	"net/http"

	"streammock/internal/live"
	"streammock/internal/models"
)

// Live returns the controller used by the HTTP API. It is memory-only by
// design: restarting a StreamMock instance also resets every live scenario.
func (e *Engine) Live() *live.Manager { return e.live }

func (e *Engine) serveLiveMaster(w http.ResponseWriter, r *http.Request) {
	st, ok := e.store.Get(r.PathValue("id"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	sw, done := e.track(w, r, st, models.KindMaster, live.PlaybackPath(st.ID))
	defer done()
	if e.applyChaos(sw, r, true, st.ActivePreset) {
		return
	}
	body, err := e.live.Master(st)
	if err != nil {
		serveLiveError(sw, err)
		return
	}
	writeLivePlaylist(sw, body)
}

func (e *Engine) serveLiveResource(w http.ResponseWriter, r *http.Request) {
	st, ok := e.store.Get(r.PathValue("id"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	logicalPath := r.PathValue("resource")
	resource, ok := e.store.GetResource(st.ID, logicalPath)
	if !ok {
		http.NotFound(w, r)
		return
	}
	sw, done := e.track(w, r, st, kindForPlaylistPath(logicalPath), logicalPath)
	defer done()
	if resource.Kind != "media-playlist" {
		// Assets use the ordinary local path implementation so byte ranges,
		// headers and segment chaos behavior stay identical to VOD clones.
		e.serveLocalResource(sw, r, st, logicalPath)
		return
	}
	if e.applyChaos(sw, r, true, st.ActivePreset) {
		return
	}
	body, err := e.live.Media(st, logicalPath)
	if err != nil {
		serveLiveError(sw, err)
		return
	}
	writeLivePlaylist(sw, body)
}

func writeLivePlaylist(w http.ResponseWriter, body []byte) {
	setCORS(w.Header())
	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

func serveLiveError(w http.ResponseWriter, err error) {
	if errors.Is(err, live.ErrStopped) {
		http.Error(w, "live mock is stopped; start it from the workspace", http.StatusConflict)
		return
	}
	if err.Error() == "live mocks require a ready, clear HLS clone" {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	http.Error(w, err.Error(), http.StatusBadRequest)
}
