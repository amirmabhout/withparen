#!/usr/bin/env bun
/**
 * Build script for @elizaos/plugin-telegram using standardized build utilities
 */

import { createBuildRunner } from '../../build-utils';

// Create and run the standardized build runner
const run = createBuildRunner({
  packageName: '@elizaos/plugin-telegram',
  buildOptions: {
    entrypoints: ['src/index.ts'],
    outdir: 'dist',
    target: 'node',
    format: 'esm',
    external: [
      'dotenv',
      'fs',
      'path',
      '@reflink/reflink',
      '@node-llama-cpp',
      'agentkeepalive',
      'zod',
      '@elizaos/core',
      '@telegraf/types',
      'telegraf',
      'strip-literal',
      'type-detect',
    ],
    sourcemap: true,
    minify: false,
    generateDts: true,
  },
});

// Execute the build
run().catch((error) => {
  console.error('Build script error:', error);
  process.exit(1);
});