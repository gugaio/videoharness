# AGENTS.md - Video Harness

Instrucoes obrigatorias para qualquer agente que atuar neste repositorio.

## Missao

Construir o Video Harness Space (VHS) como um workspace de investigacao e
experimentacao reproduzivel de video streaming. A validacao atual cobre dois
fluxos focados:

```text
URL + problema relatado -> investigacao visivel -> relatorio excelente
URL HLS VOD -> recording limitado -> URL controlada -> evidencia de troca ABR
```

Quando houver conflito entre adicionar funcionalidade e preservar simplicidade,
confiabilidade ou UX, priorize simplicidade, confiabilidade e UX.

## Bootstrap obrigatorio

No inicio de cada sessao:

1. Ler `docs/core/START-HERE.md`.
2. Ler `docs/planning/PROJECT-STATUS.md`.
3. Ler `docs/planning/PROJECT-VISION.md` se precisar de contexto de produto.
4. Ler `docs/architecture/README.md`.
5. Ler a fase ativa indicada no status em `docs/architecture/phases/`.
6. Ler `docs/planning/RECORD-ABR-IMPLEMENTATION-PLAN.md` quando a tarefa afetar
   Record, origem local, delivery ou ABR.
7. Ler `docs/ui/UI-GUIDE.md` quando a tarefa afetar experiencia ou frontend.
8. Ler `docs/api.md` quando a tarefa afetar contratos HTTP ou SSE.

## Fonte de verdade

- Este repositorio e autonomo durante a validacao do MVP.
- Nao adicionar dependencia de runtime para `../kael` ou `../vhs`.
- Codigo aproveitado deve ser copiado para este repositorio com origem registrada.
- Depois de copiado, o codigo passa a ser mantido aqui durante o MVP.
- Nao tentar sincronizacao bidirecional com Kael ou VHS durante a validacao.

Ao importar um modulo, registrar no README do modulo:

- repositorio de origem;
- commit ou tag de origem;
- data da importacao;
- adaptacoes relevantes feitas depois da copia.

## Escopo atual

Construir somente:

1. Criacao de investigacao por URL e descricao opcional do problema.
2. Persistencia de investigacoes, jobs, eventos, artifacts e reports.
3. Worker recuperavel para executar o pipeline.
4. Coleta deterministica de evidencias com ferramentas de streaming.
5. Sintese assistida por IA baseada nas evidencias.
6. Timeline ao vivo via SSE com reconexao.
7. Relatorio final bonito e compartilhavel.
8. Deploy barato em um unico VPS com Docker Compose.
9. Record HLS VOD limitado com toda a ladder suportada.
10. Origem HTTP local com URL unica por playback run.
11. Simulacao deterministica de throughput/latencia para induzir ABR.
12. Journal de requests e comprovacao de troca no nivel de request.

Nao construir agora:

- Record live, Watch ou Replay funcionais;
- DASH Record antes do Definition of Done de HLS VOD;
- DRM, LL-HLS, perda/reorder de pacotes ou emulacao de device;
- dashboard generico de operacoes;
- chat generico;
- memoria, skills, MCP ou canais;
- marketplace ou plugins;
- colaboracao em equipe;
- microservicos, Redis, Kafka ou Kubernetes.

## Stack padrao

- Node.js 22+.
- TypeScript strict.
- Backend Fastify.
- Worker Node.js no mesmo codebase do backend.
- React + Vite.
- React Router, TanStack Query e Zod.
- Tailwind e shadcn/ui quando trouxer valor real.
- PostgreSQL com SQL e migrations explicitas.
- Vitest.
- Server-Sent Events (SSE).
- Filesystem local atras de um contrato de storage.
- Docker Compose.

Nao trocar a stack sem registrar a decisao em
`docs/architecture/DECISIONS.md` e atualizar a fase ativa.

## Principios arquiteturais

1. Usar arquitetura hexagonal leve, nao cerimonial.
2. O fluxo de investigacao nao deve importar Fastify, PostgreSQL, React ou SDKs
   concretos de IA.
3. Criar ports apenas para fronteiras externas relevantes.
4. Preferir composicao manual de dependencias a frameworks de DI.
5. Evitar repositories genericos, command bus, event bus e abstracoes usadas uma
   unica vez.
6. Manter o pacote interno de stream tools deterministico e sem conceitos de
   usuario, jobs, agentes, prompts ou produto.
7. O LLM explica evidencias; ferramentas deterministicas produzem os fatos.
8. Preferir um modelo canonico por conceito, enriquecido ao longo do pipeline.
9. Nao criar tipos diferentes apenas para nomear etapas como `Collected`,
   `Processed`, `Promoted` ou `Stored` quando continuam representando a mesma
   entidade. Separar tipos somente quando houver uma invariante ou fronteira real.
10. Projecoes serializaveis podem ser tipos separados quando removem dados de
    runtime, como bytes, handles ou segredos. Exemplo: `Manifest` interno vira
    `ManifestEvidence` no report sem carregar o corpo baixado.

## Regras de implementacao

1. TypeScript strict, sem `any` silencioso.
2. Validar entradas e respostas externas com Zod nas fronteiras.
3. Fazer mudancas pequenas, verificaveis e cobertas proporcionalmente ao risco.
4. Preferir funcoes pequenas, nomes claros e contratos explicitos.
5. Nao expor chain of thought. Eventos mostram progresso, observacoes,
   evidencias, hipoteses e confianca.
6. Nao criar spinner ou progresso ficticio para investigacoes; publicar eventos
   reais do pipeline.
7. Nao executar comandos de shell construidos com input do usuario. Processos de
   midia usam binario e argumentos estruturados.
8. URLs fornecidas por usuarios exigem protecao contra SSRF, redirects maliciosos,
   redes privadas e downloads sem limite.
9. Temporary files ficam isolados por investigation ou recording ID e devem ser
   limpos em sucesso ou falha, preservando somente artifacts/recordings publicados.
10. Nao incluir segredos, `.env`, artifacts locais ou workspaces no Git.
11. O data plane de Record serve somente recursos previamente registrados; nunca
    transforma um path pedido pelo device em fetch sob demanda para a origem.
12. Perfis de rede sao deterministas e limitados. Video, audio e demais recursos
    de media compartilham o budget do playback run.
13. Request de outra variant comprova selecao de rede, nao decode ou render. Essa
    limitacao deve permanecer explicita na API, UI e resultado.
14. Tokens de playback sao opacos, armazenados como hash e redigidos de logs.

## Contratos e documentacao

Ao criar ou alterar endpoint:

1. Atualizar `docs/api.md`.
2. Atualizar o diagrama Mermaid.
3. Atualizar a tabela de referencia.
4. Marcar claramente se o endpoint esta planejado ou implementado.

Ao alterar arquitetura, dados ou runtime:

1. Atualizar a fase ativa.
2. Registrar decisoes duradouras em `docs/architecture/DECISIONS.md`.
3. Atualizar `docs/core/START-HERE.md` se a navegacao ou direcao mudou.

Ao alterar UX:

1. Atualizar `docs/ui/UI-GUIDE.md`.
2. Preservar dark mode first, responsividade e foco no CTA principal.

## Atualizacao de status obrigatoria

A cada commit funcional, atualizar `docs/planning/PROJECT-STATUS.md` com:

- fase impactada;
- entrega realizada;
- arquivos-chave;
- validacoes executadas;
- pendencias;
- proximo passo recomendado.

Nao marcar uma fase como concluida sem satisfazer seu Definition of Done.

## Validacao minima

Quando os scripts existirem, executar conforme o escopo:

```bash
npm run check
npm test
npm --prefix ui run check
npm --prefix ui run build
git diff --check
```

Registre no status o que nao foi executado e por que.
