import { env } from '../../config/env';

export function getApiOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return env.NEXT_PUBLIC_API_URL;
}
