package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"streammock/internal/config"
)

func TestServiceTokenResolvesInjectedOwner(t *testing.T) {
	srv := &Server{cfg: config.Config{ServiceToken: "internal-secret"}}

	req := httptest.NewRequest(http.MethodGet, "/api/streams", nil)
	req.Header.Set("X-Service-Token", "internal-secret")
	req.Header.Set("X-Owner-Id", "user_123")
	owner, ok := srv.authenticatedUserID(req)
	if !ok || owner != "user_123" {
		t.Fatalf("service token must resolve injected owner, got (%q, %v)", owner, ok)
	}
}

func TestServiceTokenRejectsWrongOrIncompleteCredentials(t *testing.T) {
	srv := &Server{cfg: config.Config{ServiceToken: "internal-secret"}}

	wrongToken := httptest.NewRequest(http.MethodGet, "/api/streams", nil)
	wrongToken.Header.Set("X-Service-Token", "not-the-secret")
	wrongToken.Header.Set("X-Owner-Id", "user_123")
	if owner, ok := srv.authenticatedUserID(wrongToken); ok {
		t.Fatalf("wrong service token must not authenticate, got owner %q", owner)
	}

	missingOwner := httptest.NewRequest(http.MethodGet, "/api/streams", nil)
	missingOwner.Header.Set("X-Service-Token", "internal-secret")
	if owner, ok := srv.authenticatedUserID(missingOwner); ok {
		t.Fatalf("service token without owner must not authenticate, got owner %q", owner)
	}
}

func TestServiceTokenModeDisabledWithoutConfig(t *testing.T) {
	srv := &Server{cfg: config.Config{}}

	req := httptest.NewRequest(http.MethodGet, "/api/streams", nil)
	req.Header.Set("X-Service-Token", "internal-secret")
	req.Header.Set("X-Owner-Id", "user_123")
	if owner, ok := srv.authenticatedUserID(req); ok {
		t.Fatalf("service token mode must stay disabled when unconfigured, got owner %q", owner)
	}
}
