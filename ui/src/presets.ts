/**
 * Catálogo de presets do Stream Mock, espelhado do contrato da engine
 * (`mock/internal/models/stream.go`) só para exibição/seleção na UI de proxy.
 * O preset efetivo continua validado pelo mock.
 */
export type MockPresetOption = {
  key: string;
  label: string;
  description: string;
};

export const MOCK_PRESETS: MockPresetOption[] = [
  { key: "clean", label: "Clean", description: "Pass-through sem modificação." },
  {
    key: "subway_3g",
    label: "Subway 3G",
    description: "1500–3000 ms de latência artificial e 10% de chance de HTTP 504.",
  },
  {
    key: "cdn_degradation",
    label: "CDN Degradation",
    description: "20% dos pedidos de segmento falham com HTTP 500.",
  },
  {
    key: "stale_live_manifest",
    label: "Stale Live Manifest",
    description: "Refresh do manifesto atrasado em 4000 ms.",
  },
  {
    key: "drm_license_latency",
    label: "DRM License Latency",
    description: "Licenças ClearKey atrasadas em 3000 ms.",
  },
  {
    key: "drm_license_failure",
    label: "DRM License Failure",
    description: "Pedidos de licença ClearKey falham com HTTP 503.",
  },
  {
    key: "drm_license_recovery",
    label: "DRM License Recovery",
    description: "As duas primeiras licenças falham, depois recuperam.",
  },
  {
    key: "drm_wrong_key",
    label: "DRM Wrong Key",
    description: "A licença devolve uma chave deliberadamente errada.",
  },
  {
    key: "drm_malformed_license",
    label: "DRM Malformed License",
    description: "O servidor de licença devolve JSON malformado.",
  },
];
