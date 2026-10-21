import { createFileRoute } from '@tanstack/react-router'
import BrandingSettings from '../branding/BrandingSettings'

export const Route = createFileRoute('/organization')({
  component: BrandingSettings,
})
