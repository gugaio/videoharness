# Parser HLS

O parser HLS transforma o texto de uma playlist M3U8 em um
`UnifiedManifest`, o modelo comum usado pelo restante da Lens. Ele não faz
requisições, não lê arquivos e não captura segmentos. Recebe uma `str` já
carregada e devolve apenas dados estruturados do domínio.

O código está em [parsers/hls.py](../src/stream_lens/parsers/hls.py). A escolha
de usar esse parser acontece em
[application/manifest_inspector.py](../src/stream_lens/application/manifest_inspector.py).
Essa separação é descrita no [ADR-0007](adr/0007-parsers-e-coordenacao-na-aplicacao.md).

## Fluxo

```text
texto M3U8
    │
    ▼
DeclarativeManifestInspector
    │ conteúdo começa com #EXTM3U
    ▼
parse_hls()
    │
    ├── playlist.is_variant == True  → playlist master
    │                                      └─ _parse_master()
    │
    └── playlist.is_variant == False → media playlist
                                           └─ _parse_media()
    ▼
UnifiedManifest
```

O `DeclarativeManifestInspector` remove espaços nas extremidades e identifica
HLS pela assinatura `#EXTM3U`. A extensão da URL não participa da decisão.
Depois disso, `m3u8.loads()` interpreta as tags da playlist. A biblioteca
`m3u8` é usada como parser de sintaxe; o código da Lens faz o mapeamento para
o modelo de domínio.

## Playlist master

Uma playlist master declara as opções de reprodução e as rendições associadas.
`_parse_master()` produz um `UnifiedManifest` com `kind` igual a
`hls_master_playlist` e cria grupos de tracks:

| Entrada HLS | Representação no modelo |
|---|---|
| `#EXT-X-STREAM-INF` + URI | `Representation` dentro do grupo `VIDEO` chamado `variants` |
| `#EXT-X-MEDIA` de áudio | `Representation` em um `TrackGroup` `AUDIO` |
| `#EXT-X-MEDIA` de legendas | `Representation` em um `TrackGroup` `SUBTITLE` |
| `#EXT-X-MEDIA` de closed captions | `Representation` em um `TrackGroup` `CLOSED_CAPTIONS` |
| `CODECS` | `Representation.codecs` |
| `BANDWIDTH` | `Representation.bandwidth_bps` |
| `AVERAGE-BANDWIDTH` | `Representation.average_bandwidth_bps` |
| `RESOLUTION` | `Representation.resolution` |
| `FRAME-RATE` | `Representation.frame_rate` |
| `LANGUAGE` | `Representation.language` |
| `DEFAULT` / `AUTOSELECT` | `Representation.roles` |

O grupo de vídeo é criado somente quando há variantes. O identificador da
variante é sua URI, quando disponível. Para rendições `#EXT-X-MEDIA`, o
identificador prefere `NAME`, depois `GROUP-ID`.

As declarações `#EXT-X-SESSION-KEY` são convertidas em `DrmSystem`. O parser
preserva o `KEYFORMAT` como sistema (`identity` quando ausente) e registra o
método no campo de detalhes. Isso é sinalização do manifesto; não é teste de
licença nem validação de compatibilidade do player.

No master, `is_live` fica `False`: o tipo live só pode ser determinado ao
seguir uma media playlist. Essa limitação fica explícita em
`protocol_specific.hls.live_determination`.

## Media playlist

Uma media playlist declara os segmentos de uma representação. `_parse_media()`
produz um único `TrackGroup` de tipo `UNKNOWN`, contendo uma representação
`media-playlist`:

- cada segmento com URI vira um `SegmentDeclaration`;
- `EXTINF` vira `duration_seconds`;
- `EXT-X-DISCONTINUITY` vira `discontinuity`;
- o primeiro `EXT-X-MAP` com URI vira `init_segment`;
- a soma das durações vira `total_duration_seconds`;
- a quantidade de segmentos com URI vira `segment_count_declared`;
- `EXT-X-TARGETDURATION`, `EXT-X-MEDIA-SEQUENCE` e `EXT-X-PLAYLIST-TYPE`
  ficam em `protocol_specific.hls`;
- `is_live` é `not playlist.is_endlist`.

O campo `protocol_specific.hls.container` é `mp4` quando existe `EXT-X-MAP` e
`mpeg-ts` caso contrário. Isso é uma indicação baseada na playlist, não uma
análise dos bytes. A análise estrutural posterior confirma o formato depois
que os segmentos são capturados.

## Parser de playlist de captura

Além do `parse_hls()` (modelo do snapshot canônico), a captura usa
[`parsers/hls_playlist.py`](../src/stream_lens/parsers/hls_playlist.py)
(`parse_hls_media_playlist()`), que lê a mesma sintaxe `m3u8` para extrair os
fatos da janela: `EXT-X-MEDIA-SEQUENCE`, segmentos com `EXT-X-BYTERANGE`
resolvido (offset cumulativo), `EXT-X-MAP` com byte range e
program-date-time. Também é puro (sem I/O) e encapsula a lib `m3u8`; a seleção
da janela e a captura ficam na aplicação (ADR-0008).

## O que o parser não faz

O parser não resolve URIs relativas, baixa playlists filhas ou segmentos,
seleciona uma janela live, calcula bitrate, analisa MPEG-TS/fMP4 ou executa
`ffprobe`. Essas responsabilidades ficam no fluxo de captura e nos adapters.

Também não transforma ausência de metadados em diagnóstico. Por exemplo,
closed captions sem URI podem ser válidas porque são embutidas no container.
Nesse caso o parser cria a rendição e acrescenta um warning explicando a
ausência da URI.

## Exemplo mínimo

Entrada:

```m3u8
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e"
video/360p.m3u8
```

Resultado conceitual:

```json
{
  "protocol": "HLS",
  "kind": "hls_master_playlist",
  "track_groups": [
    {
      "kind": "video",
      "name": "variants",
      "representations": [
        {
          "id": "video/360p.m3u8",
          "uri": "video/360p.m3u8",
          "codecs": "avc1.4d401e",
          "bandwidth_bps": 800000,
          "resolution": { "width": 640, "height": 360 }
        }
      ]
    }
  ]
}
```

O JSON acima é ilustrativo: a serialização canônica adiciona campos do
snapshot e omite valores ausentes conforme o contrato.

## Testes e evolução

Os testes de parser e integração estão em:

- `tests/test_manifest_inspector.py` — reconhecimento HLS e DASH e erros de
  conteúdo;
- `tests/test_manifest_inspector.py` e `tests/test_capture.py` — uso do
  manifesto normalizado no planejamento da captura;
- `tests/test_unified_snapshot.py` — round-trip do modelo serializado;
- `tests/test_containers.py` — confirmação do container depois da captura.

Ao adicionar suporte a uma tag HLS, primeiro defina onde o dado pertence no
modelo (`Representation`, `SegmentDeclaration`, `protocol_specific`, warning
ou capability), depois cubra uma playlist fixture e o snapshot resultante.
Regras de rede, limites e escrita em disco não devem entrar neste parser.
