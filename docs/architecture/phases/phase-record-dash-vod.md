# Fase Record R2 - DASH VOD

Status: **ativa**.

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

## Estado implementado

- Intake permite escolher `hls` ou `dash`; HLS permanece o default compativel.
- O worker despacha pelo protocolo e o collector DASH aceita MPD `static`, clear,
  `SegmentTemplate` com timeline ou duration, sem `SegmentBase`/ranges.
- A maior adaptation set de video com 2--8 representations e uma adaptation set
  de audio sao materializadas com init e segmentos fMP4 em storage privado.
- O MPD local e reescrito para paths registrados e o playback run retorna
  `index.mpd`; shaping e journal continuam os mesmos do data plane existente.
- Antes de baixar media, o collector estima o tamanho da janela pela bitrate
  declarada. Ladder acima do teto agregado falha sem retry nem downloads parciais.

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
