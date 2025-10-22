import { PublicKey, SystemProgram, Transaction, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { BN, Program, AnchorProvider } from '@coral-xyz/anchor';
import { createHash } from 'crypto';

/**
 * ME Token Program ID - Deployed on Solana Devnet
 */
export const ME_TOKEN_PROGRAM_ID = new PublicKey('CbTbi8L4kmQeHNsCVJUVRH4PCWFYBvHq7vQqPaVd3SB3');

/**
 * Constants from the ME Token program
 */
export const ME_TOKEN_CONSTANTS = {
  INITIAL_MINT: 48,
  DAILY_LIMIT: 24,
  DECIMALS: 9,
  DAY_IN_SECONDS: 86400,
};

/**
 * User ME Account data structure
 */
export interface UserMeAccount {
  userId: string;
  meMint: PublicKey;
  lastMintTime: BN;
  dailyMintedToday: BN;
  totalMinted: BN;
  bump: number;
}

/**
 * Hash userId to fixed 32-byte value for PDA seeds
 * Solana enforces max 32 bytes per seed, so we hash to ensure compliance
 */
function hashUserId(userId: string): Buffer {
  return createHash('sha256').update(userId).digest();
}

/**
 * Derive PDA for user ME account
 */
export function deriveUserMeAccountPDA(userId: string, programId: PublicKey = ME_TOKEN_PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_me'), hashUserId(userId)],
    programId
  );
}

/**
 * Derive PDA for user's personal ME mint
 */
export function deriveMeMintPDA(userId: string, programId: PublicKey = ME_TOKEN_PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('me_mint'), hashUserId(userId)],
    programId
  );
}

/**
 * Derive PDA for user's ME token wallet
 */
export function deriveMeWalletPDA(userId: string, programId: PublicKey = ME_TOKEN_PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('me_wallet'), hashUserId(userId)],
    programId
  );
}

/**
 * Register user and mint initial 48 $ME tokens
 */
export async function registerAndMintInitial(
  program: Program,
  userId: string,
  payer: PublicKey
): Promise<Transaction> {
  const userIdHash = hashUserId(userId);
  const [userMeAccount] = deriveUserMeAccountPDA(userId, program.programId);
  const [meMint] = deriveMeMintPDA(userId, program.programId);
  const [meWallet] = deriveMeWalletPDA(userId, program.programId);

  const tx = await program.methods
    .registerAndMintInitial(userId, Array.from(userIdHash))
    .accounts({
      userMeAccount,
      meMint,
      userMeWallet: meWallet,
      payer,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .transaction();

  return tx;
}

/**
 * Mint daily $ME tokens (up to 24 per day)
 */
export async function mintDaily(
  program: Program,
  userId: string
): Promise<Transaction> {
  const userIdHash = hashUserId(userId);
  const [userMeAccount] = deriveUserMeAccountPDA(userId, program.programId);
  const [meMint] = deriveMeMintPDA(userId, program.programId);
  const [meWallet] = deriveMeWalletPDA(userId, program.programId);

  const tx = await program.methods
    .mintDaily(userId, Array.from(userIdHash))
    .accounts({
      userMeAccount,
      meMint,
      userMeWallet: meWallet,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .transaction();

  return tx;
}

/**
 * Get user ME account data
 */
export async function getUserMeAccount(
  program: Program,
  userId: string
): Promise<UserMeAccount | null> {
  try {
    const [userMeAccountPDA] = deriveUserMeAccountPDA(userId, program.programId);
    const account = await (program.account as any).userMeAccount.fetch(userMeAccountPDA);
    return account as any;
  } catch (error) {
    console.error('Error fetching user ME account:', error);
    return null;
  }
}

/**
 * Check if user can mint daily tokens
 */
export function canMintDaily(account: UserMeAccount): { canMint: boolean; availableAmount: number } {
  const now = Math.floor(Date.now() / 1000);
  const lastMint = account.lastMintTime.toNumber();
  const timeSinceLastMint = now - lastMint;
  const daysPassed = Math.floor(timeSinceLastMint / ME_TOKEN_CONSTANTS.DAY_IN_SECONDS);

  if (daysPassed > 0) {
    // New day, can mint full daily limit
    return {
      canMint: true,
      availableAmount: ME_TOKEN_CONSTANTS.DAILY_LIMIT,
    };
  }

  // Same day, check remaining allowance
  const dailyMinted = account.dailyMintedToday.toNumber();
  const remaining = ME_TOKEN_CONSTANTS.DAILY_LIMIT - dailyMinted;

  return {
    canMint: remaining > 0,
    availableAmount: remaining,
  };
}

/**
 * Convert ME token atomic units to UI amount
 */
export function meTokensToUI(atomicAmount: BN | number): number {
  const amount = typeof atomicAmount === 'number' ? atomicAmount : atomicAmount.toNumber();
  return amount / Math.pow(10, ME_TOKEN_CONSTANTS.DECIMALS);
}

/**
 * Convert UI amount to ME token atomic units
 */
export function uiToMeTokens(uiAmount: number): BN {
  return new BN(uiAmount * Math.pow(10, ME_TOKEN_CONSTANTS.DECIMALS));
}
