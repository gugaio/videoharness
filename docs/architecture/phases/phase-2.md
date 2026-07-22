# Fase 2 - Evidencia Deterministica

Status: **pronta para iniciar**

## Objetivo

Substituir o pipeline placeholder por coleta e analise real de streams.

## Escopo

- Importacao controlada das partes necessarias do VHS.
- Deteccao HLS e DASH.
- Clone/amostragem limitada.
- FFprobe e MediaInfo.
- Manifest, codec, timeline, GOP e delivery evidence.
- Evidence bundle publico e versionado internamente.
- Artifacts e limpeza de temporary files.
- Protecao SSRF e limites de download.

## Primeira fatia recomendada

1. Definir o schema versionado do evidence bundle.
2. Criar port `StreamEvidenceCollector` sem dependencia de produto ou jobs.
3. Implementar validacao de destino contra SSRF antes de qualquer download.
4. Detectar HLS/DASH com timeout e limite estrito de resposta.
5. Persistir manifest selecionado como primeiro artifact real.

## Definition of Done

- Uma URL HLS valida produz evidence bundle persistido.
- Falhas de rede e formato geram eventos e erros compreensiveis.
- Fixtures conhecidas detectam pelo menos discontinuity e atraso A/V.
- Nenhuma analise tecnica depende de inferencia do LLM.
