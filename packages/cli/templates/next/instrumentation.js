import { initTrailboxMvp } from '@trailbox-mvp/sdk-core';

export function register() {
  initTrailboxMvp({
    endpoint: process.env.TRAILBOX_MVP_ENDPOINT || 'http://127.0.0.1:7465/ingest',
    appName: process.env.npm_package_name || 'next-app',
  });
}

