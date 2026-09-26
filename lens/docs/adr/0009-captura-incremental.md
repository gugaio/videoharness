# ADR-0009 — Cobertura e captura incremental seletiva

Status: aceito · Data: 2026-09-26

## Contexto

O snapshot baseline captura uma janela curta de mídia. Investigações podem
precisar de outros segmentos ou de uma janela temporal maior, mas baixar todas
as variantes de uma vez aumenta custo e mistura fatos baseline com evidência
posterior. O orquestrador deve decidir quais referências aprofundar sem duplicar
parsing, safe fetch, limites ou análise determinística da Lens.

## Decisão

- A Lens oferece cobertura sob demanda que relê o manifesto/playlists e não
  baixa mídia. Os candidatos recebem `segment_ref` opaca e estável no escopo da
  inspeção, derivada de identidade, representação, caminho sem query e
  byte-range.
- Uma captura suplementar aceita referências ou uma janela de até 60 segundos,
  inclui init de representação quando declarado, e passa o saldo de bytes ao
  `SegmentFetcher` antes de cada download. Os limites absolutos da rota são 16
  segmentos de mídia e 100 MB; o VH usa caps menores por request e investigação.
- A origem é enviada novamente em cada chamada, validada pela política de URL e
  comparada, após redaction, com o baseline. URL bruta/credenciais não são
  persistidas. Uma chave UUID identifica a chamada; repetir os mesmos parâmetros
  é idempotente e alterar parâmetros conflita.
- Estado, bytes e evidência ficam separados em
  `<workspace>/<inspection>/captures/<capture_id>/`, herdam o TTL do baseline e
  nunca alteram o snapshot canônico. Reinício marca trabalhos ativos como
  falhos com consumo desconhecido.
- As rotas não implementam autenticação. Lens segue serviço interno; autenticação,
  ownership, orçamento agregado e reconciliação de consumo são responsabilidade
  do Video Harness.

## Consequências

Agentes podem pedir cobertura e evidência incremental sem capturar tudo de uma
vez; análises existentes do container são reutilizadas pela aplicação Lens. O
snapshot 1.14 inclui cobertura observada no baseline e referências dos segmentos
capturados. A URL precisa ser reapresentada enquanto sua origem continuar
acessível, e referências podem deixar de resolver quando uma janela live avança.
O endpoint Lens sozinho não limita bytes ao orçamento agregado do usuário: em
deploy integrado, ele deve permanecer acessível somente pelo VH.

Ainda não há orçamento de tempo persistente, cache de conteúdo repetido, fila
durável, budget por source host ou timeline consolidada que una baseline e todas
as capturas. Esses pontos pertencem ao endurecimento posterior do orquestrador e
não são prometidos por este contrato.
