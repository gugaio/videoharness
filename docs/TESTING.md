# TESTING.md

**Status: Fase 6 concluída — 121 testes backend (pytest) + 30 frontend (vitest),
todos offline; o teste opcional de ffprobe é pulado quando o binário não existe.**

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

## Comandos (raiz do repositório)

Implementados: `help`, `bootstrap`, `back`, `front`, `dev`, `test`,
`test-backend`, `test-frontend`, `lint`, `lint-backend`, `lint-frontend`, `format`,
`clean-expired`, `cli inspect url=…`.

Ainda não implementado: `test-e2e` (Fase 8).
