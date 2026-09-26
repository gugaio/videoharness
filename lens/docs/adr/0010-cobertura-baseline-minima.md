# ADR-0010 — Cobertura mínima por representação no baseline

Status: aceito · Data: 2026-09-26

## Contexto

A janela padrão de 10 segundos pode conter apenas um segmento quando a duração
declarada é maior que a janela. Além disso, o orçamento agregado pode ser gasto
por uma representação antes que as demais tenham segmentos capturados. Isso
reduz a evidência disponível para comparar variantes, áudio e legendas no
snapshot baseline.

## Decisão

- A inspeção padrão seleciona pelo menos dois segmentos de mídia por
  representação declarada de vídeo, áudio ou legenda quando dois ou mais estão
  capturáveis. VOD começa pelo início da playlist; live seleciona os mais
  recentes. Uma janela configurada abaixo de 10 segundos continua respeitando
  essa janela menor.
- Init segments são mantidos. O plano captura primeiro init + até dois segmentos
  de cada representação; segmentos adicionais da janela vêm depois.
- O master HLS segue todas as playlists declaradas com URI por padrão. Um valor positivo em
  `STREAM_LENS_MAX_PLAYLISTS` é um override operacional; zero significa sem teto
  de playlists HLS.
- O orçamento padrão de 500 MB é base. Na inspeção padrão, ele cresce se
  necessário para reservar o cap máximo por segmento para a cobertura mínima e
  os init segments planejados. Um `STREAM_LENS_MAX_TOTAL_BYTES` explicitamente
  configurado abaixo de 500 MB permanece um teto operacional rígido.
- O cap padrão de 20 MB por resposta de segmento permanece. Segmentos
  indisponíveis, maiores que o cap ou sem bytes analisáveis continuam sendo
  registrados como falha; a política garante a tentativa e a prioridade de
  captura, não a disponibilidade da origem.

## Consequências

Snapshots padrão ficam mais úteis para comparar todas as representações
declaradas e podem usar mais de 500 MB em streams com muitas rendições. A ordem
de captura protege os dois primeiros segmentos de cada representação contra o
consumo antecipado do orçamento por outras rendições. Overrides operacionais
positivos para o teto HLS ou para o orçamento total podem reduzir essa cobertura.

O contrato JSON permanece schema 1.14. `capture.max_total_bytes` informa o teto
efetivo reservado naquela inspeção; `capture.max_playlists_followed: 0`
representa ausência de teto HLS configurado. O analyzer passa a 1.7.0.
