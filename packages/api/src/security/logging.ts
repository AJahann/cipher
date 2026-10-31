/** Allowlist access-log fields; never serialize headers, bodies or query strings. */
export const securityLogger = {
  serializers: {
    req(req: {
      method?: string;
      url?: string;
      hostname?: string;
      ip?: string;
    }) {
      return {
        method: req.method,
        url: req.url?.split('?')[0],
        hostname: req.hostname,
        remoteAddress: req.ip,
      };
    },
    // Unexpected framework errors may contain SQL parameters or provider data.
    err() {
      return { type: 'InternalError', message: 'Internal failure', stack: '' };
    },
  },
};
