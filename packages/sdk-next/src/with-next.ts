export interface TrailboxNextOptions {
  appName?: string;
  endpoint?: string;
}

type NextConfigObject = Record<string, unknown>;
type NextConfigFactory = (...args: unknown[]) => NextConfigObject | Promise<NextConfigObject>;
type NextConfigInput = NextConfigObject | NextConfigFactory;

function applyTrailboxConfig(
  config: NextConfigObject,
  options: TrailboxNextOptions
): NextConfigObject {
  const endpoint = options.endpoint || 'http://127.0.0.1:7465/ingest';
  const appName = options.appName || process.env.npm_package_name || 'next-app';

  return {
    ...config,
    env: {
      ...(config.env as Record<string, unknown> | undefined),
      TRAILBOX_MVP_ENDPOINT: endpoint,
      TRAILBOX_MVP_APP_NAME: appName,
      NEXT_PUBLIC_TRAILBOX_MVP_ENDPOINT: endpoint,
      NEXT_PUBLIC_TRAILBOX_MVP_APP_NAME: appName,
    },
    publicRuntimeConfig: {
      ...(config.publicRuntimeConfig as Record<string, unknown> | undefined),
      trailboxMvp: { endpoint, appName },
    },
  };
}

export const withTrailboxMvp =
  (options: TrailboxNextOptions = {}) =>
  (nextConfig: NextConfigInput = {}): NextConfigInput => {
    if (typeof nextConfig === 'function') {
      const factory = nextConfig as NextConfigFactory;
      return async (...args: unknown[]) => {
        const resolved = await factory(...args);
        return applyTrailboxConfig(resolved || {}, options);
      };
    }
    return applyTrailboxConfig(nextConfig as NextConfigObject, options);
  };

export default withTrailboxMvp;
