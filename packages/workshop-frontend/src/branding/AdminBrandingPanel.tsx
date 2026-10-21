import { useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import { Button, Switch, useKumoToastManager } from '@cloudflare/kumo'
import { PaintBrush } from '@phosphor-icons/react'
import type { AdminApi, TenantBrandingSummary } from '@gadgets/workshop-shared/api'

/**
 * The operator's control of organization branding: whether organizations may brand their own
 * workspace, and which have, with a way to clear one (for an organization that brands itself
 * inappropriately, whose administrators are not around to fix it).
 */
const AdminBrandingPanel = ({
  admin,
  enabled,
  onEnabledChange,
}: {
  admin: RpcStub<AdminApi>
  enabled: boolean
  /** Called with the new setting once the server has accepted it. */
  onEnabledChange: (enabled: boolean) => void
}) => {
  const toasts = useKumoToastManager()
  const [organizations, setOrganizations] = useState<TenantBrandingSummary[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = () => admin.listTenantBranding().then(setOrganizations)

  useEffect(() => {
    let cancelled = false
    admin.listTenantBranding().then(
      (list) => { if (!cancelled) setOrganizations(list) },
      () => { if (!cancelled) setFailed(true) },
    )
    return () => { cancelled = true }
  }, [admin])

  const run = async (key: string, action: () => Promise<void>, failure: string) => {
    setBusy(key)
    try {
      await action()
    } catch (error) {
      toasts.add({ title: error instanceof Error ? error.message : failure, variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const toggle = (next: boolean) => run('switch', async () => {
    await admin.setTenantBrandingEnabled(next)
    onEnabledChange(next)
  }, 'Update failed')

  const clear = (tenantId: string) => run(tenantId, async () => {
    await admin.clearTenantBranding(tenantId)
    await load()
    toasts.add({ title: 'Organization branding cleared', variant: 'success' })
  }, 'Failed to clear branding')

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-kumo-line bg-kumo-elevated p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-kumo-tint">
            <PaintBrush size={18} className="text-kumo-subtle" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-kumo-strong">Organization branding</h2>
            <p className="mt-0.5 text-sm text-kumo-subtle">
              Let each organization&rsquo;s administrators set its own name, logo and accent color. When
              off, everyone sees the deployment&rsquo;s branding; what organizations saved is kept.
            </p>
          </div>
          <Switch
            aria-label="Allow organization branding"
            checked={enabled}
            disabled={busy === 'switch'}
            onCheckedChange={toggle}
          />
        </div>
      </div>

      <div className="rounded-xl border border-kumo-line bg-kumo-elevated p-6">
        <h2 className="mb-1 text-lg font-semibold text-kumo-strong">Organizations with branding</h2>
        <p className="mb-4 text-sm text-kumo-subtle">Most recently changed first.</p>
        {failed && <p className="text-sm text-kumo-danger">Failed to load organizations.</p>}
        {!failed && organizations === null && <p className="text-sm text-kumo-subtle">Loading...</p>}
        {organizations?.length === 0 && <p className="text-sm text-kumo-subtle">No organization has set branding.</p>}
        {organizations && organizations.length > 0 && (
          <ul className="divide-y divide-kumo-line">
            {organizations.map((organization) => (
              <li key={organization.tenantId} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm text-kumo-default">{organization.tenantId}</p>
                  <p className="text-xs text-kumo-subtle">
                    Changed {organization.updatedAt.toLocaleString()}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy === organization.tenantId}
                  disabled={busy !== null}
                  onClick={() => clear(organization.tenantId)}
                >
                  Clear branding
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default AdminBrandingPanel
