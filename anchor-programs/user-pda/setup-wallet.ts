#!/usr/bin/env bun

import * as fs from 'fs';
import * as path from 'path';
import bs58 from 'bs58';

// Load environment variables
// If using Bun, it automatically loads .env files
// For Node.js, you would need to use dotenv package

// Get private key from environment variables
const PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('❌ Error: SOLANA_PRIVATE_KEY not found in environment variables');
  console.error('   Please create a .env file with your SOLANA_PRIVATE_KEY');
  process.exit(1);
}

// Convert base58 private key to byte array
const secretKey = bs58.decode(PRIVATE_KEY);
const secretKeyArray = Array.from(secretKey);

// Create the wallet JSON file
const walletPath = path.join(process.env.HOME || '', '.config', 'solana', 'id.json');
fs.writeFileSync(walletPath, JSON.stringify(secretKeyArray));

console.log(`✅ Wallet file created at: ${walletPath}`);
console.log(`   Public key: C7yJAjCGWrxsZhbj32Zp1zeSUC77ddthxuCPyuK3drBE`);

// Also configure Solana CLI
const solanaConfigPath = path.join(process.env.HOME || '', '.config', 'solana', 'cli', 'config.yml');
const solanaConfig = `---
json_rpc_url: https://api.devnet.solana.com
websocket_url: ''
keypair_path: ${walletPath}
address_labels:
  '11111111111111111111111111111111': System Program
commitment: confirmed
`;

// Create directory if needed
fs.mkdirSync(path.dirname(solanaConfigPath), { recursive: true });
fs.writeFileSync(solanaConfigPath, solanaConfig);

console.log(`✅ Solana CLI config created at: ${solanaConfigPath}`);