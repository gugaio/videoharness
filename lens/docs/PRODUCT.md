# PRODUCT.md

## Problema

Streams de vídeo (HLS/DASH) são estruturas profundas e heterogêneas: manifestos, track groups, representações, segmentos, parts, containers e samples. Desenvolvedores e QA que precisam entender "o que existe neste stream" hoje recorrem a ferramentas fragmentadas (ffprobe, players, leitura de manifesto crua) e sem paridade entre protocolos.

## Usuários

- Desenvolvedores de vídeo (player, empacotamento, CDN);
- QA de streaming;
- Agentes de IA (Codex e similares) que precisam consultar a estrutura de um stream por contrato estável.

## Proposta de valor

Informar uma URL de manifesto e receber, rapidamente, uma **inspeção visual navegável top-down** e um **snapshot JSON canônico versionado** — os mesmos dados para humanos e agentes.

## Hierarquia de navegação

```
Presentation → Manifest → Track group → Representation → Segment → Part → Container → Sample → Bitstream metadata
```

O diferencial inicial é a experiência visual (progressive disclosure), não texto explicativo nem dashboards genéricos. O sistema **mostra o que existe**; diagnósticos e hipóteses são trabalho futuro baseado em evidências.

## Escopo do MVP (v0.1)

- Combinações obrigatórias: **HLS+MPEG-TS, HLS+fMP4/CMAF, DASH+fMP4**.
- Captura de janela limitada (default conservador; máximo inicial 60s).
- Snapshot canônico versionado com TTL, sem banco de dados (repositório temporário em filesystem).
- API HTTP + CLI sobre o mesmo core; serviço headless (a UI React do MVP foi removida — ADR-0005 — e a experiência visual migrou para os clientes do snapshot, ex.: orquestrador do Video Harness).
- Catálogo de skills para agentes como artefato de primeira classe.

## Não objetivos (v0.1)

Video Harness; agente interno/chat; diagnóstico probabilístico por LLM; causa raiz automática; alteração/reempacotamento do stream; funcionalidades do Stream Mock; reprodução de vídeo como objetivo principal; descriptografia DRM; upload de credenciais/cookies/headers por usuário anônimo; contas/login/billing; banco permanente; histórico ilimitado; comparação entre snapshots; suporte completo a LL-HLS/low-latency DASH; parser completo de codecs; microserviços; integração com arquivos internos do Stream Mock; deploy público automático.

## Relação com a família de produtos

- **Stream Mock** (Go, stateful): cria/serve streams controlados. Integração com Stream Lens apenas por URL ou contratos HTTP públicos. Sem código ou estado compartilhado.
- **Stream Lens** (este projeto): extrai, normaliza e visualiza a estrutura de um stream.
- **Video Harness** (futuro): consome Stream Lens + Stream Mock para investigações e experimentes. Fora do MVP.
