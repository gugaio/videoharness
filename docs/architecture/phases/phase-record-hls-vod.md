# Fase Record R1 - HLS VOD + Simulacao ABR

Status: **ativa**.

## Objetivo

Materializar uma janela HLS VOD com toda a ladder suportada, servi-la por uma URL
estavel do Video Harness, controlar throughput/latencia e transformar requests do
device em evidencia auditavel de decisoes ABR.

## Fluxo do produto

```text
URL HLS VOD
  -> validar e gravar
  -> revisar ladder e cobertura
  -> escolher profile ABR
  -> copiar URL para o device
  -> observar requests e trocas
  -> encerrar playback run com resultado
```

## Escopo

- HLS VOD master, clear e inicialmente MPEG-TS.
- Janela limitada, default de 120 segundos.
- Todas as variants suportadas e audio vinculado.
- Recording imutavel e reutilizavel.
- PlaybackRun independente por device/cenario.
- Origem HTTP no runtime Fastify existente.
- Throughput com token bucket compartilhado e latencia fixa por stage.
- Request journal e transicoes ABR observadas/sustentadas.
- UI Record dedicada, dark-first e responsiva.

## Fora do corte

- live, DRM, AES-128, LL-HLS e byte ranges na origem;
- jitter, perda, reorder e erro HTTP injetado;
- proxy sob demanda para a origem;
- comprovacao de decode ou render no device;
- DASH, que pertence a Record R2.

## Fatias

1. Fundacao persistente, jobs e storage. **Implementada internamente; a
   composicao de producao aguardara o materializador HLS do Slice 2 antes de
   aceitar requests.**
2. Clone HLS VOD completo e protegido. **Implementado para master clear/MPEG-TS
   com 2--8 variants e renditions de audio vinculadas; os recursos e playlists
   locais sao registrados antes de marcar o recording como pronto.**
3. Data plane com URL fixa e recursos publicados. **Implementado para GET:
   `/streams/recordings/:recordingId/*` e estavel por recording; cada request
   resolve o run aberto atual e a rota le somente arquivos publicados daquele
   recording.**
4. Network shaping reproduzivel. **Implementado: profile v1 validado e
   persistido, latencia por resposta e token bucket compartilhado por run. O
   contador de requests ainda e efemero ate o journal do Slice 5.**
5. Journal, inferencia ABR e resultado.
6. UX Record.
7. Evals, device smoke, hardening e deploy.

O detalhamento executavel esta em
`docs/planning/RECORD-ABR-IMPLEMENTATION-PLAN.md`.

## Evidencia ABR

- `observed`: request de video muda de variant.
- `sustained`: pelo menos dois chunks posteriores consecutivos usam a nova
  variant.
- `not_observed`: houve cobertura suficiente, mas nenhuma troca foi pedida.
- `inconclusive`: ladder, cobertura, requests ou duracao nao permitem concluir.

O texto de produto usa sempre `request-level ABR switch`. Renderizacao exige
telemetria externa e permanece uma limitacao explicita.

## Definition of Done

- Recording HLS VOD recuperavel e publicado atomicamente.
- Pelo menos duas variants tocaveis na URL local.
- Device nao precisa acessar a origem depois do recording pronto.
- Profile good -> constrained -> recovery entrega throughput medido.
- Requests identificam variant, bitrate, sequence e stage.
- Downshift real aparece no journal quando o player o solicita.
- Ausencia de upshift ou downshift nunca e convertida em sucesso ficticio.
- API, UI, storage, recovery, SSRF e shaping possuem testes proporcionais.
- Smoke passa com fixture de tres variants e com um device/player externo.

## Proximo passo

Implementar o Slice 5: journal persistido de delivery requests, consulta
paginada e inferencia deterministica de trocas ABR.
