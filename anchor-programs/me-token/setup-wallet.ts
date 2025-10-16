import { Keypair } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import bs58 from 'bs58';

// Load environment variables
const SOLANA_PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY || '';

if (!SOLANA_PRIVATE_KEY) {
  console.error('Error: SOLANA_PRIVATE_KEY not found in .env file');
  process.exit(1);
}

try {
  // Decode the base58 private key
  const secretKey = bs58.decode(SOLANA_PRIVATE_KEY);

  // Create keypair from secret key
  const keypair = Keypair.fromSecretKey(secretKey);

  // Prepare the keypair data in the format Solana CLI expects
  const keypairData = Array.from(keypair.secretKey);

  // Ensure .config/solana directory exists
  const solanaDir = path.join(process.env.HOME || '', '.config', 'solana');
  if (!fs.existsSync(solanaDir)) {
    fs.mkdirSync(solanaDir, { recursive: true });
  }

  // Write keypair to id.json
  const keypairPath = path.join(solanaDir, 'id.json');
  fs.writeFileSync(keypairPath, JSON.stringify(keypairData));

  console.log('✅ Wallet setup complete!');
  console.log('📍 Keypair saved to:', keypairPath);
  console.log('🔑 Public Key:', keypair.publicKey.toString());
  console.log('\nYou can now use this wallet with Solana CLI and Anchor commands.');

} catch (error) {
  console.error('Error setting up wallet:', error);
  process.exit(1);
}
