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

## 2026-07-21 - Identidade logica e lote de artifacts

Decisao:

- Artifacts possuem `logical_key` unica por investigation.
- Uma coleta registra artifacts e evidence bundle em um unico lote PostgreSQL.
- Retries substituem o registro da mesma logical key e removem o arquivo anterior
  somente depois do commit.
- O `EvidenceBundle` v1 permanece legivel; novas coletas usam o v2 com arrays de
  manifests e media samples.

Motivo:

- A proxima fatia produz root manifest, manifests derivados e depois chunks.
- O contrato anterior assumia um unico arquivo e poderia acumular artifacts
  duplicados quando uma tentativa falhasse depois da coleta.

Consequencia:

- Collectors podem continuar pequenos, mas o application core ja aceita promover
  varios artifacts atomicamente.
- Compatibilidade de leitura evita invalidar investigations locais existentes.

## 2026-07-22 - Amostragem HLS limitada e auditavel

Decisao:

- Masters HLS sao parseadas integralmente, mas a coleta derivada fica limitada a
  uma variant e uma rendition de audio vinculada.
- A variant de maior `BANDWIDTH` e selecionada; empates preservam a ordem original.
- Audio prefere `DEFAULT=YES`, depois `AUTOSELECT=YES` e ordem da master.
- Toda URI derivada passa novamente pela fronteira SSRF e pelos limites de manifest.

Motivo:

- Obter um media manifest real prepara a amostragem e o FFprobe sem baixar uma
  ladder inteira antes de validar valor.
- Uma regra deterministica e persistida no evidence bundle torna a escolha
  reproduzivel e explicavel.

Consequencia:

- O primeiro report nao representa toda a ladder; essa limitacao fica explicita.
- Outras variants podem ser coletadas futuramente quando o relato ou uma evidencia
  justificar comparacao ABR.

## 2026-07-22 - Modelo canonico enriquecido no pipeline

Decisao:

- Cada conceito possui preferencialmente um modelo interno canonico.
- Processos sequenciais enriquecem o mesmo objeto em vez de criar tipos nomeados
  por etapa.
- Projecoes de API/evidence continuam separadas quando removem bytes ou outros
  dados exclusivos do runtime.

Aplicacao inicial:

- `Manifest` contem source, content, inspection e artifact opcional.
- `ManifestCollector` devolve uma `ManifestCollection`.
- O worker adiciona `artifact` depois do filesystem.
- `ManifestEvidence` e a projecao persistida sem `content.bytes`.

Motivo:

- `CollectedManifest`, `PromotedManifest` e `ManifestEvidence` pareciam conceitos
  distintos, embora os dois primeiros fossem apenas estados do mesmo manifesto.
- O vocabulario adicional dificultava entender o fluxo e seria repetido em
  segments e probes.

Consequencia:

- O pipeline fica mais direto e o ponto de enriquecimento permanece explicito.
- Novos tipos por etapa exigem uma justificativa concreta de fronteira ou
  invariante, nao apenas conveniencia nominal.
