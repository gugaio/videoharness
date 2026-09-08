# TESTING.md

**Status: Fase 6 + extensões concluídas — 147 testes backend (pytest) + 43 frontend
(vitest), todos offline; o teste opcional de ffprobe é pulado quando o binário não existe.**

## Princípios

- Testes simples de executar e **sem internet** (nenhuma URL pública em testes automatizados).
- FFmpeg/ffprobe 8.0.1 disponível no ambiente; a versão será fixada no ambiente de container. Testes que dependem do binário ficam separados/marcados.

## Matriz de fixtures (paridade)

| Fixture | Manifesto | Container |
|---|---|---|
| HLS TS | HLS master + media playlists | MPEG-TS |
| HLS fMP4 | HLS master + media playlists | fMP4/CMAF |
| DASH fMP4 | MPD (`$Number$` e `SegmentTimeline/$Time$`) | fMP4/CMAF |

As três variantes usam conteúdo sintético pequeno e determinístico, incluindo bytes
TS (PAT/PMT/PES/PCR) e fMP4 (init e fragmentos). Sem mídia protegida por copyright.

## Tipos de teste

- Unitários do domínio e casos de uso;
- Contrato do JSON Schema/OpenAPI;
- Parsers com fixtures locais;
- Adapters com servidor HTTP local controlado (incluindo casos SSRF, redirects, limites, redaction);
- Golden snapshots pequenos e revisáveis;
- Paridade das propriedades normalizadas (HLS vs DASH sobre o mesmo conteúdo);
- Integração FastAPI;
- Componentes e interação React;
- Ao menos um fluxo end-to-end quando a UI estiver funcional;
- Limites de captura e proteções de URL;
- Arquivos expirados e escrita atômica;
- Metadados HDR estáticos e assinatura HDR10+ em bytes sintéticos.
- Samples fMP4 com tamanho/duração/flags/composition offset e unidades PES TS com
  tamanho/PTS, além da escala visual e dos tempos no componente React.
- `show_frames` com init + fragmento via stdin, classificação I/P/B, preservação de
  timestamp zero e preferência visual pelos frames derivados com fallback estrutural.
- Resumo de GOP com pares de keyframes, distribuição I/P/B, trecho final incompleto
  e ausência explícita de intervalo quando só um ponto de acesso foi observado.
- Timeline Health: duração observada, duração declarada, gap, overlap e fronteira
  não comparável quando a mídia não fornece fim de DTS.
- Matriz ABR: pares de rendições do mesmo tipo pela sequência canônica; janela HLS
  live deslocada não pode gerar falso delta de keyframe; keyframe só entra quando
  os dois fragments pareados o reportam via ffprobe.
- Bitrate por segmento: bytes/duração observada quando as tracks concordam,
  fallback declarado quando não concordam, média ponderada, pico e tamanho de
  unidade claramente separado de complexidade de codec.
- Entrega HTTP/live: TTFB, download, throughput, redirects, status de falha e
  redução segura de headers de cache; round-trip/redaction; e playlist HLS live
  com `PROGRAM-DATE-TIME`, sequência e ausência explícita de avanço em uma leitura.
- DRM DASH fase 1: escopo de `ContentProtection`, UUIDs conhecidos, KID
  normalizado, PSSH válido/inválido sem persistir payload, redaction e painel com
  limites explícitos; HLS e snapshots legados não recebem o painel DASH.
- Strings de codec de áudio: decomposição de `mp4a.40.2`, identificação de
  `ac-3`/`ec-3`, tooltips acessíveis e ausência explícita de inferência sobre
  bitrate, canais, Atmos ou compatibilidade.

## Comandos (raiz do repositório)

Implementados: `help`, `bootstrap`, `back`, `front`, `dev`, `test`,
`test-backend`, `test-frontend`, `lint`, `lint-backend`, `lint-frontend`, `format`,
`clean-expired`, `cli inspect url=…`.

Ainda não implementado: `test-e2e` (Fase 8).
