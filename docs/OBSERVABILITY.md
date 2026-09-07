# Observabilidade de streaming

Este documento orienta desenvolvimento e QA. Stream Lens primeiro registra
evidências rastreáveis; uma métrica não vira diagnóstico automático sem uma regra
explícita, escopo e tolerância verificável.

## Modelo de evidência

Toda medição deve informar: representação/segmento/track a que se aplica, unidade,
proveniência (`deterministic`, `derived` ou entrega observada), janela analisada e
limitações. `null` ou `não comparável` significam que os bytes capturados não provam
o valor; nunca devem ser exibidos como estado saudável.

## Trilha aprovada

1. **Timeline Health** — duração real, PTS/DTS, `tfdt` e fronteiras. ✅ Implementado.
   Explica gaps,
   overlaps, drift e falhas de append/seek.
2. **Matriz ABR** — alinhamento temporal e de keyframes entre rendições. ✅ Implementado.
   Explica
   falhas de switching e tela preta em troca de qualidade.
3. **Bitrate por segmento** — ✅ Implementado para a janela capturada. Taxa calculada
   por bytes/duração, pico, faixa e comparação com o bitrate declarado; tamanho de
   frame/sample/PES é apresentado apenas como indicador de distribuição de payload.
   Ajuda a investigar buffering, degraus ineficientes e custo de entrega, sem alegar
   medir complexidade de codec ou qualidade visual.
4. **Entrega HTTP e live** — TTFB, throughput, cache, disponibilidade e live edge.
   Explica startup lento, rebuffer e atraso live.
5. **Bitstream e áudio** — configuração efetiva, mudanças, A/V timing e sinais de
   compatibilidade. Explica falhas por dispositivo e áudio fora de sincronia.
6. **DRM, anúncios e timed metadata** — CENC/CBCS, KID, SCTE-35, `emsg`, ID3 e
   fronteiras. Explica falhas em breaks e rotação de chave.
7. **Findings e histórico** — regras com evidências, comparação de snapshots e
   pacote de incidente. Acelera triagem sem esconder os dados brutos.
8. **Telemetria de player** — CMCD/traces correlacionados. Confirma impacto real em
   startup, buffer, rebuffer, ABR e decoder.

Cada item só avança após fixtures que exercitem o caso saudável, o caso com falha e
o caso em que a evidência é insuficiente.
