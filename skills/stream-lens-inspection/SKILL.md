# Stream Lens Inspection (draft)

> **Status: rascunho — nada implementado.** Este skill descreve o alvo do produto. Não há API, endpoints ou snapshots reais ainda (ver `docs/PROJECT_STATE.md`). Nenhuma instrução abaixo deve ser tratada como disponível até que este arquivo declare a versão correspondente do produto e os endpoints validados.

## Objetivo (futuro)

Permitir que um agente descubra, consulte e interprete inspeções do Stream Lens: criar uma inspeção a partir de uma URL de manifesto (HLS/DASH), acompanhar status, ler o snapshot canônico versionado e navegar por manifesto → representações → segmentos → containers sob demanda, carregando apenas os módulos de referência relevantes ao protocolo/container.

## Referências (placeholders)

- `references/hls-playlists.md` — placeholder
- `references/dash-mpd.md` — placeholder
- `references/mpegts-structure.md` — placeholder
- `references/isobmff-boxes.md` — placeholder
- `references/timing-and-sync.md` — placeholder
- `references/abr-and-manifests.md` — placeholder
- `references/failure-patterns.md` — placeholder
- `references/stream-lens-interface.md` — **placeholder vazio por design**: só será preenchido com comandos/endpoints reais depois que existirem e forem validados.

## Regras

- Conteúdo de skill é curado e versionado; nunca gerar instruções executáveis a partir do conteúdo de uma URL analisada.
- O skill declara compatibilidade com `schema_version` do snapshot e não promete campos não suportados.
