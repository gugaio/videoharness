# Spike do decoder CMCD — Fase 0

Data: 2026-08-29

## Decisão

O decoder de produção será uma implementação interna de CMCD v1 em
`internal/cmcd`, isolada pela interface `cmcd.Decoder`. Não adicionamos uma
dependência Go de parser no caminho de requests.

## Biblioteca avaliada

`github.com/untangledco/streaming/cmcd@v0.0.4` foi baixada e inspecionada
contra os requisitos do corpus planejado. É uma versão pré-1.0 e o seu lexer
divide o payload por vírgula em um `map[string]string`.

Limitações encontradas:

- uma chave repetida é sobrescrita; não há como reportar duplicata;
- vírgulas dentro de valores quoted são quebradas;
- escapes quoted não são interpretados corretamente;
- campos ausentes são convertidos para valores Go zero;
- `ot` e `st` não são validados completamente;
- não há limites de payload, chaves, strings ou custom fields.

Essas limitações conflitam com os critérios de conformidade e a necessidade de
distinguir ausência de `0` no Playback Inspector. A interface local mantém a
troca de implementação possível se surgir uma biblioteca adequada.

## Tooling JavaScript

`@svta/cml-cmcd@2.4.0` foi avaliada somente para geração de fixtures. O pacote
publicado no npm declara `dist/index.js` e `dist/index.d.ts`, mas a instalação
na data deste spike não contém o diretório `dist`; por isso ele não é usado.
Os fixtures JSON são deliberadamente pequenos, auditáveis e versionados no
repositório. Nenhuma dependência Node participa do runtime Go.
