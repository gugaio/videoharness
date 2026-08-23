package store

import (
	"fmt"
	"sync"
	"time"

	"streammock/internal/db"
	"streammock/internal/models"
)

type MemoryStore struct {
	db        *db.DB
	streams   sync.Map // map[streamID]*models.Stream
	resources sync.Map // map[streamID/logicalPath]models.Resource
}

func New(database *db.DB) *MemoryStore {
	return &MemoryStore{db: database}
}

func (s *MemoryStore) LoadAll(streams []models.Stream) {
	for i := range streams {
		st := streams[i]
		s.streams.Store(st.ID, &st)
		resources, err := s.db.ListResources(st.ID)
		if err != nil {
			continue
		}
		for _, resource := range resources {
			s.resources.Store(resourceKey(st.ID, resource.LogicalPath), resource)
		}
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

// Add stores the stream in memory and, when persist is true, writes it to the database.
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

func (s *MemoryStore) MarkCapturing(id string) error {
	if err := s.db.UpdateCaptureStatus(id, models.CaptureCapturing); err != nil {
		return err
	}
	s.update(id, func(st *models.Stream) {
		st.CaptureStatus = models.CaptureCapturing
		st.ErrorCode = nil
		st.ErrorMessage = nil
		st.UpdatedAt = time.Now().UTC()
	})
	return nil
}

func (s *MemoryStore) CompleteClone(id string, duration float64, totalBytes int64, storageKey string, resources []models.Resource) error {
	if err := s.db.CompleteClone(id, duration, totalBytes, storageKey, resources); err != nil {
		return err
	}
	for _, resource := range resources {
		s.resources.Store(resourceKey(id, resource.LogicalPath), resource)
	}
	resourceCount := len(resources)
	s.update(id, func(st *models.Stream) {
		st.CaptureStatus = models.CaptureReady
		st.DurationSeconds = &duration
		st.TotalBytes = &totalBytes
		st.ResourceCount = &resourceCount
		st.StorageKey = &storageKey
		st.ErrorCode = nil
		st.ErrorMessage = nil
		st.UpdatedAt = time.Now().UTC()
	})
	return nil
}

func (s *MemoryStore) FailClone(id, code, message string) error {
	if err := s.db.FailClone(id, code, message); err != nil {
		return err
	}
	s.update(id, func(st *models.Stream) {
		st.CaptureStatus = models.CaptureFailed
		st.ErrorCode = &code
		st.ErrorMessage = &message
		st.UpdatedAt = time.Now().UTC()
	})
	return nil
}

func (s *MemoryStore) GetResource(streamID, logicalPath string) (models.Resource, bool) {
	v, ok := s.resources.Load(resourceKey(streamID, logicalPath))
	if !ok {
		return models.Resource{}, false
	}
	return v.(models.Resource), true
}

func (s *MemoryStore) update(id string, mutate func(*models.Stream)) {
	v, ok := s.streams.Load(id)
	if !ok {
		return
	}
	cp := *v.(*models.Stream)
	mutate(&cp)
	s.streams.Store(id, &cp)
}

func resourceKey(streamID, logicalPath string) string {
	return streamID + "\x00" + logicalPath
}

func (s *MemoryStore) GetPreset(id string) (string, bool) {
	st, ok := s.Get(id)
	if !ok {
		return "", false
	}
	return st.ActivePreset, true
}
