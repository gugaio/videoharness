# DRM no DASH — fase 1

Este documento explica o que o Stream Lens observa, por que cada dado existe e
como desenvolvimento e QA devem interpretar o painel **DRM declarado no MPD**.
A fase 1 cobre somente DASH. Sinalização DRM em HLS fica fora deste escopo.

## Modelo mental: DRM não é uma única etapa

Um playback protegido depende de uma cadeia. Cada camada responde a uma pergunta
diferente:

1. **MPD**: quais sistemas e parâmetros de proteção o manifesto anuncia?
2. **Init segment**: como as tracks e samples estão marcadas para CENC/CBCS?
3. **Mídia**: os samples estão efetivamente cifrados e coerentes com o init?
4. **Licença**: o challenge chega ao servidor e volta com uma resposta utilizável?
5. **Device/CDM/player**: aquele ambiente suporta o sistema, codec, robustez,
   políticas de saída e regras de licença?

A fase 1 observa apenas a primeira camada. Portanto, encontrar Widevine ou
PlayReady no MPD é evidência de **sinalização**, não de que o conteúdo tocará.
Uma falha de reprodução ainda pode estar nas outras quatro camadas.

## O que é coletado

Cada elemento DASH `ContentProtection` vira um item de `media.dash_drm`:

- `scope`: local exato da declaração (`period`, `adaptation_set` ou
  `representation`);
- IDs do período, AdaptationSet e representação que identificam o contexto;
- `system`: nome reconhecido a partir de `schemeIdUri`;
- `scheme_id_uri` e `value`: formato ou sistema de proteção anunciado;
- `default_kids`: KIDs normalizados, sem chaves ou material secreto;
- `pssh`: presença, validade base64, tamanho decodificado e SHA-256;
- `provenance`: `declared (DASH ContentProtection)`.

O campo legado `drm_systems` continua disponível para consumidores antigos, mas o
painel novo usa `dash_drm`, pois ele preserva escopo e parâmetros.

### Sistema e schemeIdUri

`schemeIdUri` pode identificar um formato genérico, como
`urn:mpeg:dash:mp4protection:2011`, ou um DRM por UUID. O analyzer reconhece:

| Identificador | Nome exibido |
|---|---|
| `urn:mpeg:dash:mp4protection:2011` | Proteção MP4 |
| `urn:uuid:1077efec-c0b2-4d02-ace3-3c1e52e2fb4b` | Common PSSH |
| `urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed` | Widevine |
| `urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95` | PlayReady |
| `urn:uuid:94ce86fb-07ff-4f43-adb8-93d2fa968ca2` | FairPlay |
| `urn:uuid:f239e769-efa3-4850-9c16-a903c6932efb` | Adobe Primetime |

Identificadores desconhecidos são preservados para investigação. URIs absolutas
são redacted antes de entrar no snapshot. A referência dos UUIDs conhecidos é o
[registro de ContentProtection do DASH-IF](https://dashif.org/identifiers/content_protection/).

### KID não é a chave

KID (*Key ID*) identifica qual chave de conteúdo deve ser usada. Ele não contém a
chave de descriptografia. Exibi-lo ajuda a encontrar:

- vídeo e áudio anunciando KIDs inesperadamente diferentes;
- mudança de KID entre períodos ou representações;
- manifesto apontando para um KID diferente do init segment, comparação que entra
  na fase 2;
- rotação de chave incompleta ou fora da fronteira esperada.

Nesta fase, diferença de KID é evidência para investigação, não finding automático.

### PSSH

PSSH carrega *initialization data* que o player/CDM pode usar para iniciar o fluxo
DRM. Sua presença não é obrigatória em todos os desenhos e não prova que uma licença
será emitida.

O Stream Lens deliberadamente **não persiste o base64 bruto**. Para cada declaração
ele guarda:

- `status`: `valid`, `empty` ou `invalid_base64`;
- `encoded_length`;
- `decoded_size`, quando o base64 é válido;
- `sha256` dos bytes decodificados.

O hash permite responder “estas duas declarações carregam o mesmo PSSH?” sem usar o
snapshot como transporte do payload. O formato e o papel do PSSH no Common
Encryption são descritos pela
[especificação W3C de CENC para EME](https://www.w3.org/TR/2014/WD-encrypted-media-20140828/cenc-format.html).

## Escopo e herança

`ContentProtection` pode aparecer no `Period`, no `AdaptationSet` ou na
`Representation`. O snapshot preserva onde ele foi declarado; não copia uma
declaração herdada para cada representação. Isso evita duplicação e mantém a
evidência rastreável ao XML.

Na análise visual:

- **Período**: declaração ampla; pode afetar conjuntos descendentes;
- **AdaptationSet**: normalmente aplica-se às representações daquele grupo;
- **Representação**: declaração específica de uma rendição.

Se duas representações do mesmo conjunto têm declarações diferentes, investigue se
isso é intencional antes de concluir que há erro.

## O que a fase 1 ajuda a resolver

- DRM esperado não aparece no MPD entregue por um CDN/origin;
- UUID ou esquema incorreto;
- KID ausente ou divergente entre partes do manifesto;
- PSSH vazio, base64 inválido ou diferente entre rendições/períodos;
- declaração feita em escopo inesperado;
- confusão entre Common PSSH e um sistema DRM específico.

Ela reduz o espaço de busca para “o problema já está no manifesto?” Se o MPD parece
coerente, a investigação segue para init/mídia, licença e device.

## O que não pode ser concluído

O painel não afirma:

- que a mídia está realmente cifrada;
- que `cenc` ou `cbcs` do init corresponde ao manifesto;
- que o servidor de licença está acessível ou autorizará o usuário;
- que token, certificado, política, HDCP ou nível de segurança estão corretos;
- que Widevine/PlayReady/FairPlay funcionará em um device específico;
- que houve sucesso ou falha de playback.

Essas conclusões exigem evidências das fases posteriores ou telemetria real do
player. EME fornece uma API comum, mas o CDM e suas capacidades continuam ligados ao
ambiente de execução; veja a
[visão geral de Encrypted Media Extensions do W3C](https://www.w3.org/html/media/).

## Roteiro de QA

1. **MPD sem DRM**: o painel não deve aparecer e `dash_drm` deve ser vazio.
2. **Widevine + PlayReady**: ambos devem aparecer separadamente e no escopo correto.
3. **default_KID**: KIDs com chaves `{}` e letras maiúsculas devem sair
   normalizados; o valor nunca deve ser chamado de chave de descriptografia.
4. **PSSH válido**: tamanho e hash aparecem; o base64 original não pode existir no
   snapshot nem na UI.
5. **PSSH inválido ou vazio**: a inspeção continua e o status explica o problema.
6. **Declaração por representação**: não pode ser duplicada como se viesse do
   AdaptationSet.
7. **URI sensível**: query, fragmento e userinfo não podem ser persistidos.
8. **HLS**: a fase 1 não cria `dash_drm` nem o painel DASH.
9. **Compatibilidade legada**: snapshots sem `dash_drm` continuam abrindo.

## Próxima fase proposta

DRM 2 deve inspecionar os init segments fMP4 e extrair proteção CENC/CBCS de boxes
como `sinf`, `schm`, `schi`, `tenc` e `pssh`. O objetivo será comparar declaração do
MPD com configuração efetiva da track: esquema, KID, IV e pattern encryption. Essa
fase precisa de aprovação própria antes da implementação.
