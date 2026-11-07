import { env } from '../../config/env';

export function getApiOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    if (window.location.port === '3000') {
      return env.NEXT_PUBLIC_API_URL;
    }
    return window.location.origin;
  }
  return env.NEXT_PUBLIC_API_URL;
}
