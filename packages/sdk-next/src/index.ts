import { initTrailboxMvp } from '@trailbox-mvp/sdk-core';
import { withTrailboxMvp } from './with-next.js';

export interface TrailboxNextOptions {
  appName?: string;
  endpoint?: string;
}

export const registerTrailboxMvp = (options: TrailboxNextOptions = {}): void => {
  initTrailboxMvp({
    endpoint: options.endpoint || 'http://127.0.0.1:7465/ingest',
    appName: options.appName || 'next-app',
  });
};

export { withTrailboxMvp };
export default withTrailboxMvp;
