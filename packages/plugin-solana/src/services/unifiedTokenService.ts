import {
    Connection,
    PublicKey,
    Keypair,
    SystemProgram,
    SYSVAR_RENT_PUBKEY,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    getAccount,
} from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import { createHash } from 'crypto';
import { elizaLogger, Service, type IAgentRuntime } from '@elizaos/core';
import { UNIFIED_TOKEN_SERVICE_NAME } from '../constants';
import { getWalletKey } from '../keypairUtils';

const logger = elizaLogger;

// Program ID - update this after deployment
const UNIFIED_TOKEN_PROGRAM_ID = new PublicKey('GXnod1W71vzjuFkXHxwQ2dkBe7t1auJMtwMQYL67ytVt');

// Constants
const INITIAL_ME_MINT = 48;
const DAILY_ME_LIMIT = 24;
const CONNECTION_MEMO_REWARD = 8;
const TOKEN_DECIMALS = 9;

/**
 * Helper function to hash user ID
 */
export function hashUserId(userId: string): Buffer {
    return createHash('sha256').update(userId).digest();
}

/**
 * Helper function to hash PIN
 */
export function hashPin(pin: string): Buffer {
    return createHash('sha256').update(pin).digest();
}

/**
 * Get Anchor instruction discriminator (first 8 bytes of SHA256("global:instruction_name"))
 */
function getInstructionDiscriminator(instructionName: string): Buffer {
    const hash = createHash('sha256').update(`global:${instructionName}`).digest();
    return hash.subarray(0, 8);
}

/**
 * Encode a string for Borsh serialization (4-byte length prefix + UTF-8 bytes)
 */
function encodeString(str: string): Buffer {
    const utf8Bytes = Buffer.from(str, 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32LE(utf8Bytes.length, 0);
    return Buffer.concat([length, utf8Bytes]);
}

/**
 * Encode a fixed-size u8 array (32 bytes)
 */
function encodeU8Array32(arr: number[] | Uint8Array | Buffer): Buffer {
    const buffer = Buffer.alloc(32);
    Buffer.from(arr).copy(buffer, 0, 0, 32);
    return buffer;
}

/**
 * Encode a u64 number (8 bytes, little-endian)
 */
function encodeU64(num: number | BN): Buffer {
    const buffer = Buffer.alloc(8);
    const bn = typeof num === 'number' ? new BN(num) : num;
    bn.toArrayLike(Buffer, 'le', 8).copy(buffer);
    return buffer;
}

/**
 * Derive global state PDA
 */
export function deriveGlobalStatePDA(programId: PublicKey = UNIFIED_TOKEN_PROGRAM_ID): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [Buffer.from('global_state')],
        programId
    );
}

/**
 * Derive MEMO mint PDA
 */
export function deriveMemoMintPDA(programId: PublicKey = UNIFIED_TOKEN_PROGRAM_ID): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [Buffer.from('memo_mint')],
        programId
    );
}

/**
 * Derive ME escrow PDA
 */
export function deriveMeEscrowPDA(programId: PublicKey = UNIFIED_TOKEN_PROGRAM_ID): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [Buffer.from('me_escrow')],
        programId
    );
}

/**
 * Derive user account PDA
 */
export function deriveUserAccountPDA(
    userId: string,
    programId: PublicKey = UNIFIED_TOKEN_PROGRAM_ID
): [PublicKey, number] {
    const userIdHash = hashUserId(userId);
    return PublicKey.findProgramAddressSync(
        [Buffer.from('user'), userIdHash],
        programId
    );
}

/**
 * Derive user's personal ME mint PDA
 */
export function deriveMeMintPDA(
    userId: string,
    programId: PublicKey = UNIFIED_TOKEN_PROGRAM_ID
): [PublicKey, number] {
    const userIdHash = hashUserId(userId);
    return PublicKey.findProgramAddressSync(
        [Buffer.from('me_mint'), userIdHash],
        programId
    );
}

/**
 * Derive connection PDA
 */
export function deriveConnectionPDA(
    connectionId: string,
    programId: PublicKey = UNIFIED_TOKEN_PROGRAM_ID
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [Buffer.from('connection'), Buffer.from(connectionId)],
        programId
    );
}

export interface UserBalances {
    meBalance: number;
    memoBalance: number;
    dailyAvailable: number;
    totalMinted: number;
    totalLocked: number;
    totalMemoEarned: number;
    connectionsCount: number;
}

export interface ConnectionInfo {
    connectionId: string;
    userA: PublicKey;
    userB: PublicKey;
    userAUnlocked: boolean;
    userBUnlocked: boolean;
    createdAt: number;
}

/**
 * Unified Token Service
 * Manages ME and MEMO tokens for users
 * @extends Service
 */
export class UnifiedTokenService extends Service {
    static serviceType: string = UNIFIED_TOKEN_SERVICE_NAME;
    capabilityDescription = 'The agent is able to manage ME and MEMO tokens for users on Solana';

    private connection: Connection;
    private programId: PublicKey;
    private globalState: PublicKey;
    private memoMint: PublicKey;
    private meEscrow: PublicKey;
    private payerKeypair: Keypair | null = null;
    private initialized: boolean = false;

    constructor(protected runtime: IAgentRuntime) {
        super();

        // Get connection
        const rpcUrl = runtime.getSetting('SOLANA_RPC_URL') || 'https://api.devnet.solana.com';
        this.connection = new Connection(rpcUrl, 'confirmed');

        // Get program ID from settings or use default devnet deployment
        const programIdStr = runtime.getSetting('UNIFIED_TOKEN_PROGRAM_ID');
        this.programId = programIdStr
            ? new PublicKey(programIdStr)
            : UNIFIED_TOKEN_PROGRAM_ID;

        // Derive global PDAs
        [this.globalState] = deriveGlobalStatePDA(this.programId);
        [this.memoMint] = deriveMemoMintPDA(this.programId);
        [this.meEscrow] = deriveMeEscrowPDA(this.programId);

        // Initialize keypair and program asynchronously
        this.initialize();
    }

    /**
     * Static start method (required by Service base class)
     */
    static async start(runtime: IAgentRuntime): Promise<UnifiedTokenService> {
        logger.info('[UnifiedTokenService] Starting service...');
        const service = new UnifiedTokenService(runtime);
        // Wait for initialization to complete before returning
        await service.ensureInitialized();
        logger.info('[UnifiedTokenService] Service started successfully');
        return service;
    }

    private async initialize(): Promise<void> {
        try {
            // Get wallet keypair
            const walletResult = await getWalletKey(this.runtime, true);
            if (!walletResult.keypair) {
                logger.error('[UnifiedTokenService] Failed to get wallet keypair');
                return;
            }
            this.payerKeypair = walletResult.keypair;

            this.initialized = true;

            logger.info('[UnifiedTokenService] Initialized');
            logger.info(`  Program ID: ${this.programId.toString()}`);
            logger.info(`  Global State: ${this.globalState.toString()}`);
            logger.info(`  MEMO Mint: ${this.memoMint.toString()}`);
            logger.info(`  Payer: ${this.payerKeypair.publicKey.toString()}`);
        } catch (error: any) {
            logger.error(`[UnifiedTokenService] Initialization error: ${error?.message}`, error);
        }
    }

    private async ensureInitialized(): Promise<void> {
        if (!this.initialized || !this.payerKeypair) {
            await this.initialize();
            if (!this.initialized || !this.payerKeypair) {
                throw new Error('UnifiedTokenService not properly initialized');
            }
        }
    }

    /**
     * Initialize global state (one-time setup)
     * TODO: Implement with manual instruction building (no Anchor Program)
     */
    async initializeGlobal(adminKeypair?: Keypair): Promise<string> {
        await this.ensureInitialized();
        throw new Error('[UnifiedTokenService] initializeGlobal not yet implemented - requires manual instruction building');

        /* TODO: Build instruction manually without Anchor
        logger.info('[UnifiedTokenService] Initializing global state...');

        const signer = adminKeypair || this.payerKeypair;
        if (!signer) {
            throw new Error('No keypair available for initialization');
        }

        const tx = await this.program.methods
            .initializeGlobal()
            .accounts({
                globalState: this.globalState,
                memoMint: this.memoMint,
                meEscrow: this.meEscrow,
                admin: signer.publicKey,
                systemProgram: SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                rent: SYSVAR_RENT_PUBKEY,
            })
            .signers([signer])
            .rpc();

        logger.info(`[UnifiedTokenService] ✓ Global state initialized. Tx: ${tx}`);
        return tx;
        */
    }

    /**
     * Initialize a user with PDA, ME mint, and token accounts
     * Mints initial 48 $ME tokens
     */
    async initializeUser(
        userId: string,
        payerKeypair?: Keypair
    ): Promise<string> {
        await this.ensureInitialized();
        logger.info(`[UnifiedTokenService] Initializing user: ${userId}`);

        const signer = payerKeypair || this.payerKeypair;
        if (!signer) {
            throw new Error('No keypair available for user initialization');
        }

        // Derive PDAs
        const userIdHash = Array.from(hashUserId(userId));
        const [userAccount] = deriveUserAccountPDA(userId, this.programId);
        const [meMint] = deriveMeMintPDA(userId, this.programId);

        // Derive ATAs
        const userMeAta = await getAssociatedTokenAddress(
            meMint,
            signer.publicKey
        );

        const userMemoAta = await getAssociatedTokenAddress(
            this.memoMint,
            signer.publicKey
        );

        logger.debug(`[UnifiedTokenService] User Account: ${userAccount.toString()}`);
        logger.debug(`[UnifiedTokenService] ME Mint: ${meMint.toString()}`);
        logger.debug(`[UnifiedTokenService] ME ATA: ${userMeAta.toString()}`);
        logger.debug(`[UnifiedTokenService] MEMO ATA: ${userMemoAta.toString()}`);

        // Check if already initialized
        try {
            const accountInfo = await this.connection.getAccountInfo(userAccount);
            if (accountInfo) {
                logger.info(`[UnifiedTokenService] User ${userId} already initialized`);
                return 'already_initialized';
            }
        } catch (err) {
            // Account doesn't exist, proceed with initialization
        }

        // Build instruction data: discriminator + userId (string) + userIdHash (u8[32])
        const discriminator = getInstructionDiscriminator('initialize_user');
        const userIdEncoded = encodeString(userId);
        const userIdHashEncoded = encodeU8Array32(userIdHash);
        const instructionData = Buffer.concat([discriminator, userIdEncoded, userIdHashEncoded]);

        // Build accounts array (must match IDL order)
        const keys = [
            { pubkey: userAccount, isSigner: false, isWritable: true },
            { pubkey: meMint, isSigner: false, isWritable: true },
            { pubkey: userMeAta, isSigner: false, isWritable: true },
            { pubkey: userMemoAta, isSigner: false, isWritable: true },
            { pubkey: this.globalState, isSigner: false, isWritable: true },
            { pubkey: this.memoMint, isSigner: false, isWritable: false },
            { pubkey: signer.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        ];

        // Create instruction
        const instruction = new TransactionInstruction({
            keys,
            programId: this.programId,
            data: instructionData,
        });

        // Create and send transaction
        const transaction = new Transaction().add(instruction);
        const signature = await sendAndConfirmTransaction(
            this.connection,
            transaction,
            [signer],
            { commitment: 'confirmed' }
        );

        logger.info(`[UnifiedTokenService] ✓ User ${userId} initialized with ${INITIAL_ME_MINT} $ME`);
        logger.info(`[UnifiedTokenService] Tx: ${signature}`);
        logger.info(`[UnifiedTokenService] Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);

        return signature;
    }

    /**
     * Mint daily ME tokens (up to 24/day)
     * TODO: Implement with manual instruction building (no Anchor Program)
     */
    async mintDailyMe(
        userId: string,
        payerKeypair?: Keypair
    ): Promise<string> {
        await this.ensureInitialized();
        throw new Error('[UnifiedTokenService] mintDailyMe not yet implemented - requires manual instruction building');
        /* TODO: Build instruction manually without Anchor
        logger.info(`[UnifiedTokenService] Minting daily ME for user: ${userId}`);

        const signer = payerKeypair || this.payerKeypair;
        if (!signer) {
            throw new Error('No keypair available for minting');
        }

        const userIdHash = Array.from(hashUserId(userId));
        const [userAccount] = deriveUserAccountPDA(userId, this.programId);
        const [meMint] = deriveMeMintPDA(userId, this.programId);
        const userMeAta = await getAssociatedTokenAddress(meMint, signer.publicKey);

        const tx = await this.program.methods
            .mintDailyMe(userId, userIdHash)
            .accounts({
                userAccount,
                meMint,
                userMeAta,
                payer: signer.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([signer])
            .rpc();

        logger.info(`[UnifiedTokenService] ✓ Minted daily ME for ${userId}. Tx: ${tx}`);
        return tx;
        */
    }

    /**
     * Lock ME tokens and receive MEMO tokens (1:1 ratio)
     * TODO: Implement with manual instruction building (no Anchor Program)
     */
    async lockMeForMemo(
        userId: string,
        amount: number,
        payerKeypair?: Keypair
    ): Promise<string> {
        await this.ensureInitialized();
        throw new Error('[UnifiedTokenService] lockMeForMemo not yet implemented - requires manual instruction building');
        /* TODO: Build instruction manually without Anchor
        logger.info(`[UnifiedTokenService] Locking ${amount} ME for ${amount} MEMO...`);

        const signer = payerKeypair || this.payerKeypair;
        if (!signer) {
            throw new Error('No keypair available for locking');
        }

        const userIdHash = Array.from(hashUserId(userId));
        const [userAccount] = deriveUserAccountPDA(userId, this.programId);
        const [meMint] = deriveMeMintPDA(userId, this.programId);
        const userMeAta = await getAssociatedTokenAddress(meMint, signer.publicKey);
        const userMemoAta = await getAssociatedTokenAddress(this.memoMint, signer.publicKey);

        const tx = await this.program.methods
            .lockMeForMemo(userIdHash, new BN(amount))
            .accounts({
                userAccount,
                userMeAta,
                userMemoAta,
                globalState: this.globalState,
                memoMint: this.memoMint,
                meEscrow: this.meEscrow,
                meMint,
                payer: signer.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([signer])
            .rpc();

        logger.info(`[UnifiedTokenService] ✓ Locked ${amount} ME, received ${amount} MEMO. Tx: ${tx}`);
        return tx;
        */
    }

    /**
     * Create a connection between two users
     */
    async createConnection(
        connectionId: string,
        userAId: string,
        userBId: string,
        pinA: string,
        pinB: string,
        payerKeypair?: Keypair
    ): Promise<string> {
        await this.ensureInitialized();
        logger.info(`[UnifiedTokenService] Creating connection: ${connectionId}`);

        const signer = payerKeypair || this.payerKeypair;
        if (!signer) {
            throw new Error('No keypair available for connection creation');
        }

        const [connectionAccount] = deriveConnectionPDA(connectionId, this.programId);
        const [userAAccount] = deriveUserAccountPDA(userAId, this.programId);
        const [userBAccount] = deriveUserAccountPDA(userBId, this.programId);

        const pinAHash = Array.from(hashPin(pinA));
        const pinBHash = Array.from(hashPin(pinB));

        // Build instruction data: discriminator + connectionId + userAId + userBId + pinAHash + pinBHash
        const discriminator = getInstructionDiscriminator('create_connection');
        const connectionIdEncoded = encodeString(connectionId);
        const userAIdEncoded = encodeString(userAId);
        const userBIdEncoded = encodeString(userBId);
        const pinAHashEncoded = encodeU8Array32(pinAHash);
        const pinBHashEncoded = encodeU8Array32(pinBHash);
        const instructionData = Buffer.concat([
            discriminator,
            connectionIdEncoded,
            userAIdEncoded,
            userBIdEncoded,
            pinAHashEncoded,
            pinBHashEncoded,
        ]);

        // Build accounts array (must match IDL order)
        const keys = [
            { pubkey: connectionAccount, isSigner: false, isWritable: true },
            { pubkey: userAAccount, isSigner: false, isWritable: true },
            { pubkey: userBAccount, isSigner: false, isWritable: true },
            { pubkey: this.globalState, isSigner: false, isWritable: true },
            { pubkey: signer.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ];

        // Create instruction
        const instruction = new TransactionInstruction({
            keys,
            programId: this.programId,
            data: instructionData,
        });

        // Create and send transaction
        const transaction = new Transaction().add(instruction);
        const signature = await sendAndConfirmTransaction(
            this.connection,
            transaction,
            [signer],
            { commitment: 'confirmed' }
        );

        logger.info(`[UnifiedTokenService] ✓ Connection created. Tx: ${signature}`);
        return signature;
    }

    /**
     * Unlock a connection with PIN
     * TODO: Implement with manual instruction building (no Anchor Program)
     */
    async unlockConnection(
        connectionId: string,
        userId: string,
        pin: string,
        payerKeypair?: Keypair
    ): Promise<string> {
        await this.ensureInitialized();
        throw new Error('[UnifiedTokenService] unlockConnection not yet implemented - requires manual instruction building');
        /* TODO: Build instruction manually without Anchor
        logger.info(`[UnifiedTokenService] Unlocking connection: ${connectionId}`);

        const signer = payerKeypair || this.payerKeypair;
        if (!signer) {
            throw new Error('No keypair available for unlocking connection');
        }

        const [connectionAccount] = deriveConnectionPDA(connectionId, this.programId);
        const [userAccount] = deriveUserAccountPDA(userId, this.programId);
        const userMemoAta = await getAssociatedTokenAddress(this.memoMint, signer.publicKey);

        // Convert PIN string to bytes
        const pinBytes = Array.from(Buffer.from(pin, 'utf8').slice(0, 4));

        const tx = await this.program.methods
            .unlockConnection(pinBytes)
            .accounts({
                connectionAccount,
                userAccount,
                userMemoAta,
                globalState: this.globalState,
                memoMint: this.memoMint,
                payer: signer.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([signer])
            .rpc();

        logger.info(`[UnifiedTokenService] ✓ Connection unlocked! Rewarded ${CONNECTION_MEMO_REWARD} MEMO. Tx: ${tx}`);
        return tx;
        */
    }

    /**
     * Get user balances by fetching on-chain account data
     */
    async getUserBalances(userId: string, walletAddress: PublicKey): Promise<UserBalances | null> {
        try {
            const [userAccount] = deriveUserAccountPDA(userId, this.programId);
            const [meMint] = deriveMeMintPDA(userId, this.programId);

            // Fetch user account data
            const accountInfo = await this.connection.getAccountInfo(userAccount);
            if (!accountInfo) {
                logger.debug(`[UnifiedTokenService] User account not found for ${userId}`);
                return null;
            }

            // Manually deserialize UserAccount struct
            // Layout: user_id(64) + me_mint(32) + last_mint_time(8) + daily_minted_today(8) +
            //         total_me_minted(8) + total_me_locked(8) + total_memo_earned(8) + connections_count(8) + bump(1)
            // Note: First 8 bytes are Anchor discriminator
            const data = accountInfo.data;
            let offset = 8; // Skip Anchor discriminator

            // Skip user_id (64 bytes)
            offset += 64;

            // Skip me_mint (32 bytes)
            offset += 32;

            // Skip last_mint_time (8 bytes)
            offset += 8;

            // Read daily_minted_today (u64, 8 bytes, little-endian)
            const dailyMinted = Number(data.readBigUInt64LE(offset));
            offset += 8;

            // Read total_me_minted (u64, 8 bytes, little-endian)
            const totalMinted = Number(data.readBigUInt64LE(offset));
            offset += 8;

            // Read total_me_locked (u64, 8 bytes, little-endian)
            const totalLocked = Number(data.readBigUInt64LE(offset));
            offset += 8;

            // Read total_memo_earned (u64, 8 bytes, little-endian)
            const totalMemoEarned = Number(data.readBigUInt64LE(offset));
            offset += 8;

            // Read connections_count (u64, 8 bytes, little-endian)
            const connectionsCount = Number(data.readBigUInt64LE(offset));

            // Get token balances from ATAs
            const userMeAta = await getAssociatedTokenAddress(meMint, walletAddress);
            const userMemoAta = await getAssociatedTokenAddress(this.memoMint, walletAddress);

            const meTokenAccount = await getAccount(this.connection, userMeAta);
            const memoTokenAccount = await getAccount(this.connection, userMemoAta);

            // Convert from lamports to tokens (divide by 10^9)
            const meBalance = Number(meTokenAccount.amount) / Math.pow(10, TOKEN_DECIMALS);
            const memoBalance = Number(memoTokenAccount.amount) / Math.pow(10, TOKEN_DECIMALS);

            // Calculate daily available (24 - dailyMinted)
            const dailyAvailable = DAILY_ME_LIMIT - dailyMinted;

            return {
                meBalance,
                memoBalance,
                dailyAvailable: Math.max(0, dailyAvailable),
                totalMinted,
                totalLocked,
                totalMemoEarned,
                connectionsCount,
            };
        } catch (error: any) {
            logger.error(`[UnifiedTokenService] Error getting balances for ${userId}: ${error?.message}`);
            return null;
        }
    }

    /**
     * Get connection info
     * TODO: Implement with manual account fetching (no Anchor Program)
     */
    async getConnection(connectionId: string): Promise<ConnectionInfo | null> {
        throw new Error('[UnifiedTokenService] getConnection not yet implemented - requires manual account fetching');
        /* TODO: Fetch account data manually without Anchor
        try {
            const [connectionAccount] = deriveConnectionPDA(connectionId, this.programId);
            const connectionData = await (this.program.account as any).connectionAccount.fetch(connectionAccount);

            return {
                connectionId,
                userA: connectionData.userA as PublicKey,
                userB: connectionData.userB as PublicKey,
                userAUnlocked: connectionData.userAUnlocked as boolean,
                userBUnlocked: connectionData.userBUnlocked as boolean,
                createdAt: (connectionData.createdAt as any).toNumber(),
            };
        } catch (error: any) {
            logger.debug(`[UnifiedTokenService] Connection ${connectionId} not found or error: ${error?.message}`);
            return null;
        }
        */
    }

    /**
     * Check if user is initialized
     */
    async isUserInitialized(userId: string): Promise<boolean> {
        try {
            const [userAccount] = deriveUserAccountPDA(userId, this.programId);
            const accountInfo = await this.connection.getAccountInfo(userAccount);
            return accountInfo !== null;
        } catch (error) {
            return false;
        }
    }

    /**
     * Stop the service (required by Service base class)
     */
    async stop(): Promise<void> {
        logger.info('[UnifiedTokenService] Service stopped');
    }
}
