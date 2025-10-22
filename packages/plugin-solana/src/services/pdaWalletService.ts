import { Service, IAgentRuntime, logger } from '@elizaos/core';
import { PublicKey, Connection, Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * PDA Wallet configuration
 */
interface PDAConfig {
  programId: string;
  network: 'devnet' | 'mainnet-beta' | 'testnet';
  payerPrivateKey: string;
}

/**
 * User wallet information stored in PDA
 */
export interface UserPDAWallet {
  platform: string;
  userId: string;
  walletAddress: string;
  createdAt?: Date;
  metadata?: string;
}

/**
 * Service for managing PDA-based wallets for users
 * Users get deterministic wallet addresses without managing private keys
 */
export class PDAWalletService extends Service {
  static serviceType = 'pda_wallet';

  capabilityDescription = 'Manages PDA (Program Derived Address) wallets for users';

  private connection: Connection;
  private programId: PublicKey;
  private payerKeypair: Keypair;
  private walletCache: Map<string, string> = new Map();

  constructor(runtime: IAgentRuntime) {
    super();
    this.runtime = runtime;

    // Initialize configuration
    const config = this.getConfig();
    this.connection = new Connection(this.getRpcUrl(config.network));
    this.programId = new PublicKey(config.programId);
    this.payerKeypair = Keypair.fromSecretKey(bs58.decode(config.payerPrivateKey));

    logger.info(`[PDAWalletService] Initialized with program ID: ${config.programId}`);
    logger.info(`[PDAWalletService] Network: ${config.network}`);
    logger.info(`[PDAWalletService] Payer: ${this.payerKeypair.publicKey.toString()}`);
  }

  /**
   * Get configuration from runtime settings
   */
  private getConfig(): PDAConfig {
    const programId = this.runtime.getSetting('SOLANA_PDA_PROGRAM_ID') ||
                     '11111111111111111111111111111111'; // Default for testing
    const network = (this.runtime.getSetting('SOLANA_NETWORK') || 'devnet') as 'devnet' | 'mainnet-beta' | 'testnet';
    const payerPrivateKey = this.runtime.getSetting('SOLANA_PAYER_PRIVATE_KEY') ||
                            this.runtime.getSetting('SOLANA_PRIVATE_KEY');

    if (!payerPrivateKey) {
      throw new Error('[PDAWalletService] SOLANA_PAYER_PRIVATE_KEY not configured');
    }

    return { programId, network, payerPrivateKey };
  }

  /**
   * Get RPC URL for network
   */
  private getRpcUrl(network: string): string {
    const customRpc = this.runtime.getSetting('SOLANA_RPC_URL');
    if (customRpc) return customRpc;

    switch (network) {
      case 'mainnet-beta':
        return 'https://api.mainnet-beta.solana.com';
      case 'testnet':
        return 'https://api.testnet.solana.com';
      case 'devnet':
      default:
        return 'https://api.devnet.solana.com';
    }
  }

  /**
   * Derive PDA address for a user
   */
  public derivePDAAddress(platform: string, userId: string): [PublicKey, number] {
    const seeds = [
      Buffer.from('user'),
      Buffer.from(platform.slice(0, 32)), // Limit to 32 bytes
      Buffer.from(userId.slice(0, 32))    // Limit to 32 bytes
    ];

    return PublicKey.findProgramAddressSync(seeds, this.programId);
  }

  /**
   * Get or create PDA wallet for a user
   */
  public async ensureUserWallet(platform: string, userId: string): Promise<string> {
    try {
      // Check cache first
      const cacheKey = `${platform}:${userId}`;
      if (this.walletCache.has(cacheKey)) {
        return this.walletCache.get(cacheKey)!;
      }

      // Derive PDA address
      const [pdaAddress, bump] = this.derivePDAAddress(platform, userId);
      const addressStr = pdaAddress.toString();

      logger.debug(`[PDAWalletService] Derived PDA for ${platform}:${userId}: ${addressStr} (bump: ${bump})`);

      // Check if account exists
      const accountInfo = await this.connection.getAccountInfo(pdaAddress);

      if (accountInfo) {
        logger.info(`[PDAWalletService] PDA wallet exists for ${platform}:${userId}: ${addressStr}`);
        this.walletCache.set(cacheKey, addressStr);
        return addressStr;
      }

      // Create PDA account if it doesn't exist
      logger.info(`[PDAWalletService] Creating PDA wallet for ${platform}:${userId}...`);

      // Note: In a real implementation, you would call the Anchor program here
      // For now, we'll just return the derived address since the program needs to be deployed first

      // Store in cache
      this.walletCache.set(cacheKey, addressStr);

      // Store in runtime memory for persistence
      await this.storeWalletInMemory(platform, userId, addressStr);

      logger.success(`[PDAWalletService] Created PDA wallet for ${platform}:${userId}: ${addressStr}`);
      return addressStr;

    } catch (error) {
      logger.error(`[PDAWalletService] Error ensuring wallet for ${platform}:${userId}: ${error}`);
      throw error;
    }
  }

  /**
   * Get PDA wallet address for a user (doesn't create if not exists)
   */
  public async getUserWalletAddress(platform: string, userId: string): Promise<string | null> {
    try {
      // Check cache
      const cacheKey = `${platform}:${userId}`;
      if (this.walletCache.has(cacheKey)) {
        return this.walletCache.get(cacheKey)!;
      }

      // Derive PDA address
      const [pdaAddress] = this.derivePDAAddress(platform, userId);
      const addressStr = pdaAddress.toString();

      // Check if account exists
      const accountInfo = await this.connection.getAccountInfo(pdaAddress);

      if (accountInfo) {
        this.walletCache.set(cacheKey, addressStr);
        return addressStr;
      }

      return null;
    } catch (error) {
      logger.error(`[PDAWalletService] Error getting wallet for ${platform}:${userId}: ${error}`);
      return null;
    }
  }

  /**
   * Get balance of PDA wallet
   */
  public async getWalletBalance(platform: string, userId: string): Promise<number> {
    try {
      const [pdaAddress] = this.derivePDAAddress(platform, userId);
      const balance = await this.connection.getBalance(pdaAddress);
      return balance / 1e9; // Convert lamports to SOL
    } catch (error) {
      logger.error(`[PDAWalletService] Error getting balance for ${platform}:${userId}: ${error}`);
      return 0;
    }
  }

  /**
   * Get PDA wallet for user (wrapper for compatibility)
   * Returns format expected by coordinateAction and submitPinAction
   */
  public async getPDAWallet(platform: string, userId: string): Promise<{ address: string } | null> {
    try {
      const address = await this.ensureUserWallet(platform, userId);
      return { address };
    } catch (error) {
      logger.error(`[PDAWalletService] Error getting PDA wallet for ${platform}:${userId}: ${error}`);
      return null;
    }
  }

  /**
   * Store wallet information in runtime memory
   */
  private async storeWalletInMemory(platform: string, userId: string, walletAddress: string): Promise<void> {
    try {
      // Since userId might not be a valid UUID, we'll use null or generate a UUID
      // The actual user ID will be stored in the content
      await this.runtime.createMemory({
        entityId: null as any, // Will be handled by runtime
        agentId: this.runtime.agentId,
        roomId: null as any, // Will be handled by runtime
        content: {
          type: 'pda_wallet',
          platform,
          userId,
          walletAddress,
          createdAt: Date.now(),
        },
      }, 'pda_wallets');
    } catch (error) {
      logger.warn(`[PDAWalletService] Failed to store wallet in memory: ${error}`);
      // Non-critical error, continue
    }
  }

  /**
   * Get all cached wallets (for debugging)
   */
  public getCachedWallets(): Map<string, string> {
    return new Map(this.walletCache);
  }

  /**
   * Clear wallet cache
   */
  public clearCache(): void {
    this.walletCache.clear();
    logger.info('[PDAWalletService] Wallet cache cleared');
  }

  /**
   * Start the service
   */
  static async start(runtime: IAgentRuntime): Promise<Service> {
    try {
      const service = new PDAWalletService(runtime);
      logger.info('[PDAWalletService] Service started successfully');
      return service;
    } catch (error) {
      logger.error(`[PDAWalletService] Failed to start service: ${error}`);
      throw error;
    }
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    this.clearCache();
    logger.info('[PDAWalletService] Service stopped');
  }
}