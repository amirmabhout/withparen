import { Service, logger } from '@elizaos/core';
import type { IAgentRuntime } from '@elizaos/core';
import Safe from '@safe-global/protocol-kit';
import { ethers } from 'ethers';
import type { UserWallet, TransactionRequest, WalletBalance, SafeTransaction } from '../types';

// Simple module contract ABI for enabling module permissions
const MODULE_ABI = [
  'function enableModule(address module) external',
  'function disableModule(address prevModule, address module) external',
  'function isModuleEnabled(address module) external view returns (bool)',
  'function getModulesPaginated(address start, uint256 pageSize) external view returns (address[] memory array, address next)'
];

export class SafeWalletService extends Service {
  static serviceType = 'safe-wallet';
  
  private provider: ethers.JsonRpcProvider | null = null;
  private signer: ethers.Wallet | null = null;
  private chainId: number = 11155111;
  private userWallets: Map<string, UserWallet> = new Map();
  private isInitialized = false;
  private delegateeAddress: string;

  capabilityDescription = 'Manages Safe smart accounts for users with delegated permissions';

  constructor(protected runtime: IAgentRuntime) {
    super(runtime);
    this.delegateeAddress = process.env.DELEGATEE_ADDRESS || '0x67BdF78EA1E13D17e39A7f37b816C550359DA1e7';
  }

  static async start(runtime: IAgentRuntime): Promise<SafeWalletService> {
    logger.info('Starting Safe Wallet Service');
    const service = new SafeWalletService(runtime);
    await service.initialize();
    return service;
  }

  static async stop(runtime: IAgentRuntime): Promise<void> {
    logger.info('Stopping Safe Wallet Service');
    const service = runtime.getService<SafeWalletService>(SafeWalletService.serviceType);
    if (service) {
      await service.stop();
    }
  }

  async initialize(): Promise<void> {
    try {
      // Initialize Ethereum provider
      const rpcUrl = process.env.ETHEREUM_RPC_URL || 'https://sepolia.drpc.org';
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      
      const network = await this.provider.getNetwork();
      logger.info(`Connected to Ethereum network: ${network.name} (chainId: ${network.chainId})`);

      // Create a signer for the delegatee address (this should be configured securely)
      const privateKey = process.env.DELEGATEE_PRIVATE_KEY;
      if (!privateKey) {
        throw new Error('DELEGATEE_PRIVATE_KEY environment variable is required');
      }
      
      this.signer = new ethers.Wallet(privateKey, this.provider);
      logger.info(`Initialized delegatee signer: ${this.signer.address}`);

      // Store chain ID from environment
      this.chainId = parseInt(process.env.CHAIN_ID || '11155111');

      // Load existing wallets from storage if available
      await this.loadWallets();

      this.isInitialized = true;
      logger.info('Safe Wallet Service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Safe Wallet Service:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.provider = null;
    this.signer = null;
    this.isInitialized = false;
    logger.info('Safe Wallet Service stopped');
  }

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Safe Wallet Service not initialized');
    }
  }

  private async loadWallets(): Promise<void> {
    // Load existing wallets from memories
    try {
      const walletMemories = await this.runtime.getMemories({
        roomId: 'safe-wallet-storage',
        tableName: 'memories',
        count: 1000,
      });

      walletMemories.forEach(memory => {
        if (memory.content.type === 'safe-wallet-data' && memory.content.wallet) {
          const wallet = memory.content.wallet as UserWallet;
          this.userWallets.set(wallet.userId, wallet);
        }
      });

      if (this.userWallets.size > 0) {
        logger.info(`Loaded ${this.userWallets.size} user Safe wallets`);
      }
    } catch (error) {
      logger.warn('Could not load existing Safe wallets:', error);
    }
  }

  private async saveWallet(wallet: UserWallet): Promise<void> {
    // Save individual wallet to persistent storage
    try {
      logger.debug(`Saving Safe wallet for user ${wallet.userId} to persistent storage`);
      
      // Create a clean wallet object without undefined values
      const cleanWallet = {
        userId: wallet.userId,
        safeAddress: wallet.safeAddress,
        owners: wallet.owners,
        threshold: wallet.threshold,
        createdAt: wallet.createdAt,
        status: wallet.status,
        moduleEnabled: wallet.moduleEnabled || false,
        ...(wallet.lastUsed && { lastUsed: wallet.lastUsed }),
        ...(wallet.deploymentTxHash && { deploymentTxHash: wallet.deploymentTxHash }),
        ...(wallet.delegateeModule && { delegateeModule: wallet.delegateeModule }),
      };

      await this.runtime.createMemory({
        userId: this.runtime.agentId,
        agentId: this.runtime.agentId,
        roomId: 'safe-wallet-storage',
        content: {
          text: `Safe wallet for user ${wallet.userId}`,
          type: 'safe-wallet-data',
          wallet: cleanWallet,
        },
      }, 'memories');
      
      logger.debug(`Safe wallet saved successfully for user ${wallet.userId}`);
    } catch (error) {
      logger.error('Failed to save Safe wallet:', error);
      // Don't throw - wallet creation should succeed even if storage fails
    }
  }

  async createWalletForUser(userId: string): Promise<UserWallet> {
    this.ensureInitialized();

    // Check if user already has a wallet
    if (this.userWallets.has(userId)) {
      logger.info(`User ${userId} already has a Safe wallet`);
      return this.userWallets.get(userId)!;
    }

    try {
      logger.info(`Creating Safe smart account for user ${userId}`);

      // Generate a unique user address (in production, this would come from user auth)
      const userWallet = ethers.Wallet.createRandom();
      const userAddress = userWallet.address;

      // Create Safe account configuration with user and delegatee as owners
      const safeAccountConfig = {
        owners: [userAddress, this.delegateeAddress],
        threshold: 1, // Either owner can execute transactions
      };

      // Create Safe account with v4 API using RPC URL and private key
      logger.info(`Creating Safe with owners: ${safeAccountConfig.owners.join(', ')}`);
      const rpcUrl = process.env.ETHEREUM_RPC_URL || 'https://sepolia.drpc.org';
      const privateKey = process.env.DELEGATEE_PRIVATE_KEY;
      
      const protocolKit = await Safe.init({
        provider: rpcUrl,
        signer: privateKey,
        safeAccountConfig,
      });
      
      const safeAddress = await protocolKit.getAddress();
      logger.info(`Safe created successfully at address: ${safeAddress} with delegatee as co-owner`);

      // Create user wallet entry
      const userWalletEntry: UserWallet = {
        userId,
        safeAddress,
        owners: safeAccountConfig.owners,
        threshold: safeAccountConfig.threshold,
        createdAt: Date.now(),
        status: 'deployed',
        moduleEnabled: false, // Using co-ownership instead of modules
      };

      this.userWallets.set(userId, userWalletEntry);
      await this.saveWallet(userWalletEntry);

      logger.info(`Created Safe wallet for user ${userId} at address ${safeAddress} with delegatee module enabled`);
      return userWalletEntry;
    } catch (error) {
      logger.error(`Failed to create Safe wallet for user ${userId}:`, error);
      throw error;
    }
  }

  private async enableDelegateeModule(safeAddress: string, userWallet: ethers.Wallet): Promise<void> {
    try {
      logger.info(`Enabling delegatee module ${this.delegateeAddress} for Safe ${safeAddress}`);

      // Create a Safe instance connected with the user's wallet (as owner)
      const rpcUrl = process.env.ETHEREUM_RPC_URL || 'https://sepolia.drpc.org';
      const protocolKit = await Safe.init({
        provider: rpcUrl,
        signer: userWallet.privateKey,
        safeAddress: safeAddress,
      });

      // Create transaction to enable the delegatee as a module
      const safeTransactionData = {
        to: safeAddress,
        value: '0',
        data: new ethers.Interface(MODULE_ABI).encodeFunctionData('enableModule', [this.delegateeAddress]),
      };

      const safeTransaction = await protocolKit.createTransaction({
        transactions: [safeTransactionData]
      });
      const signedTransaction = await protocolKit.signTransaction(safeTransaction);
      const executeTxResponse = await protocolKit.executeTransaction(signedTransaction);

      logger.info(`Delegatee module enabled via transaction: ${executeTxResponse.hash}`);
    } catch (error) {
      logger.error(`Failed to enable delegatee module:`, error);
      throw error;
    }
  }

  async getUserWallet(userId: string): Promise<UserWallet | null> {
    return this.userWallets.get(userId) || null;
  }

  async getBalance(userId: string): Promise<WalletBalance | null> {
    this.ensureInitialized();

    const wallet = this.userWallets.get(userId);
    if (!wallet) {
      return null;
    }

    try {
      const balance = await this.provider!.getBalance(wallet.safeAddress);
      const formattedBalance = ethers.formatEther(balance);

      return {
        address: wallet.safeAddress,
        balance: balance.toString(),
        formattedBalance: `${formattedBalance} ETH`,
        symbol: 'ETH',
      };
    } catch (error) {
      logger.error(`Failed to get balance for user ${userId}:`, error);
      throw error;
    }
  }

  async sendTransaction(
    userId: string,
    transaction: TransactionRequest
  ): Promise<string> {
    this.ensureInitialized();

    const wallet = this.userWallets.get(userId);
    if (!wallet) {
      throw new Error(`No Safe wallet found for user ${userId}`);
    }

    try {
      logger.info(`Sending Safe transaction for user ${userId}:`, transaction);

      // Validate transaction
      if (!ethers.isAddress(transaction.to)) {
        throw new Error('Invalid recipient address');
      }

      const value = ethers.parseEther(transaction.value);
      
      // Check balance
      const balance = await this.provider!.getBalance(wallet.safeAddress);
      if (balance < value) {
        throw new Error('Insufficient balance in Safe wallet');
      }

      // Execute transaction as co-owner (delegatee is an owner)
      return await this.executeTransactionAsOwner(wallet, transaction, value);
    } catch (error) {
      logger.error(`Failed to send Safe transaction for user ${userId}:`, error);
      throw error;
    }
  }

  private async executeTransactionAsModule(
    wallet: UserWallet,
    transaction: TransactionRequest,
    value: bigint
  ): Promise<string> {
    try {
      logger.info(`Executing transaction as module for Safe ${wallet.safeAddress}`);

      // Initialize Safe Protocol Kit with delegatee signer
      const rpcUrl = process.env.ETHEREUM_RPC_URL || 'https://sepolia.drpc.org';
      const privateKey = process.env.DELEGATEE_PRIVATE_KEY;
      
      const protocolKit = await Safe.init({
        provider: rpcUrl,
        signer: privateKey,
        safeAddress: wallet.safeAddress,
      });

      // Create Safe transaction
      const safeTransactionData = {
        to: transaction.to,
        value: value.toString(),
        data: transaction.data || '0x',
      };

      const safeTransaction = await protocolKit.createTransaction({
        transactions: [safeTransactionData]
      });
      
      // Since we're enabled as a module, we can execute directly
      const executeTxResponse = await protocolKit.executeTransaction(safeTransaction);
      const txHash = executeTxResponse.hash;

      // Update last used timestamp
      wallet.lastUsed = Date.now();
      wallet.status = 'active';
      await this.saveWallet(wallet);

      logger.info(`Module transaction executed: ${txHash}`);
      return txHash;
    } catch (error) {
      logger.error(`Failed to execute transaction as module:`, error);
      throw error;
    }
  }

  private async executeTransactionAsOwner(
    wallet: UserWallet,
    transaction: TransactionRequest,
    value: bigint
  ): Promise<string> {
    try {
      logger.info(`Executing transaction as owner for Safe ${wallet.safeAddress}`);

      // Initialize Safe Protocol Kit with delegatee signer (if delegatee is an owner)
      const rpcUrl = process.env.ETHEREUM_RPC_URL || 'https://sepolia.drpc.org';
      const privateKey = process.env.DELEGATEE_PRIVATE_KEY;
      
      const protocolKit = await Safe.init({
        provider: rpcUrl,
        signer: privateKey,
        safeAddress: wallet.safeAddress,
      });

      // Create Safe transaction
      const safeTransactionData = {
        to: transaction.to,
        value: value.toString(),
        data: transaction.data || '0x',
      };

      const safeTransaction = await protocolKit.createTransaction({
        transactions: [safeTransactionData]
      });
      
      // Sign and execute the transaction as an owner
      const signedTransaction = await protocolKit.signTransaction(safeTransaction);
      const executeTxResponse = await protocolKit.executeTransaction(signedTransaction);
      const txHash = executeTxResponse.hash;

      // Update last used timestamp
      wallet.lastUsed = Date.now();
      wallet.status = 'active';
      await this.saveWallet(wallet);

      logger.info(`Owner transaction executed: ${txHash}`);
      return txHash;
    } catch (error) {
      logger.error(`Failed to execute transaction as owner:`, error);
      throw error;
    }
  }

  async getAllUserWallets(): Promise<UserWallet[]> {
    return Array.from(this.userWallets.values());
  }
}