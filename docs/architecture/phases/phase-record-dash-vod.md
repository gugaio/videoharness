# Fase Record R2 - DASH VOD

Status: **planejada depois do DoD de Record R1**.

## Objetivo

Adicionar recording e experimento ABR para DASH VOD reutilizando o data plane,
PlaybackRun, shaping, request journal e UX comprovados com HLS VOD.

## Dependencias

- Record R1 concluido.
- Contratos Recording/RecordedResource independentes de HLS.
- Shaper e journal operando por resource metadata, nao por extensao de arquivo.
- Parser MPD atual consolidado para a fronteira Record.

## Escopo inicial

- MPD `static` clear.
- `SegmentTemplate` com `SegmentTimeline` ou duration.
- Representations de video e audio.
- Init + media fMP4.
- Janela temporal comum entre representations.
- MPD local reescrito para recursos registrados.
- Transicao ABR inferida por requests de representation de video.

## Fora do primeiro corte DASH

- MPD dinamico;
- `SegmentBase`/`sidx`;
- DRM/licenca/decryption;
- byte ranges;
- low latency DASH;
- comprovacao de decode em Tizen ou outro hardware.

## Definition of Done

- Fixture DASH VOD com tres representations e audio e gravada e reproduzida pela
  URL do Video Harness.
- Device nao acessa a origem depois do recording pronto.
- O mesmo profile de R1 induz condicoes de downshift/recovery.
- Requests sao mapeados para representation, bitrate, resolucao e timeline.
- Resultado preserva a mesma semantica `observed | sustained | not_observed |
  inconclusive` de HLS.

