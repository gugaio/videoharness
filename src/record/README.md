# Record

## Origem de codigo adaptado

- Repositorio de origem: `VHS` (`/home/gugaime/IA/vhs`).
- Commit de origem: `d2abfbd51046`.
- Data da importacao: 2026-08-06.
- Adaptacoes: a selecao de janela HLS e a reconstrucao de playlists foram
  reimplementadas para usar `SafeHttpClient`, limites/SSRF do Video Harness,
  staging atomico e metadados `RecordedResource`. Nenhum modulo do VHS e
  carregado em runtime.

