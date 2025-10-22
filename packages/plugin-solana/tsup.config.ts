import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  tsconfig: './tsconfig.build.json', // Use build-specific tsconfig
  sourcemap: true,
  clean: true,
  strict: true,
  format: ['esm'], // Ensure you're targeting CommonJS
  dts: true,
  external: [
    'dotenv', // Externalize dotenv to prevent bundling
    'fs', // Externalize fs to use Node.js built-in module
    'path', // Externalize other built-ins if necessary
    '@reflink/reflink',
    '@node-llama-cpp',
    'https',
    'http',
    'agentkeepalive',
    'safe-buffer',
    'base-x',
    'bs58',
    'borsh',
    '@solana/buffer-layout',
    'stream',
    'buffer',
    'querystring',
    '@elizaos/core',
    'zod',
    '@coral-xyz/anchor', // Externalize Anchor to prevent bundling
    '@solana/web3.js', // Externalize Solana web3 library
    '@solana/spl-token', // Externalize Solana SPL token library
  ],
});
