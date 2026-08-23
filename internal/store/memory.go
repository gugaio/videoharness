package store

import (
	"fmt"
	"sync"

	"streammock/internal/db"
	"streammock/internal/models"
)

type MemoryStore struct {
	db      *db.DB
	streams sync.Map // map[streamID]*models.Stream
}

func New(database *db.DB) *MemoryStore {
	return &MemoryStore{db: database}
}

func (s *MemoryStore) LoadAll(streams []models.Stream) {
	for i := range streams {
		st := streams[i]
		s.streams.Store(st.ID, &st)
	}
}

func (s *MemoryStore) Get(id string) (*models.Stream, bool) {
	v, ok := s.streams.Load(id)
	if !ok {
		return nil, false
	}
	return v.(*models.Stream), true
}

func (s *MemoryStore) All() []models.Stream {
	var out []models.Stream
	s.streams.Range(func(_, v any) bool {
		if st, ok := v.(*models.Stream); ok {
			out = append(out, *st)
		}
		return true
	})
	return out
}

// Add stores the stream in memory and, when persist is true, writes it to the
// database. Anonymous clones are ephemeral (persist=false) and vanish on restart.
func (s *MemoryStore) Add(st models.Stream, persist bool) error {
	if persist {
		if err := s.db.InsertStream(st); err != nil {
			return err
		}
	}
	cp := st
	s.streams.Store(cp.ID, &cp)
	return nil
}

func (s *MemoryStore) ListByOwner(ownerID string) []models.Stream {
	var out []models.Stream
	s.streams.Range(func(_, v any) bool {
		st, ok := v.(*models.Stream)
		if !ok || st.OwnerID == nil || *st.OwnerID != ownerID {
			return true
		}
		out = append(out, *st)
		return true
	})
	return out
}

func (s *MemoryStore) SetPreset(id, preset string) error {
	if !models.ValidPreset(preset) {
		return fmt.Errorf("invalid preset %q", preset)
	}
	if err := s.db.UpdatePreset(id, preset); err != nil {
		return err
	}
	if v, ok := s.streams.Load(id); ok {
		cp := *v.(*models.Stream)
		cp.ActivePreset = preset
		s.streams.Store(id, &cp)
	}
	return nil
}

func (s *MemoryStore) GetPreset(id string) (string, bool) {
	st, ok := s.Get(id)
	if !ok {
		return "", false
	}
	return st.ActivePreset, true
}
