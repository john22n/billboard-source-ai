import { createPublicConfig } from './config-core'

export type { PublicConfig } from './config-core'

export const publicConfig = createPublicConfig({
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_GOOGLE_MAP_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAP_KEY,
  NEXT_PUBLIC_AUTO_LOGOUT_EXCLUDED_EMAILS:
    process.env.NEXT_PUBLIC_AUTO_LOGOUT_EXCLUDED_EMAILS,
})
