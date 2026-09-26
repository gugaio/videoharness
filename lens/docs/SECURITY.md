# SECURITY.md

**Status: threat model mínimo definido na Fase 0. Implementação começa antes da primeira captura remota (Fase 2).**

## Threat model mínimo

O Stream Lens baixa URLs fornecidas por usuários anônimos. Riscos principais: **SSRF**, abuso de recursos e vazamento de segredos de URL.

## Controles obrigatórios antes de aceitar URLs remotas

**Implementados e testados na Fase 2** (`safe_http_fetcher.py` + testes):

- Somente esquemas `http`/`https`; rejeição de userinfo na URL (validação no domínio e no fetcher).
- Bloqueio de loopback, private, link-local, multicast, reserved e metadata endpoints (DNS resolvido e **todos** os endereços validados; revalidado a cada redirect).
- Limite de redirects (5) com **revalidação completa do destino após cada redirect** (inclui redirect para metadata endpoint).
- Timeouts de conexão (5s) e leitura (15s); limite de bytes por resposta (2MB).
- Limite de concorrência de jobs (4, configurável); sem proxies do ambiente (`trust_env=False`); sem cookies/headers arbitrários.
- Content-Type como sinal, não única fonte de verdade (decisão por conteúdo).
- **Redaction** de query strings/userinfo/fragmento em snapshot e UI (`source.display_url`); URL crua nunca é persistida.
- Mensagens de erro com estágio, sem segredos.

**Implementados nas Fases 4–5**: teto de janela de 60s, orçamento base de 500MB
por inspeção e cap padrão de 20MB por segmento. A inspeção padrão pode elevar o
teto efetivo para reservar até dois segmentos por representação e os init segments;
o aumento acompanha o número de representações declaradas. Todas as playlists HLS
são seguidas por padrão; `STREAM_LENS_MAX_PLAYLISTS` positivo aplica um teto
operacional. Falhas de segmento viram resultado parcial. `ffprobe` usa lista fixa
de argumentos, sem shell, caminho somente do workspace e timeout de 10s. Seus
resultados são opcionais e derivados — uma falha do binário não invalida a análise
determinística.

`STREAM_LENS_ALLOW_LOOPBACK=1` existe exclusivamente para dev/testes locais; **não** é definido no compose.

## Capturas incrementais

- Cobertura e captura suplementar aceitam `source_url` novamente em cada pedido;
  a Lens valida a URL com a política existente e exige que sua forma redigida
  corresponda à origem registrada no baseline. O segredo só permanece em memória
  durante aquela operação; o estado guarda hash do pedido e URLs redigidas.
- Referências de segmento são opacas, limitadas à inspeção e derivadas do caminho
  sem query, representação e identidade/byte-range do segmento.
- A rota Lens não autentica usuários. Ela deve permanecer em rede interna; o VH
  faz autenticação humana/de agente e ownership antes de encaminhar pedidos.
- O endpoint limita cada seleção a 16 segmentos e 100 MB; o VH impõe 25 MB por
  chamada, 100 MB por investigação e 500 MB agregados por owner. Bytes recebidos,
  incluindo leitura parcial, são contabilizados; consumo desconhecido após falha
  permanece reservado pelo VH.

## Limitações explícitas

- **O ID compartilhável não é autenticação.** Qualquer pessoa com o ID acessa a inspeção dentro do TTL.
- Sem headers/cookies arbitrários na UI anônima do MVP; se necessário para testes locais, limitar à CLI e documentar o risco.
- Sem banco de dados; repositório temporário em filesystem local. **Múltiplas réplicas exigirão um adapter compartilhado** (ex.: object storage) no futuro — decisão registrada, fora do MVP. Jobs são in-process: uma réplica do backend por workspace (o compose sobe exatamente uma).
- Processo reiniciado: inspeções ativas órfãs são marcadas `failed` (`job_lost`) no startup — sem resultado silenciosamente perdido.
- Sem login, rate limiting por conta ou auditoria permanente no MVP.

## Comportamento em falha

Erros preservados por estágio do job; distinção entre falha de captura, formato não suportado, parse incompleto e ausência real de dados. Resultado parcial nunca apresentado como completo.
