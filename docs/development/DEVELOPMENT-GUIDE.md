# Development Guide

## Estrategia

Implementar fatias verticais pequenas. Cada fase deve produzir comportamento
observavel antes de aprofundar o dominio.

## Comandos locais

```bash
docker compose up -d postgres
npm run db:migrate
npm run dev:api
npm run dev:worker
npm run ui:dev
```

Validacao:

```bash
npm run check
npm test
npm run build
npm --prefix ui run check
npm --prefix ui run build
```

## Convencoes

- TypeScript strict.
- Feature-first por dominio.
- Tipos ficam proximos do dominio que os possui.
- Zod nas fronteiras; tipos internos podem ser TypeScript puro.
- Funcoes pequenas e dependencias explicitas.
- Testes junto ao modulo quando isso facilitar navegacao.
- Logs estruturados, sem URLs completas contendo tokens.

## Modelos canonicos e enriquecimento progressivo

Use um unico modelo para o mesmo conceito enquanto ele atravessa um fluxo linear.
As etapas enriquecem esse objeto em vez de criar aliases com nomes de lifecycle.

Exemplo:

```ts
type Manifest = {
  logicalKey: string;
  role: "root" | "variant" | "rendition";
  source: ManifestSource;
  content: { bytes: Uint8Array };
  inspection: ManifestInspection;
  artifact?: ArtifactReference;
};
```

O collector preenche source, content e inspection. O application service adiciona
`artifact` depois do storage. O evidence builder projeta o mesmo `Manifest` para
`ManifestEvidence`, removendo bytes e mantendo apenas fatos e referencias
serializaveis.

Evite criar `FetchedManifest`, `CollectedManifest`, `ProcessedManifest` ou
`PromotedManifest` apenas para expressar a ordem do pipeline. Um tipo separado so
se justifica quando:

- atravessa uma fronteira externa com contrato proprio;
- remove dados que nao podem ser serializados ou expostos;
- representa uma invariante materialmente diferente;
- impede uma classe real de erro que nao pode ser protegida por uma validacao
  pequena e explicita.

Essa regra vale tambem para segments, probes e artifacts futuros.

## Hexagonal sem cerimonia

Um caso de uso recebe dependencias:

```ts
export function createStartInvestigation(deps: {
  investigations: InvestigationRepository;
  jobs: JobRepository;
  events: InvestigationEventRepository;
}) {
  return async function startInvestigation(input: StartInvestigationInput) {
    // application flow
  };
}
```

Nao usar decorators ou framework de DI. A composicao acontece nos entrypoints da
API e do worker.

## Banco

- Migrations SQL versionadas.
- Transacoes explicitas quando invariantes cruzam tabelas.
- Datas armazenadas em UTC.
- IDs UUID para entidades; ID monotono para eventos.
- Nao esconder queries importantes atras de repository generico.

## Processos de midia

- Usar `spawn` com binario e array de argumentos.
- Timeout e AbortSignal obrigatorios.
- Limitar stdout/stderr mantido em memoria.
- Nunca interpolar input do usuario em shell.
- Registrar duracao, exit code e erro sanitizado.

## Importacao de codigo legado

Antes de copiar:

1. Identificar commit de origem.
2. Copiar somente source, testes e fixtures necessarios.
3. Nao copiar `dist`, coverage, dados locais ou configs obsoletas.
4. Registrar proveniencia no README do modulo.
5. Fazer a importacao em commit isolado antes de adaptacoes amplas.

## Definition of Done de uma mudanca

- Comportamento implementado.
- Testes relevantes passando.
- TypeScript e build passando.
- Documentacao/phase/status atualizados.
- Nenhum segredo ou artifact local no diff.
- Proximo passo registrado.
