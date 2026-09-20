package proxy

import (
	"bytes"
	"encoding/base64"
	"encoding/xml"
	"fmt"
	"io"
	"net/url"
	"path"
	"strings"

	"streammock/internal/basepath"
)

const maxDASHManifestBytes = 1 << 20

// transformDASHManifest performs XML-aware URL rewriting. Relative
// SegmentTemplate values remain relative: the injected BaseURL routes them
// through StreamMock while leaving DASH replacement tokens for the player.
func (e *Engine) transformDASHManifest(body []byte, base *url.URL, streamID string) ([]byte, error) {
	if len(body) > maxDASHManifestBytes {
		return nil, fmt.Errorf("DASH manifest exceeds %d bytes", maxDASHManifestBytes)
	}
	decoder := xml.NewDecoder(bytes.NewReader(body))
	var output bytes.Buffer
	encoder := xml.NewEncoder(&output)
	type frame struct {
		base    *url.URL
		baseURL bool
	}
	stack := []frame{{base: dashDirectory(base)}}
	seenRoot := false
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("invalid DASH XML: %w", err)
		}
		switch value := token.(type) {
		case xml.Directive:
			if strings.Contains(strings.ToUpper(string(value)), "DOCTYPE") {
				return nil, fmt.Errorf("DASH manifests with DOCTYPE are not supported")
			}
			if err := encoder.EncodeToken(value); err != nil {
				return nil, err
			}
		case xml.StartElement:
			if len(stack) > 96 {
				return nil, fmt.Errorf("DASH manifest is too deeply nested")
			}
			parent := &stack[len(stack)-1]
			start := value.Copy()
			if start.Name.Local != "BaseURL" {
				start.Attr = e.rewriteDASHAttributes(start.Attr, parent.base, streamID)
			}
			if err := encoder.EncodeToken(start); err != nil {
				return nil, err
			}
			stack = append(stack, frame{base: parent.base, baseURL: start.Name.Local == "BaseURL"})
			if !seenRoot && start.Name.Local == "MPD" {
				seenRoot = true
				if err := encoder.EncodeToken(xml.StartElement{Name: xml.Name{Local: "BaseURL"}}); err != nil {
					return nil, err
				}
				if err := encoder.EncodeToken(xml.CharData([]byte(e.dashProxyBase(streamID, parent.base)))); err != nil {
					return nil, err
				}
				if err := encoder.EncodeToken(xml.EndElement{Name: xml.Name{Local: "BaseURL"}}); err != nil {
					return nil, err
				}
			}
		case xml.CharData:
			if len(stack) > 1 && stack[len(stack)-1].baseURL {
				parent := &stack[len(stack)-2]
				reference := strings.TrimSpace(string(value))
				if reference == "" {
					continue
				}
				resolved, err := resolveDASHURL(parent.base, reference)
				if err != nil {
					return nil, err
				}
				parent.base = resolved
				if err := encoder.EncodeToken(xml.CharData([]byte(e.dashProxyBase(streamID, resolved)))); err != nil {
					return nil, err
				}
				continue
			}
			if err := encoder.EncodeToken(value); err != nil {
				return nil, err
			}
		case xml.EndElement:
			if len(stack) <= 1 {
				return nil, fmt.Errorf("invalid DASH XML nesting")
			}
			if err := encoder.EncodeToken(value); err != nil {
				return nil, err
			}
			stack = stack[:len(stack)-1]
		default:
			if err := encoder.EncodeToken(value); err != nil {
				return nil, err
			}
		}
	}
	if !seenRoot {
		return nil, fmt.Errorf("source is not a DASH MPD")
	}
	if err := encoder.Flush(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func dashDirectory(value *url.URL) *url.URL {
	copy := *value
	copy.RawQuery, copy.Fragment = "", ""
	copy.Path = path.Dir(copy.Path) + "/"
	if copy.Path == "//" {
		copy.Path = "/"
	}
	return &copy
}

func resolveDASHURL(base *url.URL, reference string) (*url.URL, error) {
	parsed, err := url.Parse(reference)
	if err != nil {
		return nil, fmt.Errorf("invalid DASH URL: %w", err)
	}
	resolved := base.ResolveReference(parsed)
	if resolved.Scheme != "http" && resolved.Scheme != "https" {
		return nil, fmt.Errorf("unsupported DASH URL scheme")
	}
	return resolved, nil
}

func (e *Engine) dashProxyBase(streamID string, origin *url.URL) string {
	encoded := base64.RawURLEncoding.EncodeToString([]byte(origin.String()))
	return basepath.Path("/s/" + streamID + "/d/" + encoded + "/")
}

func (e *Engine) rewriteDASHAttributes(attrs []xml.Attr, base *url.URL, streamID string) []xml.Attr {
	for i := range attrs {
		name := attrs[i].Name.Local
		if name != "media" && name != "initialization" && name != "sourceURL" && name != "index" {
			continue
		}
		value := strings.TrimSpace(attrs[i].Value)
		if value == "" || !dashAbsoluteReference(value) {
			continue
		}
		resolved, err := resolveDASHURL(base, value)
		if err != nil {
			continue
		}
		file := path.Base(resolved.Path)
		if file == "." || file == "/" || file == "" {
			continue
		}
		attrs[i].Value = e.dashProxyBase(streamID, dashDirectory(resolved)) + file
	}
	return attrs
}

func dashAbsoluteReference(value string) bool {
	u, err := url.Parse(value)
	return err == nil && u.IsAbs()
}
