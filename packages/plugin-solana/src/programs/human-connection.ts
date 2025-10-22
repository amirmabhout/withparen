import { PublicKey, SystemProgram, Transaction, SYSVAR_RENT_PUBKEY, Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { BN, Program } from '@coral-xyz/anchor';
import { createHash } from 'crypto';
import { deriveMeMintPDA, deriveMeWalletPDA } from './me-token';

/**
 * HumanConnection Program ID - Deployed on Solana Devnet
 */
export const HUMAN_CONNECTION_PROGRAM_ID = new PublicKey('FhdroQrark3WFM6aSG1PpESmCXee4uvMxmYvRKD9FfTN');

/**
 * Constants from the HumanConnection program
 */
export const HUMAN_CONNECTION_CONSTANTS = {
  ME_LOCK_AMOUNT: 24,
  MEMO_REWARD_AMOUNT: 8,
  MEMO_DECIMALS: 9,
  ME_DECIMALS: 9,
};

/**
 * Connection data structure
 */
export interface Connection {
  connectionId: string;
  userA: PublicKey;
  userB: PublicKey;
  userAId: string;
  userBId: string;
  pinAHash: number[];
  pinBHash: number[];
  userAUnlocked: boolean;
  userBUnlocked: boolean;
  createdAt: BN;
  bump: number;
}

/**
 * Generate a random 4-digit PIN
 */
export function generatePIN(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * Hash a PIN using SHA256
 */
export function hashPIN(pin: string): number[] {
  const hash = createHash('sha256').update(pin).digest();
  return Array.from(hash);
}

/**
 * Hash connectionId to fixed 32-byte value for PDA seeds
 * Solana enforces max 32 bytes per seed, so we hash to ensure compliance
 */
function hashConnectionId(connectionId: string): Buffer {
  return createHash('sha256').update(connectionId).digest();
}

/**
 * Derive connection PDA
 */
export function deriveConnectionPDA(
  connectionId: string,
  programId: PublicKey = HUMAN_CONNECTION_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('connection'), hashConnectionId(connectionId)],
    programId
  );
}

/**
 * Derive escrow ME wallet PDA
 */
export function deriveEscrowMeWalletPDA(
  connectionId: string,
  programId: PublicKey = HUMAN_CONNECTION_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), hashConnectionId(connectionId)],
    programId
  );
}

/**
 * Derive global MEMO mint PDA
 */
export function deriveMemoMintPDA(
  programId: PublicKey = HUMAN_CONNECTION_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('memo_mint')],
    programId
  );
}

/**
 * Derive user MEMO wallet PDA
 */
export function deriveMemoWalletPDA(
  userPda: PublicKey,
  programId: PublicKey = HUMAN_CONNECTION_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('memo_wallet'), userPda.toBuffer()],
    programId
  );
}

/**
 * Initialize a connection between two users
 */
export async function initializeConnection(
  program: Program,
  connectionId: string,
  userAId: string,
  userBId: string,
  pinA: string,
  pinB: string,
  userAPda: PublicKey,
  userBPda: PublicKey,
  userAAuthority: PublicKey,
  payer: PublicKey,
  meTokenProgramId: PublicKey
): Promise<Transaction> {
  // Hash the PINs
  const pinAHash = hashPIN(pinA);
  const pinBHash = hashPIN(pinB);
  const connectionIdHash = hashConnectionId(connectionId);

  // Derive PDAs
  const [connection] = deriveConnectionPDA(connectionId, program.programId);
  const [escrowMeWallet] = deriveEscrowMeWalletPDA(connectionId, program.programId);
  const [userAMeMint] = deriveMeMintPDA(userAId, meTokenProgramId);
  const [userAMeWallet] = deriveMeWalletPDA(userAId, meTokenProgramId);

  const tx = await program.methods
    .initializeConnection(
      connectionId,
      Array.from(connectionIdHash),
      userAId,
      userBId,
      pinAHash,
      pinBHash
    )
    .accounts({
      connection,
      userAPda,
      userBPda,
      userAMeWallet,
      escrowMeWallet,
      userAMeMint,
      userAAuthority,
      payer,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .transaction();

  return tx;
}

/**
 * Unlock connection with PIN
 */
export async function unlockWithPin(
  program: Program,
  connectionId: string,
  submittedPin: string,
  userPda: PublicKey,
  agentWallet: PublicKey,
  payer: PublicKey
): Promise<Transaction> {
  const connectionIdHash = hashConnectionId(connectionId);
  const [connection] = deriveConnectionPDA(connectionId, program.programId);
  const [memoMint] = deriveMemoMintPDA(program.programId);
  const [userMemoWallet] = deriveMemoWalletPDA(userPda, program.programId);

  // For agent memo wallet, we use the agent's regular wallet (not PDA-derived)
  // This account will be init_if_needed in the program
  const agentMemoWallet = getAssociatedTokenAddressSync(memoMint, agentWallet);

  const tx = await program.methods
    .unlockWithPin(connectionId, Array.from(connectionIdHash), submittedPin)
    .accounts({
      connection,
      userPda,
      userMemoWallet,
      agentMemoWallet,
      memoMint,
      agent: agentWallet,
      payer,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .transaction();

  return tx;
}

/**
 * Get connection data
 */
export async function getConnection(
  program: Program,
  connectionId: string
): Promise<Connection | null> {
  try {
    const [connectionPDA] = deriveConnectionPDA(connectionId, program.programId);
    const account = await (program.account as any).connection.fetch(connectionPDA);
    return account as any;
  } catch (error) {
    console.error('Error fetching connection:', error);
    return null;
  }
}

/**
 * Check connection unlock status
 */
export interface UnlockStatus {
  userAUnlocked: boolean;
  userBUnlocked: boolean;
  bothUnlocked: boolean;
  createdAt: Date;
}

export function getUnlockStatus(connection: Connection): UnlockStatus {
  return {
    userAUnlocked: connection.userAUnlocked,
    userBUnlocked: connection.userBUnlocked,
    bothUnlocked: connection.userAUnlocked && connection.userBUnlocked,
    createdAt: new Date(connection.createdAt.toNumber() * 1000),
  };
}

/**
 * Generate unique connection ID
 */
export function generateConnectionId(userAId: string, userBId: string): string {
  const timestamp = Date.now();
  return `${userAId}-${userBId}-${timestamp}`;
}

/**
 * Convert MEMO token atomic units to UI amount
 */
export function memoTokensToUI(atomicAmount: BN | number): number {
  const amount = typeof atomicAmount === 'number' ? atomicAmount : atomicAmount.toNumber();
  return amount / Math.pow(10, HUMAN_CONNECTION_CONSTANTS.MEMO_DECIMALS);
}

/**
 * Convert UI amount to MEMO token atomic units
 */
export function uiToMemoTokens(uiAmount: number): BN {
  return new BN(uiAmount * Math.pow(10, HUMAN_CONNECTION_CONSTANTS.MEMO_DECIMALS));
}

/**
 * Verify PIN format (4 digits)
 */
export function isValidPIN(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}
