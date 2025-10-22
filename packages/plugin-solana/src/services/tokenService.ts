import { Service, IAgentRuntime, logger } from '@elizaos/core';
import { Connection, PublicKey, Transaction, Keypair, sendAndConfirmTransaction } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import meTokenIdl from '../programs/me_token.json';
import humanConnectionIdl from '../programs/human_connection.json';
import {
  ME_TOKEN_PROGRAM_ID,
  registerAndMintInitial as registerME,
  mintDaily as mintDailyME,
  getUserMeAccount,
  canMintDaily,
  meTokensToUI,
  UserMeAccount,
} from '../programs/me-token';
import {
  HUMAN_CONNECTION_PROGRAM_ID,
  initializeConnection as initHumanConnection,
  unlockWithPin as unlockConnection,
  getConnection,
  generatePIN,
  generateConnectionId,
  isValidPIN,
  getUnlockStatus,
  Connection as HumanConnection,
} from '../programs/human-connection';

/**
 * Token Service for managing $ME and $MEMO tokens
 * Handles registration, minting, connections, and PIN verification
 */
export class TokenService extends Service {
  static serviceType = 'TOKEN';

  capabilityDescription = 'Manages $ME and $MEMO tokens for user connections and rewards';

  private connection: Connection;
  private meTokenProgram: Program | null = null;
  private humanConnectionProgram: Program | null = null;
  private agentWallet: PublicKey | null = null;
  private tokenCache: Map<string, { balance: number; lastFetch: number }> = new Map();

  constructor(runtime: IAgentRuntime) {
    super();
    this.runtime = runtime;

    // Initialize connection
    const rpcUrl = runtime.getSetting('SOLANA_RPC_URL') || 'https://api.devnet.solana.com';
    this.connection = new Connection(rpcUrl);

    // Initialize agent wallet
    const agentWalletStr = runtime.getSetting('AGENT_WALLET');
    if (agentWalletStr) {
      this.agentWallet = new PublicKey(agentWalletStr);
    }

    logger.info('[TokenService] Initialized');
  }

  /**
   * Get or create Anchor programs
   */
  private async getPrograms(): Promise<{ meTokenProgram: Program; humanConnectionProgram: Program }> {
    if (this.meTokenProgram && this.humanConnectionProgram) {
      return {
        meTokenProgram: this.meTokenProgram,
        humanConnectionProgram: this.humanConnectionProgram,
      };
    }

    // Create a dummy wallet for the provider (we'll override signers in transactions)
    const dummyKeypair = Keypair.generate();
    const wallet = new Wallet(dummyKeypair);
    const provider = new AnchorProvider(this.connection, wallet, { commitment: 'confirmed' });

    // Create Program instances with deployed IDLs
    // Program ID comes from the IDL's "address" field
    this.meTokenProgram = new Program(meTokenIdl as any, provider);
    this.humanConnectionProgram = new Program(humanConnectionIdl as any, provider);

    return {
      meTokenProgram: this.meTokenProgram,
      humanConnectionProgram: this.humanConnectionProgram,
    };
  }

  /**
   * Register user and mint initial 48 $ME tokens
   */
  async registerUser(userId: string, payerKeypair: Keypair): Promise<string> {
    try {
      const { meTokenProgram } = await this.getPrograms();

      const tx = await registerME(meTokenProgram, userId, payerKeypair.publicKey);

      const signature = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [payerKeypair],
        { commitment: 'confirmed' }
      );

      logger.info(`[TokenService] Registered user ${userId} with 48 $ME. Tx: ${signature}`);
      return signature;
    } catch (error: any) {
      logger.error(`[TokenService] Error registering user ${userId}: ${error?.message || String(error)}`);
      throw error;
    }
  }

  /**
   * Mint daily $ME tokens (up to 24/day)
   */
  async mintDailyTokens(userId: string, signerKeypair: Keypair): Promise<{ signature: string; amount: number }> {
    try {
      const { meTokenProgram } = await this.getPrograms();

      // Check if user can mint
      const userAccount = await getUserMeAccount(meTokenProgram, userId);
      if (!userAccount) {
        throw new Error(`User ${userId} not registered`);
      }

      const { canMint, availableAmount } = canMintDaily(userAccount);
      if (!canMint) {
        throw new Error(`Daily limit reached for user ${userId}`);
      }

      const tx = await mintDailyME(meTokenProgram, userId);

      const signature = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [signerKeypair],
        { commitment: 'confirmed' }
      );

      logger.info(`[TokenService] Minted ${availableAmount} $ME for ${userId}. Tx: ${signature}`);
      return { signature, amount: availableAmount };
    } catch (error: any) {
      logger.error(`[TokenService] Error minting daily tokens for ${userId}: ${error?.message || String(error)}`);
      throw error;
    }
  }

  /**
   * Get user's ME token balance and account info
   */
  async getUserMEBalance(userId: string): Promise<{
    balance: number;
    dailyAvailable: number;
    totalMinted: number;
  } | null> {
    try {
      const { meTokenProgram } = await this.getPrograms();

      const userAccount = await getUserMeAccount(meTokenProgram, userId);
      if (!userAccount) {
        return null;
      }

      const { availableAmount } = canMintDaily(userAccount);

      return {
        balance: meTokensToUI(userAccount.totalMinted),
        dailyAvailable: availableAmount,
        totalMinted: meTokensToUI(userAccount.totalMinted),
      };
    } catch (error: any) {
      logger.error(`[TokenService] Error getting ME balance for ${userId}: ${error?.message || String(error)}`);
      return null;
    }
  }

  /**
   * Create a human connection between two users
   * Generates PINs and stores them for later submission
   */
  async createHumanConnection(
    userAId: string,
    userBId: string,
    userAPda: PublicKey,
    userBPda: PublicKey,
    userAAuthority: Keypair,
    payerKeypair: Keypair,
    meTokenProgramId: PublicKey = ME_TOKEN_PROGRAM_ID
  ): Promise<{
    connectionId: string;
    pinA: string;
    pinB: string;
    signature: string;
  }> {
    try {
      const { humanConnectionProgram } = await this.getPrograms();

      // Generate unique connection ID and PINs
      const connectionId = generateConnectionId(userAId, userBId);
      const pinA = generatePIN();
      const pinB = generatePIN();

      // Initialize connection on-chain
      const tx = await initHumanConnection(
        humanConnectionProgram,
        connectionId,
        userAId,
        userBId,
        pinA,
        pinB,
        userAPda,
        userBPda,
        userAAuthority.publicKey,
        payerKeypair.publicKey,
        meTokenProgramId
      );

      const signature = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [userAAuthority, payerKeypair],
        { commitment: 'confirmed' }
      );

      logger.info(`[TokenService] Created connection ${connectionId}. Tx: ${signature}`);

      return { connectionId, pinA, pinB, signature };
    } catch (error: any) {
      logger.error(`[TokenService] Error creating connection: ${error?.message || String(error)}`);
      throw error;
    }
  }

  /**
   * Unlock connection with PIN
   * User submits the OTHER person's PIN to unlock their reward
   */
  async submitPin(
    connectionId: string,
    submittedPin: string,
    userPda: PublicKey,
    signerKeypair: Keypair
  ): Promise<{ signature: string; memoReward: number; bothUnlocked: boolean }> {
    try {
      if (!isValidPIN(submittedPin)) {
        throw new Error('Invalid PIN format. Must be 4 digits.');
      }

      if (!this.agentWallet) {
        throw new Error('Agent wallet not configured');
      }

      const { humanConnectionProgram } = await this.getPrograms();

      const tx = await unlockConnection(
        humanConnectionProgram,
        connectionId,
        submittedPin,
        userPda,
        this.agentWallet,
        signerKeypair.publicKey
      );

      const signature = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [signerKeypair],
        { commitment: 'confirmed' }
      );

      // Check connection status after unlock
      const connection = await getConnection(humanConnectionProgram, connectionId);
      const status = connection ? getUnlockStatus(connection) : { bothUnlocked: false };

      logger.info(`[TokenService] PIN submitted for ${connectionId}. Both unlocked: ${status.bothUnlocked}. Tx: ${signature}`);

      return {
        signature,
        memoReward: 8, // Fixed reward amount from contract
        bothUnlocked: status.bothUnlocked,
      };
    } catch (error: any) {
      logger.error(`[TokenService] Error submitting PIN: ${error?.message || String(error)}`);
      throw error;
    }
  }

  /**
   * Get connection status
   */
  async getConnectionStatus(connectionId: string): Promise<{
    exists: boolean;
    userAUnlocked: boolean;
    userBUnlocked: boolean;
    bothUnlocked: boolean;
    createdAt?: Date;
  }> {
    try {
      const { humanConnectionProgram } = await this.getPrograms();

      const connection = await getConnection(humanConnectionProgram, connectionId);
      if (!connection) {
        return {
          exists: false,
          userAUnlocked: false,
          userBUnlocked: false,
          bothUnlocked: false,
        };
      }

      const status = getUnlockStatus(connection);
      return {
        exists: true,
        ...status,
      };
    } catch (error: any) {
      logger.error(`[TokenService] Error getting connection status: ${error?.message || String(error)}`);
      return {
        exists: false,
        userAUnlocked: false,
        userBUnlocked: false,
        bothUnlocked: false,
      };
    }
  }

  /**
   * Start the service
   */
  static async start(runtime: IAgentRuntime): Promise<Service> {
    try {
      const service = new TokenService(runtime);
      logger.info('[TokenService] Service started successfully');
      return service;
    } catch (error) {
      logger.error(`[TokenService] Failed to start service: ${error}`);
      throw error;
    }
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    this.tokenCache.clear();
    logger.info('[TokenService] Service stopped');
  }
}
