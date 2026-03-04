'use client';

import { initTrailboxMvp } from 'trailbox-mvp-sdk-core';

initTrailboxMvp({
  endpoint: process.env.NEXT_PUBLIC_TRAILBOX_MVP_ENDPOINT || 'http://127.0.0.1:7465/ingest',
  appName: process.env.NEXT_PUBLIC_TRAILBOX_MVP_APP_NAME || process.env.npm_package_name || 'next-app',
  captureBodies: true,
  captureHeaders: true,
});
