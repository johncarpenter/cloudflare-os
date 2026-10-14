import { OrganizationSwitcher } from '@clerk/react'
import { useClerkBridge } from './clerkBridge'

/**
 * Shows the active workspace and lets the user switch between their personal workspace and
 * organizations, create one, invite members and manage them. Clerk supplies all of that; the
 * Workshop reconnects into the new tenant when the active organization changes. Renders nothing on
 * deployments that don't use Clerk.
 */
const WorkspaceSwitcher = () => {
  if (!useClerkBridge()) return null
  return (
    <OrganizationSwitcher
      hidePersonal={false}
      afterSelectOrganizationUrl="/"
      afterSelectPersonalUrl="/"
      afterCreateOrganizationUrl="/"
      afterLeaveOrganizationUrl="/"
    />
  )
}

export default WorkspaceSwitcher
