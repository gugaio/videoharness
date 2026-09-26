# ROADMAP.md

Progresso marcado como `[ ]`/`[x]`. Gates são critérios objetivos aprovados pelo usuário antes da fase seguinte.

## Fase 0 — Descoberta, decisões e memória do projeto — **concluída** ✅

Estrutura do repositório, documentação de memória, ADRs, matriz de fixtures, skeleton de skills e ROADMAP. Nenhum produto funcional ainda.

**Gate**: nova sessão entende missão/arquitetura/estado/próximo passo lendo o repositório; decisões explícitas; matriz de paridade existe; plano de testes offline existe; nenhum documento alega capacidade inexistente.

## Fase 1 — Bootstrap e primeira fatia vertical — **concluída** ✅

Backend Python/FastAPI + frontend React/TS/Vite iniciais; composition root; health/readiness; primeiro caso de uso pequeno via HTTP **e** CLI; contrato inicial de Inspection/Snapshot; repositório temporário (filesystem ou in-memory, conforme ADR); página com campo de URL e tela de inspeção mínima (fixture local); testes unit + API + componente; `make dev`/`make test`; OpenAPI publicado.

**Gate**: ✅ `make dev-backend`/`make dev-frontend` sobem; ✅ `make test` passa (41 backend + 5 frontend); ✅ CLI e HTTP exercitam o mesmo caso de uso (CreateInspection); ✅ UI cria e abre inspeção de fixture (validado no navegador); ✅ nenhuma lógica de negócio depende de FastAPI/React (domínio puro, ports/Protocols); ✅ sem captura remota pública (apenas `fixture://`).

## Fase 2 — Job temporário, URL segura e detecção de protocolo — **concluída** ✅

`POST /api/v1/inspections` (202); ciclo de vida + polling de status; safe fetcher com testes de SSRF/redirects/limites/redaction; detecção HLS/DASH por conteúdo; captura somente do manifesto; rota `/inspect/{id}`; estados de loading/erro/expiração no frontend; limpeza por TTL; testes com servidor HTTP local.

**Gate**: ✅ fixtures HLS/DASH geram inspeções independentes (testes + manual); ✅ URLs inseguras rejeitadas (política de IP testada contra 12 faixas, redirect para metadata endpoint bloqueado, limite de redirects/bytes); ✅ tokens não aparecem em disco/JSON/UI (query nunca persistida; display_url redacted); ✅ comportamento pós-restart implementado e testado (sweep marca `job_lost`); ✅ sem banco; ✅ Docker Compose funcional (UI :8080, API :8000). Extra: validação manual com stream público real da Apple (HLS master, 6 variantes).

## Fase 3 — Modelo unificado de manifestos e overview visual — **concluída** ✅

HLS master/media playlists + DASH MPD (modos de endereçamento do ADR) em paridade; grupos/tracks/representações; codecs, bitrate, resolução, frame rate, idioma, roles, DRM signaling; segmentos e init references declarados; VOD vs live; campos específicos preservados; `capabilities` com supported/unsupported/not_collected/not_applicable. Frontend: visão top-down, ladder visual, painel contextual, mesma navegação para HLS/DASH, raw sob demanda.

**Gate**: ✅ snapshots válidos para as 3 combinações (goldens: HLS TS, HLS fMP4, DASH fMP4); ✅ testes de contrato e golden snapshots + round-trip de serialização; ✅ paridade HLS/DASH testada (ladder/idioma/grupos); ✅ não-suportado explícito via `capabilities` (segment_download/media_playlist_follow `not_collected`); ✅ UI não conhece detalhes de parsing (só o contrato 1.0). Extra: `m3u8` 6.0.0 validada no Python 3.14 (ADR-0002 confirmado).

## Fase 4 — Captura limitada e timeline de segmentos — **concluída** ✅

Seleção determinística de janela (VOD/live); limites configuráveis (default conservador, máx 60s); resolução de init/media segments, byte ranges, parts; captura das 3 combinações; hashes, tamanho, status HTTP, duração declarada, timestamps; timeline normalizada; representação de gaps/discontinuities/ausências (sem diagnóstico); progresso; parciais identificados; arquivos isolados por inspeção.

**Gate**: ✅ as 3 combinações (HLS TS, HLS fMP4, DASH) percorrem o mesmo fluxo com bytes reais capturados; ✅ timeline comparativa por representação no snapshot e na UI; ✅ testes offline (fixtures sintéticas TS/fMP4); ✅ limites impedem download ilimitado (janela 10s default com teto 60s, cap por segmento, orçamento total, máx de rendições seguidas — todos por env); ✅ falha de segmento ≠ inspeção completa (`partial` com erro por segmento).

## Fase 5 — Inspeção de containers e primeira UX diferenciadora — **concluída** ✅

fMP4: árvore de boxes (init vs media fragment; ftyp/styp, moov, trak, mdhd, stsd, mvex, trex, moof, mfhd, traf, tfhd, tfdt, trun, mdat, sidx); offsets, tamanhos, track IDs, timescales, sample counts, durations, flags, composition offsets. MPEG-TS: sync/pacotes, PAT/PMT, PIDs, continuity counters, adaptation fields, PCR, PES/PTS/DTS. Comum: ffprobe via adapter; visão de container a partir da timeline; painel contextual + breadcrumb; lazy loading; download do snapshot; distinção bruto/derivado/determinístico. Sem parser de codec do zero.

**Gate**: ✅ navegação manifesto → representação → segmento → container nas 3 combinações; ✅ HLS TS e fMP4 equivalentes sem esconder diferenças; ✅ dados rastreáveis ao snapshot; ✅ fixtures cobrem estruturas principais; ✅ UI útil sem textos longos.

## Fase 6 — Metadados HDR — **concluída** ✅

Identificação rastreável de sinal HDR por representação/segmento: CICP (`colr`),
metadados estáticos (`mdcv`/`clli`) e presença de HDR10+ em SEI ITU-T T.35 nos
bytes capturados. O snapshot distingue fatos determinísticos de dados derivados
por `ffprobe`, limita a conclusão aos segmentos observados e não promete parsing
de RPU Dolby Vision nem metadados dinâmicos quadro a quadro. Frontend: painel HDR
com transferência, primárias, profundidade quando disponível, mastering display,
MaxCLL/MaxFALL e indicador de HDR dinâmico observado.

**Gate**: ✅ testes offline sintéticos cobrem ausência de sinal, HDR10 estático, HLG e assinatura HDR10+;
✅ snapshot/UI preservam valores, proveniência e escopo de observação; ✅ ausência
de metadados não é classificada como SDR; ✅ nenhum diagnóstico de compatibilidade
ou leitura completa do stream é alegado.

**Extensão aprovada**: ✅ o detalhe do segmento materializa samples fMP4 de `trun`
e unidades PES MPEG-TS no schema 1.4; a UI os mostra horizontalmente com tamanho
relativo, PTS/DTS e cor por classificação sync quando o container a declara. PES permanece
identificado como unidade, sem ser apresentado indevidamente como frame.

**Extensão aprovada**: ✅ no schema 1.5, o adapter opcional usa `show_frames` e o
init correspondente para expor frames I/P/B derivados com tamanho, PTS e DTS. A UI
prefere essa classificação quando presente, resume GOPs/keyframes observados e
mantém samples/PES como fallback. Intervalos incompletos e open/closed GOP não são
apresentados como conclusões.

**Extensão aprovada**: ✅ no schema 1.6, Timeline Health expõe continuidade de DTS,
duração observada e duração declarada por track/PID. A documentação de observabilidade
define a sequência de métricas futuras e os limites verificáveis por QA.

**Extensão aprovada**: ✅ no schema 1.7, a matriz ABR compara início e duração
declarados de segmentos equivalentes e PTS de keyframe somente quando ambos são
observados pelo ffprobe. A ausência de pares comparáveis não é convertida em diagnóstico.

**Extensão aprovada**: ✅ no schema 1.8, bitrate por segmento é calculado por
bytes capturados/duração, priorizando timestamps do container quando as tracks
concordam e identificando o fallback do manifesto. Picos, faixa e comparação com
bitrate declarado ficam visíveis; tamanho de unidade é indicador de payload, não
uma alegação de complexidade de codec.

**Extensão aprovada**: ✅ no schema 1.9, entrega HTTP expõe TTFB, tempo de
download, throughput efetivo, status, redirects e sinais de cache seguros por
requisição observada. HLS live preserva sequence e janela declarada; distância da
borda só existe com `PROGRAM-DATE-TIME`, e avanço não é inferido de uma leitura.

**Extensão aprovada**: ✅ no schema 1.10, a matriz ABR pareia segmentos pela
identidade canônica (`MEDIA-SEQUENCE` HLS ou número DASH), não pela posição local
da janela. Segmentos sem equivalente aparecem como janela diferente e não produzem
falso desvio de keyframe.

**Extensão aprovada**: ✅ no schema 1.12, a configuração efetiva derivada de
`ffprobe` registra codec/profile/level, pixel format, vídeo e áudio por segmento,
expõe mudanças entre segmentos observados e o delta A/V por PTS de apresentação
somente dentro do mesmo container, incluindo os dois PTS usados no cálculo. Usa
`start_time` apenas como fallback explicitamente marcado; não declara
compatibilidade de device ou problema de lipsync.

**Extensão aprovada — DRM 1 (somente DASH)**: ✅ no schema 1.13, cada
`ContentProtection` do MPD preserva o escopo de declaração, sistema reconhecido,
`schemeIdUri`, `value`, KIDs normalizados e presença/validade/tamanho/hash de PSSH.
O payload PSSH não é persistido e a UI não confunde sinalização do manifesto com
teste de licença, CDM ou compatibilidade de device. HLS fica fora desta fase.

**Extensão aprovada — captura incremental (ADR-0009)**: ✅ schema 1.14 expõe
cobertura com referências de segmentos; a API resolve cobertura sem baixar mídia
e permite capturas adicionais por referências ou janela de até 60 s, limitadas e
persistidas em evidência separada do snapshot base. A origem é reapresentada por
pedido, sem persistir URL/credenciais. Execução autônoma de agente e interpretações
diagnósticas continuam fora da Lens.

## Fase 7 — Skills e API para agentes

Skill principal revisada para endpoints/schemas reais; referências HLS/DASH/TS/ISOBMFF coerentes com o suporte atual; catálogo versionado; endpoints de skills; compatibilidade com `schema_version`; exemplos com fixtures; evals; testes de referências/paths/versões; ação "Use with an agent" na UI; `capabilities` e `recommended_skills` no snapshot. Agente carrega só módulos relevantes.

**Gate**: agente descobre a skill, entende a API e consulta inspeção sem conhecer a implementação; skill não promete o inexistente; exemplos verificáveis; versões compatíveis e testadas.

## Fase 8 — Hardening e entrega v0.1

Dockerfiles/compose sem banco; build reproduzível; CI (testes, lint, typecheck, frontend build); E2E das 3 combinações; revisão de limites/SSRF/redaction; observabilidade básica; documentação completa; dados de demonstração locais; revisão visual responsiva; checklist de release; backlog v0.2.

**Gate**: dev novo roda pelo README; `make test` e build passam em ambiente limpo; 3 combinações exploráveis com fixtures locais; documentação não diverge do comportamento; limitações explícitas.
