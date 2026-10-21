import { useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'

type Loaded = { id: string; api: unknown; url: string }

/**
 * The address to show a blueprint's screenshot from, or undefined while there is none.
 *
 * A bundled blueprint's image has a public URL. In a deployment with organizations a published
 * blueprint's does not (an `<img>` request carries no sign-in, and a public cache would keep the
 * image), so the bytes are fetched over the signed-in connection and shown from a blob URL that is
 * revoked when it is replaced or the component goes away.
 */
export function useBlueprintImage(
  blueprint: { id: string; screenshotUrl?: string; hasScreenshot?: boolean } | null,
  api: RpcStub<AuthenticatedApi> | null | undefined,
): string | undefined {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const id = blueprint?.id
  const needsFetch = !blueprint?.screenshotUrl && blueprint?.hasScreenshot === true

  useEffect(() => {
    if (!id || !needsFetch || !api) return
    let cancelled = false
    let url: string | undefined
    api.getBlueprintScreenshot(id).then((image) => {
      if (cancelled || !image) return
      url = URL.createObjectURL(new Blob([image.bytes as BlobPart], { type: image.contentType }))
      setLoaded({ id, api, url })
    }).catch(() => {})
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [id, needsFetch, api])

  if (blueprint?.screenshotUrl) return blueprint.screenshotUrl
  return loaded && loaded.id === id && loaded.api === api ? loaded.url : undefined
}
