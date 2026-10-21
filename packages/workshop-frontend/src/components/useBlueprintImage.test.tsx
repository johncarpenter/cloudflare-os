// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { useBlueprintImage } from './useBlueprintImage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Image = { bytes: Uint8Array; contentType: 'image/png' | 'image/jpeg' } | null

function api(getBlueprintScreenshot: (id: string) => Promise<Image>): RpcStub<AuthenticatedApi> {
  return { getBlueprintScreenshot } as unknown as RpcStub<AuthenticatedApi>
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('useBlueprintImage', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined
  const created: string[] = []
  const revoked: string[] = []

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    created.length = 0
    revoked.length = 0
    vi.restoreAllMocks()
  })

  function mount() {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const url = `blob:image-${created.length}`
      created.push(url)
      return url
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => { revoked.push(url) })
    let seen: string | undefined
    function Probe({ args }: { args: Parameters<typeof useBlueprintImage> }) {
      seen = useBlueprintImage(...args)
      return null
    }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    return {
      render: (...props: Parameters<typeof useBlueprintImage>) =>
        act(async () => root!.render(<Probe args={props} />)),
      seen: () => seen,
    }
  }

  it('uses a public address as it is, without a request', async () => {
    const getBlueprintScreenshot = vi.fn<(id: string) => Promise<Image>>()
    const probe = mount()
    await probe.render({ id: 'b1', screenshotUrl: '/blueprint-screenshot/b1', hasScreenshot: true }, api(getBlueprintScreenshot))
    expect(probe.seen()).toBe('/blueprint-screenshot/b1')
    expect(getBlueprintScreenshot).not.toHaveBeenCalled()
  })

  it('fetches a private image over the connection and shows it from a blob URL', async () => {
    const getBlueprintScreenshot = vi.fn<(id: string) => Promise<Image>>(
      async () => ({ bytes: new Uint8Array([1, 2]), contentType: 'image/png' }))
    const probe = mount()
    await probe.render({ id: 'b1', hasScreenshot: true }, api(getBlueprintScreenshot))
    expect(getBlueprintScreenshot).toHaveBeenCalledWith('b1')
    expect(probe.seen()).toBe('blob:image-0')
  })

  it('makes no request for a blueprint without an image, or before there is a connection', async () => {
    const getBlueprintScreenshot = vi.fn<(id: string) => Promise<Image>>()
    const probe = mount()
    await probe.render({ id: 'b1', hasScreenshot: false }, api(getBlueprintScreenshot))
    await probe.render({ id: 'b1', hasScreenshot: true }, null)
    expect(getBlueprintScreenshot).not.toHaveBeenCalled()
    expect(probe.seen()).toBeUndefined()
  })

  it('never shows one blueprint image for the next, and releases it', async () => {
    const next = deferred<Image>()
    const connection = api(async (id) => id === 'b1'
      ? { bytes: new Uint8Array([1]), contentType: 'image/png' }
      : next.promise)
    const probe = mount()
    await probe.render({ id: 'b1', hasScreenshot: true }, connection)
    expect(probe.seen()).toBe('blob:image-0')

    await probe.render({ id: 'b2', hasScreenshot: true }, connection)
    expect(probe.seen()).toBeUndefined()
    expect(revoked).toEqual(['blob:image-0'])

    await act(async () => next.resolve({ bytes: new Uint8Array([2]), contentType: 'image/jpeg' }))
    expect(probe.seen()).toBe('blob:image-1')
  })

  it('releases the image when the component goes away, and drops one that arrives after', async () => {
    const late = deferred<Image>()
    const probe = mount()
    await probe.render({ id: 'b1', hasScreenshot: true }, api(() => late.promise))
    act(() => root!.unmount())
    root = undefined
    await act(async () => late.resolve({ bytes: new Uint8Array([1]), contentType: 'image/png' }))
    expect(created).toEqual([])
  })

  it('shows nothing when the server has no image to give', async () => {
    const probe = mount()
    await probe.render({ id: 'b1', hasScreenshot: true }, api(async () => null))
    expect(probe.seen()).toBeUndefined()
  })
})
