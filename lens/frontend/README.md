# Stream Lens — frontend

Interface React/TypeScript para navegar snapshots canônicos do Stream Lens.

A inspeção usa uma superfície top-down: representações agrupadas por mídia, bitrate
e segmentos na mesma linha; selecionar um segmento expande seu container logo abaixo.
Strings AVC também mostram Profile e Level de forma legível ao lado do valor bruto.
Dados específicos de protocolo e JSON bruto permanecem recolhidos.

## Desenvolvimento

Na raiz do repositório:

```bash
make front
make test-frontend
make lint-frontend
```

O Vite encaminha `/api` para o backend local em `http://localhost:8000`.
