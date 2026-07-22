# Stream Tools

Ferramentas deterministicas sem conceitos de usuario, investigation, job, agente
ou prompt.

## Fronteiras atuais

- `safe-http-client.ts`: acesso HTTP(S) com resolucao validada, IP fixado por
  request, redirects manuais, timeout total e limite de bytes.
- `manifest.ts`: deteccao superficial e deterministica de HLS/DASH.

O repositorio VHS no commit `d2abfbd51046f1aed9737122b7e0e20f048efd91` foi
inspecionado em 2026-07-21. Nenhum codigo foi copiado nesta fatia porque o fetch
existente seguia redirects automaticamente e nao oferecia a protecao SSRF exigida
pelo produto. Parsers mais profundos continuam candidatos a importacao controlada
em uma fatia posterior.
