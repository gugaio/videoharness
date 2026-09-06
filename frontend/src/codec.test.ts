import { describe, expect, it } from 'vitest'
import {
  decodeCodec,
  decodeCodecList,
  describeAvcLevel,
  describeAvcProfile,
  describeHevcLevel,
  describeHevcProfile,
} from './codec'

describe('decodeCodec', () => {
  it('decodifica profile e level da string AVC apresentada ao usuário', () => {
    expect(decodeCodec('avc1.64000d')).toEqual({
      raw: 'avc1.64000d',
      family: 'H.264/AVC',
      avc: {
        prefix: 'avc1',
        profileHex: '64',
        constraintsHex: '00',
        levelHex: '0d',
        profile: 'High',
        level: '1.3',
      },
      hevc: null,
    })
  })

  it.each([
    ['avc1.42001f', 'Baseline', '3.1'],
    ['avc1.4d0028', 'Main', '4'],
    ['avc3.6e0033', 'High 10', '5.1'],
    ['avc1.7a0034', 'High 4:2:2', '5.2'],
  ])('mapeia %s para %s profile e level %s', (codec, profile, level) => {
    const decoded = decodeCodec(codec)
    expect(decoded.avc?.profile).toBe(profile)
    expect(decoded.avc?.level).toBe(level)
  })

  it('preserva codecs ainda não interpretados sem inventar profile ou level', () => {
    expect(decodeCodec('mp4a.40.2')).toEqual({ raw: 'mp4a.40.2', family: null, avc: null, hevc: null })
  })

  it('separa uma lista CODECS sem perder itens desconhecidos', () => {
    expect(decodeCodecList('avc1.64000d, mp4a.40.2').map((codec) => codec.raw)).toEqual([
      'avc1.64000d',
      'mp4a.40.2',
    ])
  })

  it('representa a sinalização especial de level 1b', () => {
    expect(decodeCodec('avc1.42100b').avc?.level).toBe('1b')
  })

  it('explica levels comuns com exemplos de uso sem tratá-los como qualidade', () => {
    expect(describeAvcLevel('3.1')).toContain('1280×720')
    expect(describeAvcLevel('4.1')).toContain('1920×1080')
    expect(describeAvcLevel('4.1')).toContain('bitrate e buffer')
  })

  it('explica profiles comuns pelas ferramentas e pelo uso típico', () => {
    expect(describeAvcProfile('Baseline')).toContain('ampla compatibilidade')
    expect(describeAvcProfile('High')).toContain('streaming HD')
    expect(describeAvcProfile('High 10')).toContain('10 bits')
    expect(describeAvcProfile('High 4:2:2')).toContain('broadcast')
  })

  it.each([
    ['hvc1.2.4.L93.90', 'hvc1', 'Main 10', 'L', '3.1'],
    ['hev1.1.6.H153.B0', 'hev1', 'Main', 'H', '5.1'],
    ['hvc1.A2.4.L150.B0', 'hvc1', 'Main 10', 'L', '5'],
  ])('decodifica %s como HEVC %s Level %s', (codec, prefix, profile, tier, level) => {
    const decoded = decodeCodec(codec)
    expect(decoded.family).toBe('H.265/HEVC')
    expect(decoded.avc).toBeNull()
    expect(decoded.hevc).toMatchObject({ prefix, profile, tier, level })
  })

  it('explica profile e level HEVC sem prometer qualidade', () => {
    expect(describeHevcProfile('Main 10')).toContain('10 bits')
    expect(describeHevcLevel('3.1')).toContain('1280×720')
    expect(describeHevcLevel('5')).toContain('4K')
  })
})
