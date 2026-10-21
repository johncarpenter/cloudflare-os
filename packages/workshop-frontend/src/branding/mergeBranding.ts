import type { EffectiveBranding, ServerConfig } from '@gadgets/workshop-shared/api'

/**
 * The deployment's config with the organization's branding over it: a part the organization has not
 * set keeps the deployment's value. Returns `config` itself when there is nothing to apply.
 */
export function mergeBranding(
  config: ServerConfig | null,
  branding: EffectiveBranding | null,
): ServerConfig | null {
  if (!config || !branding) return config
  return {
    ...config,
    ...(branding.siteName !== undefined && { siteName: branding.siteName }),
    ...(branding.siteLogo !== undefined && { siteLogo: branding.siteLogo }),
    ...(branding.accentColor !== undefined && { accentColor: branding.accentColor }),
  }
}
