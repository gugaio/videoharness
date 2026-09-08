# Guia: Playback Observer com HLS.js

Guia prático para desenvolvedores de player que querem instrumentar reprodução HLS com o pacote `@streammock/playback-observer`.

---

## 1. O que você ganha

O observer escuta os eventos do `<video>` e do `Hls.js`, normaliza tudo em eventos estruturados e envia para o seu backend em lotes. Sem instrumentar nada na mão, você passa a ter:

- **Timeline de playback** — `playing`, `buffering_started/ended`, `seek_*`, `paused/resumed`, `first_frame`, `ended`, `media_error`.
- **Detalhes HLS** — manifest load/parse, carregamento de fragmentos, mudança de nível/bitrate, `fps_drop`, stalls e erros.
- **Correlação com o backend** — todo evento carrega `session_id` + timestamps (`wall_time_ms`, `monotonic_ms`) + posição (`media_time_ms`, `buffer_ahead_ms`), permitindo reconstruir o que aconteceu lado a lado com seus logs de rede.
- **Fail-open** — qualquer erro de telemetria é engolido; nunca quebra a reprodução.

---

## 2. Instalação

```sh
npm install @streammock/playback-observer hls.js
```

`hls.js` é uma **peer dependency opcional**: só o subpath `/hls` o importa. Quem usa outro player (Shaka, nativo) não precisa dele.

---

## 3. Setup mínimo com HLS.js

```ts
import Hls from "hls.js";
import { observePlayback } from "@streammock/playback-observer";
import { hlsJsAdapter } from "@streammock/playback-observer/hls";

const video = document.querySelector("video")!;
const hls = new Hls();

// 1. Cria o observer ANTES de carregar o manifesto
const observer = observePlayback({
  media: video,
  adapter: hlsJsAdapter(hls),
  sessionId: "session-abc-123",      // seu ID de correlação (ex.: id da sessão de visualização)
  ingestUrl: "/api/playback/events", // endpoint do seu backend
});

// 2. Registra a intenção de play ANTES de o HLS.js começar a baixar o manifest.
//    Isso garante que o "startup" medido inclui load + parse do manifesto.
observer.playRequested();

// 3. Player normal
hls.loadSource(manifestUrl);
hls.attachMedia(video);
video.play();
```

---

## 4. Onde colocar o `playRequested()`

O `playRequested()` deve ser chamado **antes** de `hls.loadSource(...)`. Ele marca a intenção de play e dispara a medição precisa do **primeiro frame** via `requestVideoFrameCallback` (com fallback no evento `playing`).

Se o usuário clicar em "play" mais tarde (player com play explícito), chame `playRequested()` nesse momento — antes de `video.play()`.

---

## 5. Lifecycle / cleanup

```ts
// Ao destruir o player (troca de stream, unmount, fim da página)
observer.destroy();
hls.destroy();
```

`destroy()` é idempotente: emite `session_ended`, dá flush na fila e remove todos os listeners (do `<video>`, do `document` e do adapter HLS). No fechamento da página, `sendBeacon` garante o envio do que ainda está na fila.

---

## 6. O que chega no seu backend

O transporte padrão (`HTTPBatchTransport`) faz `POST` no `ingestUrl` com:

```json
{
  "events": [
    {
      "id": "uuid",
      "sequence_number": 0,
      "event_type": "session_started",
      "wall_time_ms": 1720000000000,
      "monotonic_ms": 12.4,
      "media_time_ms": 0,
      "buffer_ahead_ms": 0,
      "payload_json": "{\"session_id\":\"session-abc-123\",\"observer\":\"@streammock/playback-observer\",\"version\":1}"
    }
  ]
}
```

**Batching:** flusha a cada 20 eventos ou 1500ms (o que vier primeiro), com `keepalive: true` e 1 retry em erro 5xx. No `pagehide`, usa `navigator.sendBeacon`.

### Tipos de evento

| Grupo | Eventos |
| --- | --- |
| Núcleo (qualquer player) | `session_started`, `session_ended`, `play_requested`, `first_frame`, `playing`, `buffering_started`, `buffering_ended`, `seek_started`, `seek_ended`, `paused`, `resumed`, `ended`, `media_error`, `visibility_changed`, `media_snapshot` (a cada 2s) |
| Adapter HLS.js | `manifest_loading`, `manifest_loaded`, `manifest_parsed`, `fragment_loading`, `fragment_loaded`, `fragment_parsed`, `fragment_buffered`, `buffer_appended`, `buffer_append_error`, `level_switching`, `level_switched`, `emergency_downswitch`, `fps_drop`, `stall_detected`, `stall_resolved`, `hls_error` |

---

## 7. Contexto extra e metadados

Enriqueça cada evento com campos próprios do seu produto:

```ts
const observer = observePlayback({
  media: video,
  adapter: hlsJsAdapter(hls),
  ingestUrl: "/api/playback/events",
  context: {
    user_id: "u-42",
    content_id: "movie-7",
    ab_test: "variant-b",
  },
});
```

`context` é mesclado no `payload_json` de todo evento (junto com o `session_id`). Se seu `sessionId` é o `cmcd_session_id` do backend, a correlação com os requests de manifesto/fragmento acontece automaticamente.

---

## 8. Transport customizado

Precisa de um protocolo próprio, websocket, ou já tem um sink de telemetria?

```ts
import { observePlayback, type ObserverEvent } from "@streammock/playback-observer";

const observer = observePlayback({
  media: video,
  adapter: hlsJsAdapter(hls),
  transport: {
    enqueue(event: ObserverEvent) {
      myTelemetrySink.send(event);
    },
    async flush() {},
    closeWithBeacon() {
      myTelemetrySink.flushNow();
    },
  },
});
```

Contrato `Transport`: `enqueue(event)` (chamado a cada evento) + `flush()` + `closeWithBeacon()`. Ao passar `transport`, o `ingestUrl` é ignorado.

---

## 9. Fallback nativo (Safari / iOS)

Em navegadores sem MSE (o HLS nativo), o observer continua funcionando sem o adapter:

```ts
import { observePlayback } from "@streammock/playback-observer";

if (video.canPlayType("application/vnd.apple.mpegurl")) {
  const observer = observePlayback({ media: video, sessionId, ingestUrl });
  observer.playRequested();
  video.src = manifestUrl;
  video.play();
}
```

Você perde os eventos HLS (manifest/fragment), mas mantém toda a telemetria de reprodução (buffering, seek, errors, first frame).

---

## 10. Checklist de integração

- [ ] `observePlayback` criado **antes** de `loadSource`
- [ ] `playRequested()` chamado antes do `video.play()`
- [ ] `observer.destroy()` no cleanup do player (e `hls.destroy()`)
- [ ] Backend aceita `POST` JSON `{ events: [...] }` no `ingestUrl`
- [ ] `sessionId` é o mesmo usado para correlação (ex.: CMCD `session_id`)
- [ ] Telemetria tratada como não-crítica: nunca bloqueie play em falha de envio