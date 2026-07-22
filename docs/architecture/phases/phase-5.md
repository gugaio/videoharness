# Fase 5 - Hardening e Validacao

Status: **planejada**

## Objetivo

Colocar o MVP em um VPS e medir se ele economiza tempo real de investigacao.

## Escopo

- Docker Compose de producao.
- Caddy/Nginx, TLS e configuracao do dominio.
- Limites de concorrencia, disco, bytes e duracao.
- Retencao de artifacts.
- Observabilidade minima de jobs, custo e falhas.
- Link compartilhavel protegido por token.
- Smoke tests contra fixtures e streams autorizados.
- Entrevistas e feedback de usuarios iniciais.

## Definition of Done

- Deploy reproduzivel em um VPS.
- Worker restart e reconexao SSE testados.
- SSRF e limites operacionais testados.
- Pelo menos um engenheiro externo completa o fluxo sem assistencia.
- Feedback responde se o report economizou tempo e por que.

