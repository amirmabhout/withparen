use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, MintTo, Token, TokenAccount, Transfer},
};
use sha2::{Digest, Sha256};

declare_id!("GXnod1W71vzjuFkXHxwQ2dkBe7t1auJMtwMQYL67ytVt");

// Constants
const INITIAL_ME_MINT: u64 = 48;
const DAILY_ME_LIMIT: u64 = 24;
const DAY_IN_SECONDS: i64 = 86400;
const TOKEN_DECIMALS: u8 = 9;
const CONNECTION_MEMO_REWARD: u64 = 8;

#[program]
pub mod unified_token_program {
    use super::*;

    /// Initialize the global state and MEMO mint
    pub fn initialize_global(ctx: Context<InitializeGlobal>) -> Result<()> {
        let global_state = &mut ctx.accounts.global_state;
        global_state.memo_mint = ctx.accounts.memo_mint.key();
        global_state.me_escrow = ctx.accounts.me_escrow.key();
        global_state.admin = ctx.accounts.admin.key();
        global_state.total_users = 0;
        global_state.total_connections = 0;

        msg!("Global state initialized");
        msg!("MEMO Mint: {}", global_state.memo_mint);
        msg!("ME Escrow: {}", global_state.me_escrow);

        Ok(())
    }

    /// Initialize a user with PDA + personal ME mint + token accounts
    pub fn initialize_user(
        ctx: Context<InitializeUser>,
        user_id: String,
        user_id_hash: [u8; 32],
    ) -> Result<()> {
        require!(user_id.len() <= 64, ErrorCode::UserIdTooLong);

        let user_account = &mut ctx.accounts.user_account;
        let clock = Clock::get()?;

        // Store user ID in fixed-size array
        let user_id_bytes = user_id.as_bytes();
        let mut user_id_array = [0u8; 64];
        let len = user_id_bytes.len().min(64);
        user_id_array[..len].copy_from_slice(&user_id_bytes[..len]);

        user_account.user_id = user_id_array;
        user_account.me_mint = ctx.accounts.me_mint.key();
        user_account.last_mint_time = clock.unix_timestamp;
        user_account.daily_minted_today = INITIAL_ME_MINT;
        user_account.total_me_minted = INITIAL_ME_MINT;
        user_account.total_me_locked = 0;
        user_account.total_memo_earned = 0;
        user_account.connections_count = 0;
        user_account.bump = ctx.bumps.user_account;

        // Mint initial ME tokens to user's ATA
        let seeds = &[
            b"me_mint".as_ref(),
            user_id_hash.as_ref(),
            &[ctx.bumps.me_mint],
        ];
        let signer_seeds = &[&seeds[..]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.me_mint.to_account_info(),
                    to: ctx.accounts.user_me_ata.to_account_info(),
                    authority: ctx.accounts.me_mint.to_account_info(),
                },
                signer_seeds,
            ),
            INITIAL_ME_MINT * 10u64.pow(TOKEN_DECIMALS as u32),
        )?;

        // Update global state
        let global_state = &mut ctx.accounts.global_state;
        global_state.total_users += 1;

        msg!("User initialized: {}", user_id);
        msg!("ME Mint: {}", ctx.accounts.me_mint.key());
        msg!("Initial ME minted: {}", INITIAL_ME_MINT);

        Ok(())
    }

    /// Mint daily ME tokens (up to 24/day)
    pub fn mint_daily_me(
        ctx: Context<MintDailyMe>,
        user_id: String,
        user_id_hash: [u8; 32],
    ) -> Result<()> {
        let user_account = &mut ctx.accounts.user_account;
        let clock = Clock::get()?;

        // Check if a new day has passed
        let time_elapsed = clock.unix_timestamp - user_account.last_mint_time;
        let days_passed = time_elapsed / DAY_IN_SECONDS;

        if days_passed > 0 {
            // Reset daily counter for new day
            user_account.daily_minted_today = 0;
            user_account.last_mint_time = clock.unix_timestamp;
        }

        // Check daily limit
        require!(
            user_account.daily_minted_today < DAILY_ME_LIMIT,
            ErrorCode::DailyLimitReached
        );

        // Calculate how many tokens can be minted
        let available_to_mint = DAILY_ME_LIMIT - user_account.daily_minted_today;
        let to_mint = available_to_mint.min(DAILY_ME_LIMIT);

        // Mint ME tokens
        let seeds = &[
            b"me_mint".as_ref(),
            user_id_hash.as_ref(),
            &[ctx.bumps.me_mint],
        ];
        let signer_seeds = &[&seeds[..]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.me_mint.to_account_info(),
                    to: ctx.accounts.user_me_ata.to_account_info(),
                    authority: ctx.accounts.me_mint.to_account_info(),
                },
                signer_seeds,
            ),
            to_mint * 10u64.pow(TOKEN_DECIMALS as u32),
        )?;

        user_account.daily_minted_today += to_mint;
        user_account.total_me_minted += to_mint;

        msg!("Minted {} ME for {} (total: {})", to_mint, user_id, user_account.total_me_minted);
        Ok(())
    }

    /// Lock ME tokens in escrow and mint MEMO tokens
    pub fn lock_me_for_memo(
        ctx: Context<LockMeForMemo>,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        let amount_with_decimals = amount * 10u64.pow(TOKEN_DECIMALS as u32);

        // Transfer ME tokens from user to escrow
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_me_ata.to_account_info(),
                    to: ctx.accounts.me_escrow.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            amount_with_decimals,
        )?;

        // Mint MEMO tokens to user (1:1 ratio for now)
        let seeds = &[
            b"global_state".as_ref(),
            &[ctx.bumps.global_state],
        ];
        let signer_seeds = &[&seeds[..]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.memo_mint.to_account_info(),
                    to: ctx.accounts.user_memo_ata.to_account_info(),
                    authority: ctx.accounts.global_state.to_account_info(),
                },
                signer_seeds,
            ),
            amount_with_decimals,
        )?;

        // Update user account
        let user_account = &mut ctx.accounts.user_account;
        user_account.total_me_locked += amount;
        user_account.total_memo_earned += amount;

        msg!("Locked {} ME, minted {} MEMO", amount, amount);
        Ok(())
    }

    /// Create a connection between two users
    pub fn create_connection(
        ctx: Context<CreateConnection>,
        connection_id: String,
        user_a_id: String,
        user_b_id: String,
        pin_a_hash: [u8; 32],
        pin_b_hash: [u8; 32],
    ) -> Result<()> {
        let connection = &mut ctx.accounts.connection_account;
        let clock = Clock::get()?;

        // Store connection data
        let mut connection_id_array = [0u8; 64];
        let len = connection_id.as_bytes().len().min(64);
        connection_id_array[..len].copy_from_slice(&connection_id.as_bytes()[..len]);
        connection.connection_id = connection_id_array;

        connection.user_a = ctx.accounts.user_a_account.key();
        connection.user_b = ctx.accounts.user_b_account.key();
        connection.pin_a_hash = pin_a_hash;
        connection.pin_b_hash = pin_b_hash;
        connection.user_a_unlocked = false;
        connection.user_b_unlocked = false;
        connection.created_at = clock.unix_timestamp;
        connection.bump = ctx.bumps.connection_account;

        // Update global state
        let global_state = &mut ctx.accounts.global_state;
        global_state.total_connections += 1;

        msg!("Connection created: {}", connection_id);
        msg!("User A: {}", user_a_id);
        msg!("User B: {}", user_b_id);

        Ok(())
    }

    /// Unlock a connection with PIN
    pub fn unlock_connection(
        ctx: Context<UnlockConnection>,
        pin: [u8; 4],
    ) -> Result<()> {
        // Get the user key before borrowing mutably
        let user_key = ctx.accounts.user_account.key();

        let connection = &mut ctx.accounts.connection_account;
        let user_account = &mut ctx.accounts.user_account;

        // Hash the submitted PIN using SHA256
        let mut hasher = Sha256::new();
        hasher.update(&pin);
        let result = hasher.finalize();
        let pin_hash: [u8; 32] = result.into();

        // Determine which user is submitting and verify PIN
        let is_user_a = user_key == connection.user_a;
        let is_user_b = user_key == connection.user_b;

        require!(is_user_a || is_user_b, ErrorCode::UnauthorizedUser);

        if is_user_a {
            // User A unlocks with User B's PIN
            require!(pin_hash == connection.pin_b_hash, ErrorCode::InvalidPin);
            require!(!connection.user_a_unlocked, ErrorCode::AlreadyUnlocked);
            connection.user_a_unlocked = true;
        } else {
            // User B unlocks with User A's PIN
            require!(pin_hash == connection.pin_a_hash, ErrorCode::InvalidPin);
            require!(!connection.user_b_unlocked, ErrorCode::AlreadyUnlocked);
            connection.user_b_unlocked = true;
        }

        // Mint MEMO reward
        let seeds = &[
            b"global_state".as_ref(),
            &[ctx.bumps.global_state],
        ];
        let signer_seeds = &[&seeds[..]];

        let reward_amount = CONNECTION_MEMO_REWARD * 10u64.pow(TOKEN_DECIMALS as u32);

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.memo_mint.to_account_info(),
                    to: ctx.accounts.user_memo_ata.to_account_info(),
                    authority: ctx.accounts.global_state.to_account_info(),
                },
                signer_seeds,
            ),
            reward_amount,
        )?;

        // Update user account
        user_account.total_memo_earned += CONNECTION_MEMO_REWARD;
        user_account.connections_count += 1;

        msg!("Connection unlocked! Rewarded {} MEMO", CONNECTION_MEMO_REWARD);
        msg!("Both unlocked: {}", connection.user_a_unlocked && connection.user_b_unlocked);

        Ok(())
    }
}

// ============================================================================
// Account Structures
// ============================================================================

#[account]
pub struct GlobalState {
    pub memo_mint: Pubkey,           // Global MEMO token mint (32 bytes)
    pub me_escrow: Pubkey,           // Escrow account for locked ME tokens (32 bytes)
    pub admin: Pubkey,               // Admin pubkey (32 bytes)
    pub total_users: u64,            // Total registered users (8 bytes)
    pub total_connections: u64,      // Total connections created (8 bytes)
}

#[account]
pub struct UserAccount {
    pub user_id: [u8; 64],          // User identifier (64 bytes)
    pub me_mint: Pubkey,            // Personal ME token mint (32 bytes)
    pub last_mint_time: i64,        // Unix timestamp of last mint (8 bytes)
    pub daily_minted_today: u64,    // Amount minted today (8 bytes)
    pub total_me_minted: u64,       // Total lifetime ME minted (8 bytes)
    pub total_me_locked: u64,       // Total ME locked in escrow (8 bytes)
    pub total_memo_earned: u64,     // Total MEMO earned (8 bytes)
    pub connections_count: u64,     // Number of connections made (8 bytes)
    pub bump: u8,                   // PDA bump seed (1 byte)
}

#[account]
pub struct ConnectionAccount {
    pub connection_id: [u8; 64],    // Connection identifier (64 bytes)
    pub user_a: Pubkey,             // User A pubkey (32 bytes)
    pub user_b: Pubkey,             // User B pubkey (32 bytes)
    pub pin_a_hash: [u8; 32],       // Hash of PIN for User A (32 bytes)
    pub pin_b_hash: [u8; 32],       // Hash of PIN for User B (32 bytes)
    pub user_a_unlocked: bool,      // Has User A unlocked? (1 byte)
    pub user_b_unlocked: bool,      // Has User B unlocked? (1 byte)
    pub created_at: i64,            // Unix timestamp (8 bytes)
    pub bump: u8,                   // PDA bump seed (1 byte)
}

// ============================================================================
// Instruction Contexts
// ============================================================================

#[derive(Accounts)]
pub struct InitializeGlobal<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + 32 + 32 + 32 + 8 + 8,
        seeds = [b"global_state"],
        bump
    )]
    pub global_state: Account<'info, GlobalState>,

    #[account(
        init,
        payer = admin,
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = global_state,
        seeds = [b"memo_mint"],
        bump
    )]
    pub memo_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = admin,
        token::mint = memo_mint,
        token::authority = global_state,
        seeds = [b"me_escrow"],
        bump
    )]
    pub me_escrow: Account<'info, TokenAccount>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(user_id: String, user_id_hash: [u8; 32])]
pub struct InitializeUser<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 64 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 1,
        seeds = [b"user", user_id_hash.as_ref()],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(
        init,
        payer = payer,
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = me_mint,
        seeds = [b"me_mint", user_id_hash.as_ref()],
        bump
    )]
    pub me_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = me_mint,
        associated_token::authority = payer,
    )]
    pub user_me_ata: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = memo_mint,
        associated_token::authority = payer,
    )]
    pub user_memo_ata: Account<'info, TokenAccount>,

    #[account(
        seeds = [b"global_state"],
        bump
    )]
    pub global_state: Account<'info, GlobalState>,

    #[account(
        address = global_state.memo_mint
    )]
    pub memo_mint: Account<'info, Mint>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(user_id: String, user_id_hash: [u8; 32])]
pub struct MintDailyMe<'info> {
    #[account(
        mut,
        seeds = [b"user", user_id_hash.as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(
        mut,
        seeds = [b"me_mint", user_id_hash.as_ref()],
        bump
    )]
    pub me_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = me_mint,
        associated_token::authority = payer,
    )]
    pub user_me_ata: Account<'info, TokenAccount>,

    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(user_id_hash: [u8; 32])]
pub struct LockMeForMemo<'info> {
    #[account(
        mut,
        seeds = [b"user", user_id_hash.as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(
        mut,
        associated_token::mint = me_mint,
        associated_token::authority = payer,
    )]
    pub user_me_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = memo_mint,
        associated_token::authority = payer,
    )]
    pub user_memo_ata: Account<'info, TokenAccount>,

    #[account(
        seeds = [b"global_state"],
        bump
    )]
    pub global_state: Account<'info, GlobalState>,

    #[account(
        mut,
        address = global_state.memo_mint
    )]
    pub memo_mint: Account<'info, Mint>,

    #[account(
        mut,
        address = global_state.me_escrow
    )]
    pub me_escrow: Account<'info, TokenAccount>,

    #[account(
        address = user_account.me_mint
    )]
    pub me_mint: Account<'info, Mint>,

    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(connection_id: String)]
pub struct CreateConnection<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 64 + 32 + 32 + 32 + 32 + 1 + 1 + 8 + 1,
        seeds = [b"connection", connection_id.as_bytes()],
        bump
    )]
    pub connection_account: Account<'info, ConnectionAccount>,

    #[account(
        mut,
        constraint = user_a_account.key() != user_b_account.key() @ ErrorCode::SameUserConnection
    )]
    pub user_a_account: Account<'info, UserAccount>,

    #[account(mut)]
    pub user_b_account: Account<'info, UserAccount>,

    #[account(
        mut,
        seeds = [b"global_state"],
        bump
    )]
    pub global_state: Account<'info, GlobalState>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnlockConnection<'info> {
    #[account(
        mut,
        constraint = !connection_account.user_a_unlocked || !connection_account.user_b_unlocked @ ErrorCode::ConnectionFullyUnlocked
    )]
    pub connection_account: Account<'info, ConnectionAccount>,

    #[account(
        mut,
        constraint = user_account.key() == connection_account.user_a || user_account.key() == connection_account.user_b @ ErrorCode::UnauthorizedUser
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(
        mut,
        associated_token::mint = memo_mint,
        associated_token::authority = payer,
    )]
    pub user_memo_ata: Account<'info, TokenAccount>,

    #[account(
        seeds = [b"global_state"],
        bump
    )]
    pub global_state: Account<'info, GlobalState>,

    #[account(
        mut,
        address = global_state.memo_mint
    )]
    pub memo_mint: Account<'info, Mint>,

    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

// ============================================================================
// Error Codes
// ============================================================================

#[error_code]
pub enum ErrorCode {
    #[msg("Daily minting limit of 24 ME reached. Try again tomorrow.")]
    DailyLimitReached,

    #[msg("User ID too long (max 64 bytes)")]
    UserIdTooLong,

    #[msg("Invalid amount - must be greater than 0")]
    InvalidAmount,

    #[msg("Invalid PIN")]
    InvalidPin,

    #[msg("Unauthorized user for this connection")]
    UnauthorizedUser,

    #[msg("Already unlocked")]
    AlreadyUnlocked,

    #[msg("Connection already fully unlocked")]
    ConnectionFullyUnlocked,

    #[msg("Cannot create connection with same user")]
    SameUserConnection,
}
