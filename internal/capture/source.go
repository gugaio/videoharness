package capture

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type sourceClient struct {
	client *http.Client
}

func newSourceClient(timeout time.Duration) *sourceClient {
	dialer := &net.Dialer{Timeout: timeout}
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
			if err != nil {
				return nil, fmt.Errorf("resolve source host: %w", err)
			}
			for _, ip := range ips {
				if !publicIP(net.IP(ip.AsSlice())) {
					continue
				}
				return dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			}
			return nil, errors.New("source host does not resolve to a public address")
		},
		TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12},
	}
	return &sourceClient{client: &http.Client{
		Timeout:   timeout,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 4 {
				return errors.New("source exceeded redirect limit")
			}
			return validateSourceURL(req.URL.String())
		},
	}}
}

func (c *sourceClient) get(ctx context.Context, rawURL string) (*http.Response, error) {
	if err := validateSourceURL(rawURL); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "StreamMock/0.2 clone-capture")
	req.Header.Set("Accept-Encoding", "identity")
	response, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		response.Body.Close()
		return nil, fmt.Errorf("source returned %s", response.Status)
	}
	return response, nil
}

func (c *sourceClient) text(ctx context.Context, rawURL string, maxBytes int64) ([]byte, *url.URL, error) {
	response, err := c.get(ctx, rawURL)
	if err != nil {
		return nil, nil, err
	}
	defer response.Body.Close()
	body, err := readLimited(response.Body, maxBytes)
	if err != nil {
		return nil, nil, err
	}
	return body, response.Request.URL, nil
}

func publicIP(ip net.IP) bool {
	return ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !ip.IsLinkLocalMulticast() && !ip.IsMulticast() && !ip.IsUnspecified()
}

func validateSourceURL(rawURL string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid source URL: %w", err)
	}
	if (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil {
		return errors.New("source URL must be HTTP(S), have a host, and contain no credentials")
	}
	if host := parsed.Hostname(); net.ParseIP(host) != nil {
		if !publicIP(net.ParseIP(host)) {
			return errors.New("source URL cannot target a private address")
		}
	}
	return nil
}

func readLimited(reader io.Reader, maxBytes int64) ([]byte, error) {
	if maxBytes <= 0 {
		return nil, errors.New("invalid response limit")
	}
	body, err := io.ReadAll(io.LimitReader(reader, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > maxBytes {
		return nil, errors.New("source response exceeds size limit")
	}
	return body, nil
}

func copyLimited(dst io.Writer, src io.Reader, maxBytes int64) (int64, error) {
	if maxBytes <= 0 {
		return 0, errors.New("clone byte limit exceeded")
	}
	n, err := io.Copy(dst, io.LimitReader(src, maxBytes+1))
	if err != nil {
		return n, err
	}
	if n > maxBytes {
		return n, errors.New("clone byte limit exceeded")
	}
	return n, nil
}

func sourceErrorCode(err error) string {
	var captureErr *captureError
	if errors.As(err, &captureErr) {
		return captureErr.code
	}
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "size limit") || strings.Contains(message, "byte limit") {
		return "SOURCE_TOO_LARGE"
	}
	if strings.Contains(message, "private") || strings.Contains(message, "public address") {
		return "SOURCE_DESTINATION_BLOCKED"
	}
	if strings.Contains(message, "timeout") || errors.Is(err, context.DeadlineExceeded) {
		return "SOURCE_TIMEOUT"
	}
	return "CAPTURE_FAILED"
}
