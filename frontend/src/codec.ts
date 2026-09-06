export interface AvcCodecInfo {
  prefix: 'avc1' | 'avc3'
  profileHex: string
  constraintsHex: string
  levelHex: string
  profile: string
  level: string
}

export interface HevcCodecInfo {
  prefix: 'hvc1' | 'hev1'
  profileSpace: string
  profileIdc: string
  compatibilityFlags: string
  tier: 'L' | 'H'
  levelIdc: string
  constraintFlags: string | null
  profile: string
  level: string
}

export interface CodecInfo {
  raw: string
  family: string | null
  avc: AvcCodecInfo | null
  hevc: HevcCodecInfo | null
}

const AVC_PROFILES: Record<number, string> = {
  66: 'Baseline',
  77: 'Main',
  88: 'Extended',
  100: 'High',
  110: 'High 10',
  122: 'High 4:2:2',
  244: 'High 4:4:4 Predictive',
}

const AVC_PROFILE_EXAMPLES: Record<string, string> = {
  Baseline: 'Ferramentas mais simples e ampla compatibilidade. Foi comum em dispositivos antigos, vídeo móvel e chamadas de vídeo.',
  Main: 'Recursos intermediários e compressão mais eficiente que Baseline. Foi comum em transmissão digital e dispositivos móveis mais antigos.',
  Extended: 'Recursos voltados a streaming e recuperação de erros. É pouco usado em distribuição moderna.',
  High: 'Ferramentas avançadas e melhor eficiência de compressão. É o profile mais comum em streaming HD e Full HD.',
  'High 10': 'Estende o High para vídeo de até 10 bits por componente. É mais comum em distribuição e produção profissional.',
  'High 4:2:2': 'Suporta amostragem de cor 4:2:2 e maior fidelidade cromática. É usado principalmente em broadcast e produção.',
  'High 4:4:4 Predictive': 'Preserva informação de cor 4:4:4 e oferece alta fidelidade. É voltado a workflows profissionais, não à reprodução web comum.',
}

const AVC_LEVEL_EXAMPLES: Record<string, string> = {
  '1': 'Uso típico: vídeo muito pequeno, como 176×144 em cerca de 15 fps.',
  '1b': 'Uso típico: vídeo muito pequeno, com limites entre os Levels 1 e 1.1.',
  '1.1': 'Uso típico: 176×144 em 30 fps ou 320×240 com frame rate menor.',
  '1.2': 'Uso típico: 320×240 em cerca de 20 fps.',
  '1.3': 'Uso típico: 320×240 em cerca de 30 fps.',
  '2': 'Uso típico: 352×288 em cerca de 30 fps.',
  '2.1': 'Uso típico: vídeo SD reduzido, como 352×480 em cerca de 25 fps.',
  '2.2': 'Uso típico: vídeo SD reduzido, como 352×576 em cerca de 25 fps.',
  '3': 'Uso típico: vídeo SD, como 720×480 em cerca de 30 fps.',
  '3.1': 'Uso típico: HD 1280×720 em cerca de 30 fps.',
  '3.2': 'Uso típico: HD 1280×720 em até cerca de 60 fps.',
  '4': 'Uso típico: Full HD 1920×1080 em cerca de 30 fps.',
  '4.1': 'Uso típico: Full HD 1920×1080 em cerca de 30 fps, com mais margem de bitrate e buffer que o Level 4.',
  '4.2': 'Uso típico: Full HD 1920×1080 em até cerca de 60 fps.',
  '5': 'Uso típico: vídeo acima de Full HD, chegando a aproximadamente 2K.',
  '5.1': 'Uso típico: 4K 4096×2160 em cerca de 30 fps.',
  '5.2': 'Uso típico: 4K 4096×2160 em até cerca de 60 fps.',
  '6': 'Uso típico: 8K 8192×4320 em cerca de 30 fps.',
  '6.1': 'Uso típico: 8K 8192×4320 em até cerca de 60 fps.',
  '6.2': 'Uso típico: 8K 8192×4320 em até cerca de 120 fps.',
}

const HEVC_PROFILES: Record<number, string> = {
  1: 'Main',
  2: 'Main 10',
  3: 'Main Still Picture',
  4: 'Range Extensions',
  5: 'High Throughput',
  6: 'Multiview Main',
  7: 'Scalable Main',
  8: '3D Main',
  9: 'Screen-Extended Main',
  10: 'Scalable Range Extensions',
  11: 'High Throughput Screen-Extended',
}

const HEVC_LEVELS: Record<number, string> = {
  30: '1',
  60: '2',
  63: '2.1',
  90: '3',
  93: '3.1',
  120: '4',
  123: '4.1',
  150: '5',
  153: '5.1',
  156: '5.2',
  180: '6',
  183: '6.1',
  186: '6.2',
}

const HEVC_PROFILE_EXAMPLES: Record<string, string> = {
  Main: 'Profile HEVC de 8 bits, comum em distribuições SDR mais leves.',
  'Main 10': 'Profile HEVC de 10 bits por componente, comum em HDR e em distribuições UHD.',
  'Main Still Picture': 'Profile voltado a imagens estáticas HEVC.',
  'Range Extensions': 'Profile para recursos HEVC avançados, como maior fidelidade de cor e profundidade de bits.',
  'High Throughput': 'Profile HEVC para fluxos de alta taxa e aplicações profissionais.',
}

const HEVC_LEVEL_EXAMPLES: Record<string, string> = {
  '3.1': 'Uso típico: até 1280×720 em cerca de 30 fps no Main Tier.',
  '4': 'Uso típico: Full HD em cerca de 30 fps no Main Tier.',
  '4.1': 'Uso típico: Full HD em até cerca de 60 fps no Main Tier.',
  '5': 'Uso típico: 4K em cerca de 30 fps no Main Tier.',
  '5.1': 'Uso típico: 4K em até cerca de 60 fps no Main Tier.',
  '5.2': 'Uso típico: 4K com limites maiores de taxa e buffer.',
  '6': 'Uso típico: 8K em cerca de 30 fps no Main Tier.',
  '6.1': 'Uso típico: 8K em até cerca de 60 fps no Main Tier.',
  '6.2': 'Uso típico: 8K em até cerca de 120 fps no Main Tier.',
}

function formatAvcLevel(levelIdc: number, constraints: number): string {
  if (levelIdc === 11 && (constraints & 0x10) !== 0) return '1b'
  if (levelIdc % 10 === 0) return String(levelIdc / 10)
  return (levelIdc / 10).toFixed(1)
}

export function describeAvcLevel(level: string): string {
  return AVC_LEVEL_EXAMPLES[level] ?? 'Este level define limites combinados de resolução, frame rate, bitrate e buffer.'
}

export function describeAvcProfile(profile: string): string {
  return AVC_PROFILE_EXAMPLES[profile] ?? 'Este profile define o conjunto de ferramentas de compressão que o decoder precisa suportar.'
}

export function describeHevcLevel(level: string): string {
  return HEVC_LEVEL_EXAMPLES[level] ?? 'Este level define limites combinados de resolução, frame rate, bitrate e buffer para o decoder HEVC.'
}

export function describeHevcProfile(profile: string): string {
  return HEVC_PROFILE_EXAMPLES[profile] ?? 'Este profile define o conjunto de ferramentas HEVC e a profundidade de bits que o decoder precisa suportar.'
}

export function decodeCodec(codec: string): CodecInfo {
  const raw = codec.trim()
  const avcMatch = /^(avc1|avc3)\.([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(raw)
  if (avcMatch) {
    const profileIdc = Number.parseInt(avcMatch[2], 16)
    const constraints = Number.parseInt(avcMatch[3], 16)
    const prefix = avcMatch[1].toLowerCase() as AvcCodecInfo['prefix']

    return {
      raw,
      family: 'H.264/AVC',
      avc: {
        prefix,
        profileHex: avcMatch[2].toLowerCase(),
        constraintsHex: avcMatch[3].toLowerCase(),
        levelHex: avcMatch[4].toLowerCase(),
        profile: AVC_PROFILES[profileIdc] ?? `Profile ${profileIdc}`,
        level: formatAvcLevel(Number.parseInt(avcMatch[4], 16), constraints),
      },
      hevc: null,
    }
  }

  const hevcMatch = /^(hvc1|hev1)\.([A-C]?)(\d+)\.([0-9a-f]+)\.([LH])(\d+)(?:\.([0-9a-f]+))?$/i.exec(raw)
  if (hevcMatch) {
    const prefix = hevcMatch[1].toLowerCase() as HevcCodecInfo['prefix']
    const profileIdc = Number.parseInt(hevcMatch[3], 10)
    const levelIdc = Number.parseInt(hevcMatch[6], 10)
    return {
      raw,
      family: 'H.265/HEVC',
      avc: null,
      hevc: {
        prefix,
        profileSpace: hevcMatch[2].toUpperCase(),
        profileIdc: hevcMatch[3],
        compatibilityFlags: hevcMatch[4].toLowerCase(),
        tier: hevcMatch[5].toUpperCase() as HevcCodecInfo['tier'],
        levelIdc: hevcMatch[6],
        constraintFlags: hevcMatch[7]?.toLowerCase() ?? null,
        profile: HEVC_PROFILES[profileIdc] ?? `Profile ${hevcMatch[2].toUpperCase()}${profileIdc}`,
        level: HEVC_LEVELS[levelIdc] ?? `Level ${levelIdc}`,
      },
    }
  }

  return { raw, family: null, avc: null, hevc: null }
}

export function decodeCodecList(codecs: string): CodecInfo[] {
  return codecs
    .split(',')
    .map(decodeCodec)
    .filter((codec) => codec.raw.length > 0)
}
