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

`@svta/cml-cmcd@2.4.0` é uma dependência de desenvolvimento exata do frontend,
usada somente por `web/scripts/generate-cmcd-fixtures.mjs`. O script gera os
casos v1 válidos de referência e possui modo `--check`; fixtures inválidas são
manuais porque um encoder de referência não deve produzi-las.

O pacote e seus peer dependencies não são importados pelo React nem pelo
backend. Nenhuma dependência Node participa do runtime Go.
