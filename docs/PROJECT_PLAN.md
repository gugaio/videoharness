# Plano do projeto — StreamMock

Este documento descreve as fases do produto e a diferença importante entre o
comportamento atual de proxy e o clone HLS que o produto deve oferecer.

## Fase 1 — Proxy HLS e simulação de falhas (concluída)

- Criar streams a partir de uma URL HLS.
- Reescrever playlists e URLs de recursos para `/s/{id}/...`.
- Buscar playlists e segmentos da origem sob demanda.
- Limitar a playlist retornada a uma janela de até 60 segundos e encerrá-la
  com `#EXT-X-ENDLIST`.
- Aplicar presets de caos para testes de player e persistir os metadados da
  stream para usuários autenticados.

Limitação conhecida: esta fase não armazena playlists, segmentos ou chaves.
Consequentemente, a reprodução depende de a origem continuar disponível. A
janela de 60 segundos é uma transformação da playlist atual, e não uma cópia
imutável do conteúdo.

## Fase 2 — Clone HLS persistente de até 60 segundos (próxima fase)

Objetivo: ao criar uma stream, capturar no máximo 60 segundos de conteúdo HLS
e servi-lo localmente. Depois de concluída a captura, a URL clone deve
continuar reproduzível mesmo que a URL original deixe de existir.

Escopo inicial:

- Baixar a playlist mestre e a variante de mídia selecionada.
- Selecionar segmentos cuja duração acumulada seja de, no máximo, 60 segundos
  por padrão.
- Baixar e persistir localmente os segmentos e os recursos HLS necessários,
  incluindo chaves, mapas de inicialização e playlists filhas quando houver.
- Gerar playlists locais com referências locais e `#EXT-X-ENDLIST`.
- Registrar no banco o modo da stream (`proxy` ou `clone`), estado da captura
  (`capturing`, `ready` ou `failed`), duração obtida, erro e diretório de
  armazenamento.
- Exibir o andamento, falha ou disponibilidade do clone na interface.
- Manter os presets de caos funcionando sobre os recursos locais clonados.

Critérios de aceite:

- Um clone marcado como `ready` toca sem qualquer requisição à origem.
- Derrubar ou tornar indisponível a URL de origem não impede a reprodução do
  clone pronto.
- O clone não ultrapassa 60 segundos de mídia, salvo uma regra explicitamente
  definida para acomodar a duração indivisível do último segmento.
- Falhas de captura ficam visíveis e não produzem um clone parcialmente
  utilizável como se estivesse pronto.

Decisões a definir durante a implementação:

- Política para playlists mestre com múltiplas qualidades: capturar uma
  variante escolhida ou todas as variantes.
- Limite de espaço, expiração e remoção dos clones armazenados.
- Tratamento de streams criptografadas, byte ranges, fMP4 e playlists live.
- Local de armazenamento configurável e estratégia de backup.

## Fase 3 — Operação do acervo de clones

- Listar tamanho, duração, data e estado de cada clone.
- Permitir remover clones e recuperar espaço com segurança.
- Aplicar quotas por usuário e políticas de expiração.
- Disponibilizar observabilidade de captura, reprodução e erros de origem.

## Fase 4 — Formatos e cenários avançados

- Suporte real a DASH, com parsing e reescrita próprios; não tratar manifests
  DASH como segmentos binários.
- Captura de múltiplas variantes, faixas de áudio e legendas.
- Controles de captura, como duração, qualidade e ponto inicial para conteúdo
  live.
