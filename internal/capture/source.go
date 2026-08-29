package capture

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"streammock/internal/pubnet"
)

type sourceClient struct {
	client *http.Client
}

func newSourceClient(timeout time.Duration) *sourceClient {
	return &sourceClient{client: pubnet.NewHTTPClient(timeout)}
}

func (c *sourceClient) get(ctx context.Context, rawURL string) (*http.Response, error) {
	if err := pubnet.ValidateURL(rawURL); err != nil {
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
