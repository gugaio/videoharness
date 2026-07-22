# Architecture Decisions

Registro leve de decisoes duradouras. Alteracoes devem incluir data, contexto e
consequencias.

## 2026-07-21 - Repositorio novo e autonomo

Decisao:

- Video Harness sera implementado em um novo repositorio.
- Kael e VHS serao referencias e fontes de codigo, nao dependencias de runtime.
- Codigo necessario sera copiado para dentro deste projeto durante o MVP.

Motivo:

- Reduzir troca de contexto, releases cruzados e contaminacao dos projetos atuais.
- Concentrar backlog, CI, deploy e ownership em um unico produto.

Consequencia:

- Duplicacao temporaria e aceita.
- Melhorias genericas so serao extraidas de volta depois da validacao.

## 2026-07-21 - Stack conhecida do Kael

Decisao:

- React + Vite em vez de Next.js.
- Fastify + TypeScript no backend.
- React Router, TanStack Query, Zod, Tailwind e Vitest.

Motivo:

- A stack atende ao produto e evita curva de aprendizado sem impacto na hipotese
  principal.

## 2026-07-21 - Arquitetura hexagonal leve

Decisao:

- Casos de uso dependem de ports para infraestrutura relevante.
- Adapters concretos vivem nas bordas.
- Composicao manual, sem container de DI.

Motivo:

- PostgreSQL, storage, ferramentas de streaming e provider de IA sao fronteiras
  reais, mas o MVP nao precisa de arquitetura cerimonial.

## 2026-07-21 - PostgreSQL para estado e jobs

Decisao:

- PostgreSQL e a unica fonte de verdade.
- Jobs usam tabela, lease, heartbeat e claim transacional.
- Eventos de investigacao sao persistidos e alimentam SSE.

Motivo:

- Permitir recuperacao e reconexao sem adicionar Redis ou broker.

## 2026-07-21 - Filesystem local com port de storage

Decisao:

- Artifacts ficam inicialmente no filesystem.
- Metadados ficam no PostgreSQL.
- A aplicacao usa `ArtifactStore` para permitir R2 futuramente.

## 2026-07-21 - Evidencia antes de IA

Decisao:

- Ferramentas deterministicas fazem analise tecnica.
- IA explica, correlaciona, formula hipoteses e recomenda proximos passos.
- Chain of thought nunca e armazenado ou exibido.

## 2026-07-21 - Acesso a streams com destino fixado

Decisao:

- O worker resolve e valida todos os enderecos antes da conexao.
- A request conecta diretamente ao IP validado, mantendo `Host` e SNI.
- Redirects sao manuais e revalidados.
- Qualquer resposta DNS contendo endereco nao publico bloqueia o destino inteiro.

Motivo:

- Validar DNS e depois deixar outro cliente resolver novamente manteria uma janela
  para DNS rebinding e SSRF.
- O fluxo principal aceita URLs arbitrarias, portanto a fronteira segura precisa
  existir antes de qualquer ferramenta de streaming.

Consequencia:

- A policy e deliberadamente conservadora e pode rejeitar hosts com DNS misto.
- Proxies corporativos e streams privados exigirao uma policy explicita futura;
  nao sao suportados no MVP publico.
