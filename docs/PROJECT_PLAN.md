# Plano do projeto — StreamMock

Este documento registra o que já foi entregue e ordena as próximas evoluções.
O produto combina proxy efêmero, clones VOD autocontidos e observabilidade de
playback. CMCD v2 e envio de CMCD por headers não fazem parte das próximas
fases; o suporte atual continua em query parameters v1.

## Fase 1 — Proxy e simulação de falhas (concluída)

- Proxy HLS/DASH público e por workspace.
- Reescrita de playlists e recursos sob `/p`, `/ws/{slug}/p` e `/s/{id}`.
- Janela VOD de até 300 segundos, presets de caos, limitação por IP e proteção
  SSRF para todas as buscas externas.
- Persistência de streams de workspace e request board; proxies públicos são
  efêmeros, ficam somente em memória e são removidos por inatividade.

O proxy continua dependendo da origem e é a opção apropriada para testes sob
demanda sem armazenar o conteúdo.

## Fase 2 — Clones VOD persistentes (concluída)

- Captura assíncrona em staging, publicação atômica e reprodução sem acessar a
  origem depois que o clone fica `ready`.
- Duração configurável de 1 a 300 segundos (60 por padrão), somente com
  segmentos completos.
- HLS VOD MPEG-TS e fMP4 (`EXT-X-MAP`), inclusive recursos compartilhados por
  `EXT-X-BYTERANGE`.
- Snapshot de HLS live usando os segmentos completos mais recentes, alinhamento
  por Program Date Time/sequência, normalização de LL-HLS e fechamento local
  com `EXT-X-ENDLIST`.
- Seleção da variante mais alta ou preservação da ladder completa, áudios
  alternativos e legendas WebVTT.
- Clone DASH clear e estático para o subconjunto suportado de
  `SegmentTemplate`/`SegmentTimeline`.
- Inventário de arquivos, hashes, bytes, contagem de faixas, progresso e erros
  estruturados no SQLite e na interface.

Entradas já criptografadas, segmentos HLS marcados como gap, DASH dinâmico,
múltiplos Periods e DASH `SegmentBase` continuam sendo rejeitados
explicitamente.

## Fase 3 — Operação e Playback Inspector (concluída)

- Tamanho, duração, estado, progresso, faixas, criação e expiração por clone.
- Exclusão recuperável em caso de falha de banco, quota agregada por usuário,
  TTL opcional e limpeza de staging, trash e diretórios órfãos antigos.
- Timeline de playback, diagnósticos causais e adapters HLS.js/Shaka no pacote
  `@streammock/playback-observer`.
- Eventos de manifesto, fragmentos, buffering, ABR, falhas, sessões DRM, status
  de chaves e requisições de licença.

O programa detalhado do Inspector está em
[`PLAYBACK_INSPECTOR_PLAN.md`](PLAYBACK_INSPECTOR_PLAN.md).

## Fase 4 — ClearKey e cenários multifaixa (MVP 1.0 concluído)

- Geração criptograficamente aleatória de um KID/key de 128 bits por clone,
  persistido separadamente dos metadados públicos da stream.
- Captura HLS clear multifaixa e empacotamento CENC/fMP4 com Shaka Packager.
- Manifesto DASH estático como entrada protegida principal, com múltiplas
  representações de vídeo, áudios por idioma e legendas WebVTT locais.
- Endpoint W3C ClearKey em `POST /s/{id}/license/clearkey`, Base64URL sem
  padding, CORS, limite de corpo, rate limit e respostas sem cache.
- Preview Shaka configurado para `org.w3.clearkey` e diagnósticos específicos
  para latência, falha, recuperação, chave errada e licença malformada.
- Imagem Docker multi-arquitetura com Shaka Packager versionado e verificado
  por SHA-256.

ClearKey é apenas uma ferramenta de teste: a chave precisa ser entregue ao
navegador e não protege conteúdo contra cópia. Não substitui Widevine,
FairPlay, PlayReady, rotação de chaves ou um serviço comercial de licenças.

## Fase 5 — Mock live HLS local (MVP concluído)

- Um clone HLS clear pronto pode ser exposto em `/s/{id}/live.m3u8` como uma
  origem live local, sem voltar a consultar a origem capturada.
- A playlist usa uma janela deslizante, `MEDIA-SEQUENCE` crescente e loop por
  padrão. Segmentos, mapas de inicialização e faixas continuam sendo os
  recursos locais do clone.
- O dono do workspace controla o cenário em
  `GET/POST /api/streams/{id}/live`: `start`, `pause`, `resume`, `restart` e
  `stop`; a janela aceita de 1 a 20 segmentos e o loop pode ser desligado.
- O estado é propositalmente mantido em memória: reiniciar o processo reinicia
  o cenário, permitindo começar cada execução em um ponto conhecido.
- O dashboard oferece os controles e abre o preview com a mesma telemetria,
  CMCD, logs e presets de caos dos clones comuns.

Este corte suporta somente HLS tradicional e clones clear. DASH dinâmico,
ClearKey live, LL-HLS, relógio virtual e ingestão contínua de uma origem live
permanecem fora do MVP.

## Fase 6 — Próximas implementações importantes

Ordem sugerida para a próxima rodada:

1. **Cenários live programáveis:** aplicar presets, descontinuidades e mudanças
   de qualidade em pontos definidos da timeline do mock, além de um relógio
   manual para execuções determinísticas.
2. **Compatibilidade de ingestão:** detectar áudio muxado na variante quando
   não há `EXT-X-MEDIA` e ampliar layouts fMP4/DASH somente a partir de uma
   matriz pequena de fixtures reais.
3. **Operação de captura:** retry manual, cancelamento e métricas básicas. Fila
   distribuída, quota transacional e storage de objetos só entram quando houver
   concorrência ou mais de uma instância.
4. **Hardening condicional:** chaves externas, criptografia em repouso e licença
   com expiração apenas se o ambiente deixar de ser ClearKey de teste local.

Ficam deliberadamente fora dessa sequência: CMCD v2, CMCD em headers e DRM
comercial. Eles só devem voltar ao plano quando houver um caso de uso concreto.
