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
2. **Matriz ABR** — ✅ Implementado. Pareia rendições pela sequência canônica do
   segmento (`MEDIA-SEQUENCE` no HLS; número no DASH), expõe janelas live com
   segmentos sem par e compara duração/keyframe apenas na interseção. Ajuda a
   distinguir um deslocamento de coleta de uma evidência real de desalinhamento
   que pode afetar switching ou causar tela preta.
3. **Bitrate por segmento** — ✅ Implementado para a janela capturada. Taxa calculada
   por bytes/duração, pico, faixa e comparação com o bitrate declarado; tamanho de
   frame/sample/PES é apresentado apenas como indicador de distribuição de payload.
   Ajuda a investigar buffering, degraus ineficientes e custo de entrega, sem alegar
   medir complexidade de codec ou qualidade visual.
4. **Entrega HTTP e live** — ✅ Implementado para cada requisição HTTP observada
   na janela: TTFB, tempo de download, throughput efetivo, status final, redirects
   e sinais de cache seguros. Para HLS live, registra janela/sequence declaradas e
   calcula distância da borda somente com `PROGRAM-DATE-TIME`; avanço exige duas
   leituras e permanece explicitamente não medido. Ajuda a investigar startup lento,
   rebuffer e atraso live sem alegar experiência do player. Veja
   [HTTP_LIVE_DELIVERY.md](HTTP_LIVE_DELIVERY.md).
5. **Bitstream e áudio** — ✅ Implementado como evidência derivada por segmento:
   configuração efetiva de vídeo/áudio, mudanças entre segmentos observados e
   delta de início A/V no mesmo container. Ajuda a investigar transições de
   encoder, configuração inesperada e timestamps que pedem correlação; não
   infere compatibilidade de dispositivo ou sincronismo percebido. Veja
   [BITSTREAM_OBSERVABILITY.md](BITSTREAM_OBSERVABILITY.md).
6. **DRM, anúncios e timed metadata** — DRM 1 ✅ implementado para DASH: preserva
   `ContentProtection` por escopo, sistema, KID e resumo seguro de PSSH. Ajuda a
   identificar sinalização ausente ou divergente sem confundir manifesto com
   licença/device. Inspeção CENC/CBCS do init/mídia, rotação, SCTE-35, `emsg`, ID3 e
   fronteiras permanecem em fases posteriores. Veja [DASH_DRM.md](DASH_DRM.md).
7. **Findings e histórico** — regras com evidências, comparação de snapshots e
   pacote de incidente. Acelera triagem sem esconder os dados brutos.
8. **Telemetria de player** — CMCD/traces correlacionados. Confirma impacto real em
   startup, buffer, rebuffer, ABR e decoder.

Cada item só avança após fixtures que exercitem o caso saudável, o caso com falha e
o caso em que a evidência é insuficiente.
