import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import ipaddr from 'ipaddr.js'
import { load } from 'cheerio'

export function publicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === 'unicast'
  } catch {
    return false
  }
}

/** DNS is checked AND pinned to the socket. Redirects are checked independently. */
export async function fetchPublicWebsite(
  input: string,
  maxBytes = 500_000,
  redirects = 3,
): Promise<{ bytes: Buffer; type: string; url: URL }> {
  const url = new URL(input)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  )
    throw new Error('Only public HTTPS websites are supported.')
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''), {
    all: true,
  })
  if (
    !addresses.length ||
    addresses.some((item) => !publicAddress(item.address))
  )
    throw new Error('Private website addresses are not allowed.')
  const pinned = addresses[0]
  const response = await new Promise<{
    bytes: Buffer
    type: string
    location?: string
    status: number
  }>((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        family: pinned.family,
        headers: {
          'User-Agent': 'BillboardSource-BrandReview/1.0',
          Accept: 'text/html,image/png,image/jpeg,image/webp',
          'Accept-Encoding': 'identity',
        },
        lookup: (_host, _options, callback) =>
          callback(null, pinned.address, pinned.family),
        signal: AbortSignal.timeout(8000),
      },
      (res) => {
        const chunks: Buffer[] = []
        let length = 0
        res.on('data', (chunk) => {
          length += chunk.length
          if (length > maxBytes) {
            req.destroy(new Error('Website response is too large.'))
            return
          }
          chunks.push(chunk)
        })
        res.on('error', reject)
        res.on('end', () =>
          resolve({
            bytes: Buffer.concat(chunks),
            type: String(res.headers['content-type'] || '').split(';')[0],
            location: res.headers.location,
            status: res.statusCode || 500,
          }),
        )
      },
    )
    req.on('error', reject)
    req.end()
  })
  if (
    response.status >= 300 &&
    response.status < 400 &&
    response.location &&
    redirects > 0
  )
    return fetchPublicWebsite(
      new URL(response.location, url).href,
      maxBytes,
      redirects - 1,
    )
  if (response.status !== 200) throw new Error('Website could not be accessed.')
  return { ...response, url }
}

/** Never searches the web. Logo candidates must be explicitly marked on the supplied site. */
export async function reviewWebsite(website: string) {
  if (!website)
    return {
      text: '',
      logo: null,
      fallback:
        'Website skipped. The advertiser name will appear as text; no invented logo.',
    }
  try {
    const page = await fetchPublicWebsite(
      /^https?:\/\//i.test(website) ? website : `https://${website}`,
    )
    if (page.type !== 'text/html') throw new Error('Not an HTML website')
    const $ = load(page.bytes.toString('utf8'))
    const candidates = $('img')
      .toArray()
      .filter((el) =>
        /logo/i.test(
          [
            $(el).attr('alt'),
            $(el).attr('class'),
            $(el).attr('id'),
            $(el).attr('src'),
          ].join(' '),
        ),
      )
      .slice(0, 3)
    const logo = await retrieveLogo(
      candidates.map((el) => $(el).attr('src')),
      page.url,
    )
    const colors = $('meta[name="theme-color"]').attr('content') || ''
    const styles = $('style').text().slice(0, 4000)
    $('script,style,nav,footer,noscript').remove()
    return {
      text: `${$('title').text()}\n${$('meta[name="description"]').attr('content') || ''}\nTheme color: ${colors}\nStyles: ${styles}\n${$('body').text().replace(/\s+/g, ' ').slice(0, 12000)}`,
      logo,
      fallback: logo
        ? ''
        : 'No usable website logo found (only same-site PNG, JPEG, and WebP logos are supported). The advertiser name will appear as text; no invented logo.',
    }
  } catch {
    return {
      text: '',
      logo: null,
      fallback:
        'The website could not be safely reviewed. The advertiser name will appear as text; no invented logo.',
    }
  }
}

async function retrieveLogo(sources: (string | undefined)[], website: URL) {
  for (const src of sources) {
    if (!src) continue
    try {
      const candidate = new URL(src, website)
      // Conservative same-origin policy: site markup cannot become an arbitrary image proxy.
      if (candidate.origin !== website.origin) continue
      const image = await fetchPublicWebsite(candidate.href, 300_000, 0)
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.type))
        continue
      return `data:${image.type};base64,${image.bytes.toString('base64')}`
    } catch {
      /* Try the next logo explicitly identified by this website. */
    }
  }
  return null
}
