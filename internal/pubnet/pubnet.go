// Package pubnet provides outbound HTTP primitives restricted to public
// internet destinations. Every request is validated and dialed so hosts that
// resolve to private, loopback, link-local or multicast addresses are refused,
// which prevents SSRF when proxying attacker-supplied URLs.
//
// Operators may opt out for local development and integration tests by setting
// STREAMMOCK_ALLOW_PRIVATE_TARGETS to 1/true/yes.
package pubnet

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const maxRedirectHops = 4

// AllowPrivateTargets reports whether SSRF protection has been disabled via
// STREAMMOCK_ALLOW_PRIVATE_TARGETS. Checked on every call so tests can toggle
// it at runtime.
func AllowPrivateTargets() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("STREAMMOCK_ALLOW_PRIVATE_TARGETS"))) {
	case "1", "true", "yes":
		return true
	default:
		return false
	}
}

// PublicIP reports whether ip is a globally reachable unicast address.
func PublicIP(ip net.IP) bool {
	return ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !ip.IsLinkLocalMulticast() && !ip.IsMulticast() && !ip.IsUnspecified()
}

// ValidateURL enforces the structural requirements (http(s), non-empty host,
// no embedded credentials) always, and refuses private-address targets unless
// private targets are allowed.
func ValidateURL(rawURL string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}
	if (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil {
		return errors.New("URL must be HTTP(S), have a host, and contain no credentials")
	}
	if AllowPrivateTargets() {
		return nil
	}
	if host := parsed.Hostname(); net.ParseIP(host) != nil {
		if !PublicIP(net.ParseIP(host)) {
			return errors.New("URL cannot target a private address")
		}
	}
	return nil
}

// NewTransport builds an http.Transport whose connections can only target
// public addresses. Hostnames are resolved ahead of dialing so DNS rebinding
// cannot smuggle a private IP past URL validation.
func NewTransport(timeout time.Duration) *http.Transport {
	dialer := &net.Dialer{Timeout: timeout}
	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS12}
	if AllowPrivateTargets() {
		return &http.Transport{
			TLSClientConfig: tlsConfig,
			Proxy:           http.ProxyFromEnvironment,
		}
	}
	return &http.Transport{
		Proxy:           nil,
		TLSClientConfig: tlsConfig,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
			if err != nil {
				return nil, fmt.Errorf("resolve host %q: %w", host, err)
			}
			for _, ip := range ips {
				if !PublicIP(net.IP(ip.AsSlice())) {
					continue
				}
				return dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			}
			return nil, fmt.Errorf("host %q does not resolve to a public address", host)
		},
	}
}

// NewHTTPClient returns an http.Client bound to a validated transport. Every
// redirect hop is validated again, with a hard hop limit.
func NewHTTPClient(timeout time.Duration) *http.Client {
	client := &http.Client{
		Timeout:   timeout,
		Transport: NewTransport(timeout),
	}
	if !AllowPrivateTargets() {
		client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirectHops {
				return errors.New("exceeded redirect limit")
			}
			return ValidateURL(req.URL.String())
		}
	} else {
		client.CheckRedirect = func(_ *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirectHops {
				return errors.New("exceeded redirect limit")
			}
			return nil
		}
	}
	return client
}
