import { describe, expect, it } from 'vitest'
import type { ServerConfig } from '@gadgets/workshop-shared/api'
import { mergeBranding } from './mergeBranding'

const DEPLOYMENT = {
  siteName: 'Deployment',
  siteLogo: { url: '/api/site-logo' },
  accentColor: '#111111',
  authVendors: [],
} as unknown as ServerConfig

describe('mergeBranding', () => {
  it('lets each part the organization set replace the deployment value', () => {
    const merged = mergeBranding(DEPLOYMENT, {
      siteName: 'Acme',
      siteLogo: { url: 'data:image/png;base64,AA==' },
      accentColor: '#222222',
    })
    expect(merged).toMatchObject({
      siteName: 'Acme', siteLogo: { url: 'data:image/png;base64,AA==' }, accentColor: '#222222',
    })
  })

  it('keeps the deployment value for every part the organization did not set', () => {
    const merged = mergeBranding(DEPLOYMENT, { siteName: 'Acme' })
    expect(merged).toMatchObject({
      siteName: 'Acme', siteLogo: { url: '/api/site-logo' }, accentColor: '#111111',
    })
  })

  it('leaves everything else in the deployment config alone', () => {
    expect(mergeBranding(DEPLOYMENT, { siteName: 'Acme' })?.authVendors).toEqual([])
  })

  it('returns the deployment config itself when there is no branding, or no config yet', () => {
    expect(mergeBranding(DEPLOYMENT, null)).toBe(DEPLOYMENT)
    expect(mergeBranding(null, { siteName: 'Acme' })).toBeNull()
  })
})
