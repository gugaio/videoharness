# Fixtures

Conteúdo sintético mínimo, sem mídia protegida por copyright. As três combinações
do MVP são cobertas com bytes reais gerados por FFmpeg (MPEG-TS e fMP4/CMAF):

- `hls-ts/` — HLS + MPEG-TS: master, media playlists de vídeo (360p/720p) e áudio,
  e segmentos `.ts` (PAT/PMT/PES/PCR).
- `hls-fmp4/` — HLS + fMP4/CMAF: master, media playlists e segmentos `.m4s` com
  init (`EXT-X-MAP`).
- `dash-mpd/` — DASH + fMP4/CMAF: `stream.mpd` (`SegmentTemplate`/`$Number$`) e
  `time.mpd` (`SegmentTimeline`/`$Time$`), com inits e segmentos `.m4s`.

Acesso pela API/CLI: `fixture://hls-ts/master.m3u8`, `fixture://hls-fmp4/master.m3u8`,
`fixture://dash-mpd/stream.mpd`, `fixture://dash-mpd/time.mpd`.