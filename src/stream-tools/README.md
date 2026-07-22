# Stream Tools

Ferramentas deterministicas sem conceitos de usuario, investigation, job, agente
ou prompt.

## Fronteiras atuais

- `safe-http-client.ts`: acesso HTTP(S) com resolucao validada, IP fixado por
  request, redirects manuais, timeout total e limite de bytes.
- `manifest.ts`: deteccao superficial e deterministica de HLS/DASH.
- `hls-manifest.ts`: parsing puro de variants/renditions e estrutura de media
  playlists, alem de selecao limitada para investigacao.

O repositorio VHS no commit `d2abfbd51046f1aed9737122b7e0e20f048efd91` foi
inspecionado em 2026-07-21. O fetch existente nao foi copiado porque seguia
redirects automaticamente e nao oferecia a protecao SSRF exigida pelo produto.

## Importacao HLS

- Repositorio de origem: `/home/gugaime/IA/vhs` (`@gugaio/vhs`).
- Commit de origem: `d2abfbd51046f1aed9737122b7e0e20f048efd91`.
- Data da importacao: 2026-07-22.
- Referencias: `src/inspect.ts`, `src/inspect-support.ts` e a selecao limitada de
  `src/stream/clone-hls.ts`.
- Adaptacoes: removidos fetch, FFprobe, clone, filesystem e conceitos de origin;
  parsing passou a ser funcao pura; URLs derivadas usam exclusivamente o
  `SafeHttpClient`; a amostragem seleciona maior `BANDWIDTH` com desempate pela
  ordem da master e no maximo uma rendition de audio `DEFAULT` vinculada.

O Video Harness mantem essa copia autonomamente durante o MVP. Nao existe
dependencia de runtime nem sincronizacao automatica com o VHS.

O adapter HTTP entrega o modelo canonico `Manifest`. Parsing adiciona
`ManifestInspection`, storage adiciona `artifact` ao mesmo objeto e o report cria
uma projecao `ManifestEvidence` sem bytes. Nao criar novos tipos apenas para cada
etapa intermediaria desse ciclo.
