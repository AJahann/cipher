export function isOriginAllowed(
  origin: string,
  allowedOrigins: string[],
  host?: string,
): boolean {
  if (allowedOrigins.includes(origin)) return true;
  try {
    const url = new URL(origin);
    if (
      url.hostname.endsWith('.lhr.life') ||
      url.hostname.endsWith('.trycloudflare.com') ||
      url.hostname.endsWith('.ngrok-free.dev')
    ) {
      return true;
    }
    if (host) {
      const cleanHost = host.split(',')[0].trim();
      if (url.host === cleanHost || url.hostname === cleanHost) {
        return true;
      }
    }
  } catch (_error) {
    // Malformed origin
  }
  return false;
}
