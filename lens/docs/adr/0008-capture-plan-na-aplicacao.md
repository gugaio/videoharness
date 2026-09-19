# ADR-0008 — CapturePlan e orquestração de captura na aplicação

Status: aceito · Data: 2026-09-19

## Contexto

`CapturePlan` descreve decisões determinísticas da inspeção: segmentos
selecionados, descontinuidades, warnings e observações de playlists. O serviço
que resolve a janela, captura os bytes e normaliza a timeline vivia em
`adapters/outbound/segments/capture_service.py`, misturando decisão de
aplicação com efeito externo (buscar e gravar bytes) no mesmo módulo.

## Decisão

- `CapturePlan` e `DashCandidate` ficam em `application/capture_plan.py`. São
  estado de decisão/observação de uma execução, sem I/O, HTTP ou filesystem.
- `SegmentCaptureService` fica em `application/capture_service.py`. Ele
  **orquestra** resolução da janela, captura dentro dos limites e timeline; não
  executa I/O: depende apenas de ports.
- Efeitos externos continuam em adapters. `ManifestFetcher`/`SegmentFetcher`
  (`adapters/outbound/fetching/`) buscam bytes; `SegmentStore` é um port
  (`application/ports/segment_store.py`) implementado por
  `FilesystemSegmentStore` (`adapters/outbound/filesystem/segment_store.py`),
  que grava os bytes e devolve o registro `CapturedSegment`.
- A leitura de playlist de mídia HLS usada pela captura vai para
  `parsers/hls_playlist.py`, encapsulando a lib `m3u8` como o resto do parsing
  (ADR-0007). A aplicação deixa de importar biblioteca de formato.
- Value objects (`PlannedSegment`, `CapturedSegment`, `LivePlaylistObservation`,
  `DeliveryObservation`, `CaptureLimits`) permanecem no domínio: são os fatos
  declarativos, sem estado de execução.
- Comportamento, limites, schema e contratos HTTP/CLI permanecem iguais.

## Por que o plano não vai para o domínio

`CapturePlan` agrega estado de uma execução (seleção da janela + observações
coletadas ao resolvê-la), não uma invariante do produto. O domínio já possui os
fatos estáveis que importam (`PlannedSegment` etc.); promover o plano a domínio
levaria política de execução e bookkeeping de observação para dentro dele.

## Consequências

A aplicação é dona do “o que capturar” e de “coordenar a captura”; o adapter é
dono de “obter e persistir”. O parsing passa a ter uma fronteira explícita em
`parsers/`, alinhada ao ADR-0007, e a aplicação não conhece a biblioteca de
formato. O schema do snapshot, os limites e os endpoints não mudam.
