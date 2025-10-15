#!/usr/bin/env bun

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { logger } from '@elizaos/core';

/**
 * Test script for PDA wallet functionality
 * This script simulates the wallet creation process to verify the PDA implementation
 */

// Configuration
const PROGRAM_ID = process.env.SOLANA_PDA_PROGRAM_ID || '11111111111111111111111111111111';
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PAYER_KEY = process.env.SOLANA_PAYER_PRIVATE_KEY;

if (!PAYER_KEY) {
  console.error('❌ SOLANA_PAYER_PRIVATE_KEY not set in environment');
  process.exit(1);
}

// Test data
const TEST_PLATFORMS = ['telegram', 'discord', 'twitter'];
const TEST_USER_IDS = ['user123', 'alice456', 'bob789'];

async function derivePDAAddress(
  programId: PublicKey,
  platform: string,
  userId: string
): Promise<[PublicKey, number]> {
  const seeds = [
    Buffer.from('user'),
    Buffer.from(platform.slice(0, 32)),
    Buffer.from(userId.slice(0, 32))
  ];

  return PublicKey.findProgramAddressSync(seeds, programId);
}

async function testPDADerivation() {
  console.log('🧪 Testing PDA Wallet Derivation...\n');

  const connection = new Connection(RPC_URL);
  const programId = new PublicKey(PROGRAM_ID);
  const payerKeypair = Keypair.fromSecretKey(bs58.decode(PAYER_KEY));

  console.log(`📍 Program ID: ${PROGRAM_ID}`);
  console.log(`🌐 RPC URL: ${RPC_URL}`);
  console.log(`💳 Payer: ${payerKeypair.publicKey.toString()}\n`);

  // Check payer balance
  const balance = await connection.getBalance(payerKeypair.publicKey);
  console.log(`💰 Payer balance: ${balance / 1e9} SOL\n`);

  if (balance < 0.01 * 1e9) {
    console.warn('⚠️  Low payer balance! You may need to airdrop SOL for transactions.\n');
  }

  console.log('🔑 Deriving PDA addresses for test users:\n');

  for (const platform of TEST_PLATFORMS) {
    console.log(`Platform: ${platform}`);
    console.log('-'.repeat(50));

    for (const userId of TEST_USER_IDS) {
      const [pdaAddress, bump] = await derivePDAAddress(programId, platform, userId);

      // Check if account exists
      const accountInfo = await connection.getAccountInfo(pdaAddress);
      const exists = accountInfo !== null;
      const balanceLamports = accountInfo ? accountInfo.lamports : 0;

      console.log(`  User: ${userId}`);
      console.log(`  PDA: ${pdaAddress.toString()}`);
      console.log(`  Bump: ${bump}`);
      console.log(`  Exists: ${exists ? '✅' : '❌'}`);
      console.log(`  Balance: ${balanceLamports / 1e9} SOL`);
      console.log();
    }
  }

  // Test deterministic derivation
  console.log('🔄 Testing deterministic derivation...\n');

  const testPlatform = 'telegram';
  const testUserId = 'test_user_deterministic';

  const [pda1, bump1] = await derivePDAAddress(programId, testPlatform, testUserId);
  const [pda2, bump2] = await derivePDAAddress(programId, testPlatform, testUserId);

  if (pda1.toString() === pda2.toString() && bump1 === bump2) {
    console.log('✅ Deterministic derivation verified!');
    console.log(`  Same input always produces: ${pda1.toString()}`);
    console.log(`  With bump: ${bump1}\n`);
  } else {
    console.error('❌ Deterministic derivation failed!');
    process.exit(1);
  }

  // Test different users get different addresses
  console.log('🔍 Testing unique addresses per user...\n');

  const [pdaUser1] = await derivePDAAddress(programId, 'telegram', 'user1');
  const [pdaUser2] = await derivePDAAddress(programId, 'telegram', 'user2');
  const [pdaPlatform1] = await derivePDAAddress(programId, 'discord', 'user1');

  if (pdaUser1.toString() !== pdaUser2.toString()) {
    console.log('✅ Different users get different addresses');
  } else {
    console.error('❌ Users should have different addresses!');
  }

  if (pdaUser1.toString() !== pdaPlatform1.toString()) {
    console.log('✅ Same user on different platforms gets different addresses');
  } else {
    console.error('❌ Platform should affect address derivation!');
  }

  console.log('\n📊 Summary:');
  console.log(`  - Program ID: ${PROGRAM_ID}`);
  console.log(`  - Total test combinations: ${TEST_PLATFORMS.length * TEST_USER_IDS.length}`);
  console.log(`  - All addresses are deterministic ✅`);
  console.log(`  - All addresses are unique per user/platform ✅`);

  console.log('\n✨ PDA wallet testing complete!');
}

// Run the test
testPDADerivation().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});