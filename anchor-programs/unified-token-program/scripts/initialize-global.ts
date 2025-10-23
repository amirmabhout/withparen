import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as borsh from 'borsh';

const PROGRAM_ID = new PublicKey('GXnod1W71vzjuFkXHxwQ2dkBe7t1auJMtwMQYL67ytVt');
const RPC_URL = 'https://api.devnet.solana.com';

async function main() {
  console.log('Initializing Unified Token Program Global State...\n');

  // Load wallet
  const walletPath = path.join(process.env.HOME!, '.config/solana/id.json');
  const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const adminKeypair = Keypair.fromSecretKey(Uint8Array.from(walletData));

  console.log('Admin:', adminKeypair.publicKey.toString());

  // Setup connection
  const connection = new Connection(RPC_URL, 'confirmed');

  // Derive PDAs
  const [globalState] = PublicKey.findProgramAddressSync(
    [Buffer.from('global_state')],
    PROGRAM_ID
  );

  const [memoMint] = PublicKey.findProgramAddressSync(
    [Buffer.from('memo_mint')],
    PROGRAM_ID
  );

  const [meEscrow] = PublicKey.findProgramAddressSync(
    [Buffer.from('me_escrow')],
    PROGRAM_ID
  );

  console.log('\nPDAs:');
  console.log('  Global State:', globalState.toString());
  console.log('  MEMO Mint:', memoMint.toString());
  console.log('  ME Escrow:', meEscrow.toString());

  // Check if already initialized
  try {
    const accountInfo = await connection.getAccountInfo(globalState);
    if (accountInfo) {
      console.log('\n⚠️  Global state already initialized!');
      console.log('   Skipping initialization...');
      return;
    }
  } catch (err) {
    // Not initialized, continue
  }

  console.log('\nInitializing global state...');

  try {
    // Build instruction manually
    // Instruction discriminator for initialize_global (first 8 bytes of sha256("global:initialize_global"))
    const discriminator = Buffer.from([0x2f, 0xe1, 0x0f, 0x70, 0x56, 0x33, 0xbe, 0xe7]);

    // No additional data needed for initialize_global
    const data = discriminator;

    const keys = [
      { pubkey: globalState, isSigner: false, isWritable: true },
      { pubkey: memoMint, isSigner: false, isWritable: true },
      { pubkey: meEscrow, isSigner: false, isWritable: true },
      { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ];

    const instruction = new TransactionInstruction({
      keys,
      programId: PROGRAM_ID,
      data,
    });

    const transaction = new Transaction().add(instruction);
    transaction.feePayer = adminKeypair.publicKey;

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;

    transaction.sign(adminKeypair);

    const tx = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    await connection.confirmTransaction(tx, 'confirmed');

    console.log('\n✓ Global state initialized successfully!');
    console.log('  Transaction:', tx);
    console.log('  Explorer: https://explorer.solana.com/tx/' + tx + '?cluster=devnet');
    console.log('\nGlobal State Account:', globalState.toString());
    console.log('MEMO Mint:', memoMint.toString());
    console.log('ME Escrow:', meEscrow.toString());
  } catch (error: any) {
    console.error('\n✗ Error initializing global state:', error?.message || String(error));
    if (error?.logs) {
      console.error('\nTransaction logs:');
      error.logs.forEach((log: string) => console.error('  ', log));
    }
    process.exit(1);
  }
}

main().catch(console.error);
