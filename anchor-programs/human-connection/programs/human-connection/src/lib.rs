use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, MintTo, Transfer};
use sha2::{Sha256, Digest};

declare_id!("FhdroQrark3WFM6aSG1PpESmCXee4uvMxmYvRKD9FfTN");

#[program]
pub mod human_connection {
    use super::*;

    const ME_LOCK_AMOUNT: u64 = 24;
    const MEMO_REWARD_AMOUNT: u64 = 8;
    const MEMO_DECIMALS: u8 = 9;
    const ME_DECIMALS: u8 = 9;

    /// Initialize a connection between two users with PIN hashes
    /// Locks 24 $ME from user A and stores PIN hashes for verification
    pub fn initialize_connection(
        ctx: Context<InitConnection>,
        connection_id: String,
        connection_id_hash: [u8; 32],
        user_a_id: String,
        user_b_id: String,
        pin_a_hash: [u8; 32],  // SHA256 hash of PIN A
        pin_b_hash: [u8; 32],  // SHA256 hash of PIN B
    ) -> Result<()> {
        let connection = &mut ctx.accounts.connection;
        let clock = Clock::get()?;

        connection.connection_id = connection_id.clone();
        connection.user_a = ctx.accounts.user_a_pda.key();
        connection.user_b = ctx.accounts.user_b_pda.key();
        connection.user_a_id = user_a_id.clone();
        connection.user_b_id = user_b_id.clone();
        connection.pin_a_hash = pin_a_hash;
        connection.pin_b_hash = pin_b_hash;
        connection.user_a_unlocked = false;
        connection.user_b_unlocked = false;
        connection.created_at = clock.unix_timestamp;
        connection.bump = ctx.bumps.connection;

        // Transfer 24 $ME from user A to escrow
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_a_me_wallet.to_account_info(),
                    to: ctx.accounts.escrow_me_wallet.to_account_info(),
                    authority: ctx.accounts.user_a_authority.to_account_info(),
                },
            ),
            ME_LOCK_AMOUNT * 10u64.pow(ME_DECIMALS as u32),
        )?;

        msg!("Connection {} initialized with 24 $ME locked from {}",
             connection_id, user_a_id);
        Ok(())
    }

    /// User submits the OTHER person's PIN to unlock their $MEMO reward
    /// Contract hashes the submitted PIN and compares with stored hash
    pub fn unlock_with_pin(
        ctx: Context<UnlockWithPin>,
        connection_id: String,
        connection_id_hash: [u8; 32],
        submitted_pin: String,
    ) -> Result<()> {
        let connection = &mut ctx.accounts.connection;
        let user_pubkey = ctx.accounts.user_pda.key();

        // Hash the submitted PIN using SHA256
        let mut hasher = Sha256::new();
        hasher.update(submitted_pin.as_bytes());
        let result = hasher.finalize();
        let submitted_hash: [u8; 32] = result.into();

        // Determine which user is unlocking
        let is_user_a = user_pubkey == connection.user_a;

        if is_user_a {
            // User A submits User B's PIN
            require!(
                submitted_hash == connection.pin_b_hash,
                ErrorCode::InvalidPin
            );
            require!(
                !connection.user_a_unlocked,
                ErrorCode::AlreadyUnlocked
            );

            connection.user_a_unlocked = true;

            // Mint 8 $MEMO to User A
            let memo_mint_bump = ctx.bumps.memo_mint;
            let seeds = &[
                b"memo_mint".as_ref(),
                &[memo_mint_bump],
            ];
            let signer_seeds = &[&seeds[..]];

            token::mint_to(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    MintTo {
                        mint: ctx.accounts.memo_mint.to_account_info(),
                        to: ctx.accounts.user_memo_wallet.to_account_info(),
                        authority: ctx.accounts.memo_mint.to_account_info(),
                    },
                    signer_seeds,
                ),
                MEMO_REWARD_AMOUNT * 10u64.pow(MEMO_DECIMALS as u32),
            )?;

            msg!("User A ({}) unlocked with correct PIN! Received {} $MEMO",
                 connection.user_a_id, MEMO_REWARD_AMOUNT);
        } else {
            // User B submits User A's PIN
            require!(
                user_pubkey == connection.user_b,
                ErrorCode::UnauthorizedUser
            );
            require!(
                submitted_hash == connection.pin_a_hash,
                ErrorCode::InvalidPin
            );
            require!(
                !connection.user_b_unlocked,
                ErrorCode::AlreadyUnlocked
            );

            connection.user_b_unlocked = true;

            // Mint 8 $MEMO to User B
            let memo_mint_bump = ctx.bumps.memo_mint;
            let seeds = &[
                b"memo_mint".as_ref(),
                &[memo_mint_bump],
            ];
            let signer_seeds = &[&seeds[..]];

            token::mint_to(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    MintTo {
                        mint: ctx.accounts.memo_mint.to_account_info(),
                        to: ctx.accounts.user_memo_wallet.to_account_info(),
                        authority: ctx.accounts.memo_mint.to_account_info(),
                    },
                    signer_seeds,
                ),
                MEMO_REWARD_AMOUNT * 10u64.pow(MEMO_DECIMALS as u32),
            )?;

            msg!("User B ({}) unlocked with correct PIN! Received {} $MEMO",
                 connection.user_b_id, MEMO_REWARD_AMOUNT);
        }

        // If both users have unlocked, mint 8 $MEMO to agent
        if connection.user_a_unlocked && connection.user_b_unlocked {
            let memo_mint_bump = ctx.bumps.memo_mint;
            let seeds = &[
                b"memo_mint".as_ref(),
                &[memo_mint_bump],
            ];
            let signer_seeds = &[&seeds[..]];

            token::mint_to(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    MintTo {
                        mint: ctx.accounts.memo_mint.to_account_info(),
                        to: ctx.accounts.agent_memo_wallet.to_account_info(),
                        authority: ctx.accounts.memo_mint.to_account_info(),
                    },
                    signer_seeds,
                ),
                MEMO_REWARD_AMOUNT * 10u64.pow(MEMO_DECIMALS as u32),
            )?;

            msg!("Both users unlocked! Agent received {} $MEMO. Connection {} complete!",
                 MEMO_REWARD_AMOUNT, connection_id);
        }

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(connection_id: String, connection_id_hash: [u8; 32], user_a_id: String, user_b_id: String)]
pub struct InitConnection<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 4 + 64 + 32 + 32 + 4 + 64 + 4 + 64 + 32 + 32 + 1 + 1 + 8 + 1,
        seeds = [b"connection", connection_id_hash.as_ref()],
        bump
    )]
    pub connection: Account<'info, Connection>,

    /// CHECK: User A PDA (validated via constraints)
    pub user_a_pda: UncheckedAccount<'info>,

    /// CHECK: User B PDA (validated via constraints)
    pub user_b_pda: UncheckedAccount<'info>,

    #[account(mut)]
    pub user_a_me_wallet: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = payer,
        token::mint = user_a_me_mint,
        token::authority = connection,
        seeds = [b"escrow", connection_id_hash.as_ref()],
        bump
    )]
    pub escrow_me_wallet: Account<'info, TokenAccount>,

    pub user_a_me_mint: Account<'info, Mint>,

    /// User A's authority (signer for token transfer)
    pub user_a_authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(connection_id: String, connection_id_hash: [u8; 32])]
pub struct UnlockWithPin<'info> {
    #[account(
        mut,
        seeds = [b"connection", connection_id_hash.as_ref()],
        bump = connection.bump,
    )]
    pub connection: Account<'info, Connection>,

    /// CHECK: User PDA submitting PIN
    pub user_pda: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        mint::decimals = 9,
        mint::authority = memo_mint,
        seeds = [b"memo_mint"],
        bump
    )]
    pub memo_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = payer,
        token::mint = memo_mint,
        token::authority = user_pda,
        seeds = [b"memo_wallet", user_pda.key().as_ref()],
        bump
    )]
    pub user_memo_wallet: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = payer,
        token::mint = memo_mint,
        token::authority = agent,
        seeds = [b"agent_memo_wallet", agent.key().as_ref()],
        bump
    )]
    pub agent_memo_wallet: Account<'info, TokenAccount>,

    /// CHECK: Agent wallet address (receives rewards)
    pub agent: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[account]
pub struct Connection {
    pub connection_id: String,       // Unique connection ID (max 64 bytes)
    pub user_a: Pubkey,              // User A PDA (32 bytes)
    pub user_b: Pubkey,              // User B PDA (32 bytes)
    pub user_a_id: String,           // User A ID string (max 64 bytes)
    pub user_b_id: String,           // User B ID string (max 64 bytes)
    pub pin_a_hash: [u8; 32],        // SHA256 hash of PIN A (32 bytes)
    pub pin_b_hash: [u8; 32],        // SHA256 hash of PIN B (32 bytes)
    pub user_a_unlocked: bool,       // User A unlock status (1 byte)
    pub user_b_unlocked: bool,       // User B unlock status (1 byte)
    pub created_at: i64,             // Creation timestamp (8 bytes)
    pub bump: u8,                    // PDA bump seed (1 byte)
}

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid PIN provided")]
    InvalidPin,

    #[msg("You have already unlocked this connection")]
    AlreadyUnlocked,

    #[msg("Unauthorized user for this connection")]
    UnauthorizedUser,

    #[msg("Connection ID too long")]
    ConnectionIdTooLong,
}
