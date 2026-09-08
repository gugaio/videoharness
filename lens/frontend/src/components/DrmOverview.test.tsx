import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { UnifiedMedia } from '../types'
import { DrmOverview } from './DrmOverview'

const media: UnifiedMedia = {
  protocol: 'DASH',
  kind: 'dash_mpd',
  is_live: false,
  track_groups: [],
  drm_systems: [{ system: 'widevine', details: null }],
  dash_drm: [{
    scope: 'adaptation_set',
    period_index: 0,
    period_id: 'p0',
    adaptation_set_id: 'video',
    representation_id: null,
    group_kind: 'video',
    system: 'widevine',
    scheme_id_uri: 'urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed',
    value: 'cenc',
    default_kids: ['11111111-2222-3333-4444-555555555555'],
    pssh: [{
      encoded_length: 12,
      decoded_size: 9,
      sha256: '1234567890abcdef',
      status: 'valid',
    }],
    provenance: 'declared (DASH ContentProtection)',
  }],
  protocol_specific: { dash: {} },
  capabilities: {},
  warnings: [],
}

describe('DrmOverview', () => {
  it('explica e mostra as declarações DRM do DASH', () => {
    render(<DrmOverview media={media} />)

    expect(screen.getByRole('heading', { name: 'DRM declarado no MPD' })).toBeInTheDocument()
    expect(screen.getAllByText('Widevine')).toHaveLength(2)
    expect(screen.getByText('AdaptationSet video')).toBeInTheDocument()
    expect(screen.getByText('11111111-2222-3333-4444-555555555555')).toBeInTheDocument()
    expect(screen.getByText(/9 B · hash 1234567890ab/)).toBeInTheDocument()
    expect(screen.getByRole('tooltip', { name: /não é a chave de descriptografia/i })).toBeInTheDocument()
  })

  it('não cria painel para HLS, mesmo com o campo legado', () => {
    render(<DrmOverview media={{ ...media, protocol: 'HLS', dash_drm: undefined }} />)
    expect(screen.queryByRole('heading', { name: 'DRM declarado no MPD' })).not.toBeInTheDocument()
  })
})
