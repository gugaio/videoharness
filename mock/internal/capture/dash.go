package capture

import (
	"context"
	"encoding/xml"
	"fmt"
	"net/url"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"streammock/internal/models"
)

type dashMPD struct {
	XMLName                   xml.Name     `xml:"MPD"`
	Type                      string       `xml:"type,attr"`
	MediaPresentationDuration string       `xml:"mediaPresentationDuration,attr"`
	BaseURL                   string       `xml:"BaseURL"`
	Periods                   []dashPeriod `xml:"Period"`
	ContentProtection         []xml.Name   `xml:"ContentProtection"`
}
type dashPeriod struct {
	Duration          string              `xml:"duration,attr"`
	BaseURL           string              `xml:"BaseURL"`
	AdaptationSets    []dashAdaptationSet `xml:"AdaptationSet"`
	ContentProtection []xml.Name          `xml:"ContentProtection"`
}
type dashAdaptationSet struct {
	ContentType       string               `xml:"contentType,attr"`
	MimeType          string               `xml:"mimeType,attr"`
	Codecs            string               `xml:"codecs,attr"`
	BaseURL           string               `xml:"BaseURL"`
	SegmentTemplate   dashSegmentTemplate  `xml:"SegmentTemplate"`
	SegmentList       dashSegmentList      `xml:"SegmentList"`
	Representations   []dashRepresentation `xml:"Representation"`
	ContentProtection []xml.Name           `xml:"ContentProtection"`
}
type dashRepresentation struct {
	ID                string              `xml:"id,attr"`
	Bandwidth         int                 `xml:"bandwidth,attr"`
	MimeType          string              `xml:"mimeType,attr"`
	Codecs            string              `xml:"codecs,attr"`
	BaseURL           string              `xml:"BaseURL"`
	SegmentTemplate   dashSegmentTemplate `xml:"SegmentTemplate"`
	SegmentList       dashSegmentList     `xml:"SegmentList"`
	ContentProtection []xml.Name          `xml:"ContentProtection"`
}
type dashSegmentTemplate struct {
	Timescale      int64               `xml:"timescale,attr"`
	Duration       int64               `xml:"duration,attr"`
	StartNumber    int64               `xml:"startNumber,attr"`
	Media          string              `xml:"media,attr"`
	Initialization string              `xml:"initialization,attr"`
	Timeline       dashSegmentTimeline `xml:"SegmentTimeline"`
}
type dashSegmentTimeline struct {
	Segments []dashTimelineSegment `xml:"S"`
}
type dashTimelineSegment struct {
	Time     int64 `xml:"t,attr"`
	Duration int64 `xml:"d,attr"`
	Repeat   int64 `xml:"r,attr"`
}
type dashSegmentList struct {
	Timescale      int64            `xml:"timescale,attr"`
	Duration       int64            `xml:"duration,attr"`
	Initialization dashURLSource    `xml:"Initialization"`
	Segments       []dashSegmentURL `xml:"SegmentURL"`
}
type dashURLSource struct {
	SourceURL string `xml:"sourceURL,attr"`
}
type dashSegmentURL struct {
	Media string `xml:"media,attr"`
}

type dashTrack struct {
	kind, id, mimeType, codecs string
	bandwidth                  int
	base                       *url.URL
	template                   dashSegmentTemplate
	segmentList                dashSegmentList
	hasSegmentList             bool
}
type dashSegment struct {
	url          string
	duration     float64
	time, number int64
}

func (m *Manager) materializeDASH(ctx context.Context, stream models.Stream, workspace string) (materialized, error) {
	body, manifestURL, err := m.source.text(ctx, stream.OriginalURL, maxManifestBytes)
	if err != nil {
		return materialized{}, err
	}
	var mpd dashMPD
	if err := xml.Unmarshal(body, &mpd); err != nil || mpd.XMLName.Local != "MPD" {
		return materialized{}, unsupported("source is not a DASH MPD")
	}
	if strings.EqualFold(mpd.Type, "dynamic") {
		return materialized{}, unsupported("live DASH is not supported yet")
	}
	if len(mpd.Periods) != 1 {
		return materialized{}, unsupported("DASH clones currently require exactly one Period")
	}
	period := mpd.Periods[0]
	if len(mpd.ContentProtection) > 0 || len(period.ContentProtection) > 0 {
		return materialized{}, unsupported("encrypted DASH is not supported yet")
	}
	duration, err := ValidateDuration(stream.RequestedDurationSeconds)
	if err != nil {
		return materialized{}, err
	}
	presentationDuration, err := dashDuration(firstNonEmpty(period.Duration, mpd.MediaPresentationDuration))
	if err != nil || presentationDuration <= 0 {
		return materialized{}, unsupported("static DASH requires a finite presentation duration")
	}
	rootBase := dashCaptureBase(manifestURL, mpd.BaseURL)
	video, err := selectDASHTrack(period, rootBase, "video")
	if err != nil {
		return materialized{}, err
	}
	var audio *dashTrack
	if selected, audioErr := selectDASHTrack(period, rootBase, "audio"); audioErr == nil {
		audio = &selected
	}
	videoSegments, actualDuration, err := expandDASHSegments(video, minFloat(duration, presentationDuration))
	if err != nil {
		return materialized{}, err
	}
	var result materialized
	videoResources, err := m.downloadDASHTrack(ctx, workspace, stream.ID, video, videoSegments, "video", m.cfg.CloneMaxBytes)
	if err != nil {
		return materialized{}, err
	}
	result.resources = append(result.resources, videoResources...)
	for _, item := range videoResources {
		result.totalBytes += item.SizeBytes
	}
	var audioSegments []dashSegment
	if audio != nil {
		audioSegments, _, err = expandDASHSegments(*audio, actualDuration)
		if err != nil {
			return materialized{}, err
		}
		audioResources, err := m.downloadDASHTrack(ctx, workspace, stream.ID, *audio, audioSegments, "audio", m.cfg.CloneMaxBytes-result.totalBytes)
		if err != nil {
			return materialized{}, err
		}
		result.resources = append(result.resources, audioResources...)
		for _, item := range audioResources {
			result.totalBytes += item.SizeBytes
		}
	}
	manifest := buildLocalDASHManifest(video, audio, videoSegments, audioSegments, actualDuration)
	resource, err := writeResource(workspace, "manifest.mpd", "master", "application/dash+xml", []byte(manifest))
	if err != nil {
		return materialized{}, err
	}
	resource.StreamID = stream.ID
	result.resources = append(result.resources, resource)
	result.totalBytes += resource.SizeBytes
	if result.totalBytes > m.cfg.CloneMaxBytes {
		return materialized{}, &captureError{code: "SOURCE_TOO_LARGE", message: "clone exceeds aggregate size limit"}
	}
	result.duration = actualDuration
	return result, nil
}

func selectDASHTrack(period dashPeriod, root *url.URL, kind string) (dashTrack, error) {
	var best *dashTrack
	for _, set := range period.AdaptationSets {
		if len(set.ContentProtection) > 0 || strings.ToLower(firstNonEmpty(set.ContentType, mimeKind(set.MimeType))) != kind {
			continue
		}
		setBase := dashCaptureBase(root, set.BaseURL)
		for _, representation := range set.Representations {
			if len(representation.ContentProtection) > 0 {
				continue
			}
			template := mergeDASHTemplate(set.SegmentTemplate, representation.SegmentTemplate)
			list := representation.SegmentList
			if len(list.Segments) == 0 {
				list = set.SegmentList
			}
			hasList := len(list.Segments) > 0
			if (!hasList && (template.Media == "" || template.Initialization == "")) || (hasList && (list.Initialization.SourceURL == "" || list.Duration <= 0)) {
				continue
			}
			track := dashTrack{kind: kind, id: representation.ID, bandwidth: representation.Bandwidth, mimeType: firstNonEmpty(representation.MimeType, set.MimeType, kind+"/mp4"), codecs: firstNonEmpty(representation.Codecs, set.Codecs), base: dashCaptureBase(setBase, representation.BaseURL), template: template, segmentList: list, hasSegmentList: hasList}
			if best == nil || track.bandwidth > best.bandwidth {
				copy := track
				best = &copy
			}
		}
	}
	if best == nil {
		return dashTrack{}, unsupported("DASH manifest has no supported " + kind + " representation")
	}
	return *best, nil
}

func mergeDASHTemplate(parent, child dashSegmentTemplate) dashSegmentTemplate {
	out := parent
	if child.Timescale != 0 {
		out.Timescale = child.Timescale
	}
	if child.Duration != 0 {
		out.Duration = child.Duration
	}
	if child.StartNumber != 0 {
		out.StartNumber = child.StartNumber
	}
	if child.Media != "" {
		out.Media = child.Media
	}
	if child.Initialization != "" {
		out.Initialization = child.Initialization
	}
	if len(child.Timeline.Segments) > 0 {
		out.Timeline = child.Timeline
	}
	if out.Timescale == 0 {
		out.Timescale = 1
	}
	if out.StartNumber == 0 {
		out.StartNumber = 1
	}
	return out
}

func expandDASHSegments(track dashTrack, capSeconds float64) ([]dashSegment, float64, error) {
	if track.hasSegmentList {
		list := track.segmentList
		if list.Timescale == 0 {
			list.Timescale = 1
		}
		var result []dashSegment
		var total float64
		for i, item := range list.Segments {
			if item.Media == "" {
				return nil, 0, unsupported("DASH SegmentList has an empty SegmentURL")
			}
			duration := float64(list.Duration) / float64(list.Timescale)
			if total+duration > capSeconds+0.000001 {
				break
			}
			resolved, err := resolve(track.base, item.Media)
			if err != nil {
				return nil, 0, err
			}
			result = append(result, dashSegment{url: resolved, duration: duration, number: int64(i)})
			total += duration
		}
		if len(result) == 0 {
			return nil, 0, unsupported("requested duration is shorter than the first DASH segment")
		}
		return result, total, nil
	}
	template := track.template
	var raw []struct{ time, duration int64 }
	if len(template.Timeline.Segments) > 0 {
		var current int64
		for _, entry := range template.Timeline.Segments {
			if entry.Duration <= 0 {
				return nil, 0, unsupported("invalid DASH SegmentTimeline duration")
			}
			if entry.Time != 0 {
				current = entry.Time
			}
			repeat := entry.Repeat
			if repeat < 0 {
				repeat = int64(capSeconds*float64(template.Timescale)/float64(entry.Duration)) + 1
			}
			for i := int64(0); i <= repeat; i++ {
				raw = append(raw, struct{ time, duration int64 }{current, entry.Duration})
				current += entry.Duration
				if float64(current)/float64(template.Timescale) > capSeconds+60 {
					break
				}
			}
		}
	} else {
		if template.Duration <= 0 {
			return nil, 0, unsupported("DASH SegmentTemplate requires duration or SegmentTimeline")
		}
		for current := int64(0); ; current += template.Duration {
			raw = append(raw, struct{ time, duration int64 }{current, template.Duration})
			if float64(current+template.Duration)/float64(template.Timescale) >= capSeconds {
				break
			}
		}
	}
	var result []dashSegment
	var total float64
	for i, item := range raw {
		d := float64(item.duration) / float64(template.Timescale)
		if total+d > capSeconds+0.000001 {
			break
		}
		ref := expandDASHTemplate(template.Media, track.id, track.bandwidth, template.StartNumber+int64(i), item.time)
		resolved, err := resolve(track.base, ref)
		if err != nil {
			return nil, 0, err
		}
		result = append(result, dashSegment{url: resolved, duration: d, time: item.time, number: template.StartNumber + int64(i)})
		total += d
	}
	if len(result) == 0 {
		return nil, 0, unsupported("requested duration is shorter than the first DASH segment")
	}
	return result, total, nil
}

func (m *Manager) downloadDASHTrack(ctx context.Context, workspace, streamID string, track dashTrack, segments []dashSegment, prefix string, remaining int64) ([]models.Resource, error) {
	var out []models.Resource
	initRef := track.segmentList.Initialization.SourceURL
	if !track.hasSegmentList {
		initRef = expandDASHTemplate(track.template.Initialization, track.id, track.bandwidth, track.template.StartNumber, 0)
	}
	initURL, err := resolve(track.base, initRef)
	if err != nil {
		return nil, err
	}
	init, err := m.downloadResource(ctx, workspace, filepath.ToSlash(filepath.Join("dash", prefix, "init.mp4")), prefix+"-init", initURL, remaining)
	if err != nil {
		return nil, err
	}
	init.StreamID = streamID
	init.ContentType = track.mimeType
	out = append(out, init)
	remaining -= init.SizeBytes
	for i, segment := range segments {
		resource, err := m.downloadResource(ctx, workspace, filepath.ToSlash(filepath.Join("dash", prefix, "segments", fmt.Sprintf("%06d.m4s", i))), prefix+"-segment", segment.url, remaining)
		if err != nil {
			return nil, err
		}
		resource.StreamID = streamID
		resource.ContentType = track.mimeType
		out = append(out, resource)
		remaining -= resource.SizeBytes
	}
	return out, nil
}

func buildLocalDASHManifest(video dashTrack, audio *dashTrack, videoSegments, audioSegments []dashSegment, duration float64) string {
	var b strings.Builder
	fmt.Fprintf(&b, "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<MPD xmlns=\"urn:mpeg:dash:schema:mpd:2011\" type=\"static\" mediaPresentationDuration=\"PT%.3fS\" minBufferTime=\"PT1.5S\"><Period duration=\"PT%.3fS\">", duration, duration)
	b.WriteString(localDASHAdaptation(video, "video", videoSegments))
	if audio != nil {
		b.WriteString(localDASHAdaptation(*audio, "audio", audioSegments))
	}
	b.WriteString("</Period></MPD>\n")
	return b.String()
}

func localDASHAdaptation(track dashTrack, kind string, segments []dashSegment) string {
	var b strings.Builder
	fmt.Fprintf(&b, "<AdaptationSet contentType=\"%s\" mimeType=\"%s\"><Representation id=\"%s\" bandwidth=\"%d\"", xmlEscape(kind), xmlEscape(track.mimeType), xmlEscape(track.id), track.bandwidth)
	if track.codecs != "" {
		fmt.Fprintf(&b, " codecs=\"%s\"", xmlEscape(track.codecs))
	}
	fmt.Fprintf(&b, "><SegmentList timescale=\"1000\"><Initialization sourceURL=\"dash/%s/init.mp4\"/><SegmentTimeline>", kind)
	for _, segment := range segments {
		fmt.Fprintf(&b, "<S d=\"%d\"/>", int64(segment.duration*1000+0.5))
	}
	b.WriteString("</SegmentTimeline>")
	for i := range segments {
		fmt.Fprintf(&b, "<SegmentURL media=\"dash/%s/segments/%06d.m4s\"/>", kind, i)
	}
	b.WriteString("</SegmentList></Representation></AdaptationSet>")
	return b.String()
}

var dashTemplateToken = regexp.MustCompile(`\$(RepresentationID|Bandwidth|Number|Time)(%0(\d+)d)?\$`)

func expandDASHTemplate(value, id string, bandwidth int, number, timeValue int64) string {
	value = strings.ReplaceAll(value, "$$", "$")
	return dashTemplateToken.ReplaceAllStringFunc(value, func(token string) string {
		parts := dashTemplateToken.FindStringSubmatch(token)
		var n int64
		switch parts[1] {
		case "RepresentationID":
			return id
		case "Bandwidth":
			n = int64(bandwidth)
		case "Number":
			n = number
		case "Time":
			n = timeValue
		}
		if parts[3] != "" {
			width, _ := strconv.Atoi(parts[3])
			return fmt.Sprintf("%0*d", width, n)
		}
		return strconv.FormatInt(n, 10)
	})
}

func dashCaptureBase(base *url.URL, ref string) *url.URL {
	if strings.TrimSpace(ref) == "" {
		return base
	}
	resolved, err := url.Parse(strings.TrimSpace(ref))
	if err != nil {
		return base
	}
	return base.ResolveReference(resolved)
}
func dashDuration(value string) (float64, error) {
	value = strings.TrimSpace(value)
	match := regexp.MustCompile("^PT(?:(\\d+(?:\\.\\d+)?)H)?(?:(\\d+(?:\\.\\d+)?)M)?(?:(\\d+(?:\\.\\d+)?)S)?$").FindStringSubmatch(value)
	if match == nil {
		return 0, fmt.Errorf("invalid DASH duration")
	}
	var total float64
	for i, factor := range []float64{3600, 60, 1} {
		if match[i+1] != "" {
			n, _ := strconv.ParseFloat(match[i+1], 64)
			total += n * factor
		}
	}
	return total, nil
}
func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
func mimeKind(value string) string {
	if strings.HasPrefix(strings.ToLower(value), "video/") {
		return "video"
	}
	if strings.HasPrefix(strings.ToLower(value), "audio/") {
		return "audio"
	}
	return ""
}
func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
func xmlEscape(value string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(value))
	return b.String()
}
