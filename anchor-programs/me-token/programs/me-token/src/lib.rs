use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, MintTo};

declare_id!("CbTbi8L4kmQeHNsCVJUVRH4PCWFYBvHq7vQqPaVd3SB3");

#[program]
pub mod me_token {
    use super::*;

    const INITIAL_MINT: u64 = 48;
    const DAILY_LIMIT: u64 = 24;
    const DAY_IN_SECONDS: i64 = 86400;
    const ME_DECIMALS: u8 = 9;

    /// Register a PDA and create their personal $ME token with initial mint
    pub fn register_and_mint_initial(
        ctx: Context<RegisterUser>,
        user_id: String,
        user_id_hash: [u8; 32],
    ) -> Result<()> {
        let user_me_account = &mut ctx.accounts.user_me_account;
        let clock = Clock::get()?;

        // Copy user_id into fixed-size array
        let user_id_bytes = user_id.as_bytes();
        let mut user_id_array = [0u8; 64];
        let len = user_id_bytes.len().min(64);
        user_id_array[..len].copy_from_slice(&user_id_bytes[..len]);
        user_me_account.user_id = user_id_array;
        user_me_account.me_mint = ctx.accounts.me_mint.key();
        user_me_account.last_mint_time = clock.unix_timestamp;
        user_me_account.daily_minted_today = INITIAL_MINT;
        user_me_account.total_minted = INITIAL_MINT;
        user_me_account.bump = ctx.bumps.user_me_account;

        // Mint initial 48 $ME tokens
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
                    to: ctx.accounts.user_me_wallet.to_account_info(),
                    authority: ctx.accounts.me_mint.to_account_info(),
                },
                signer_seeds,
            ),
            INITIAL_MINT * 10u64.pow(ME_DECIMALS as u32),
        )?;

        msg!("Registered {} with {} $ME initial tokens", user_id, INITIAL_MINT);
        Ok(())
    }

    /// Mint daily $ME tokens (max 24/day with 24-hour reset)
    pub fn mint_daily(
        ctx: Context<MintDaily>,
        user_id: String,
        user_id_hash: [u8; 32],
    ) -> Result<()> {
        let user_me_account = &mut ctx.accounts.user_me_account;
        let clock = Clock::get()?;

        // Check if a new day has passed
        let time_elapsed = clock.unix_timestamp - user_me_account.last_mint_time;
        let days_passed = time_elapsed / DAY_IN_SECONDS;

        if days_passed > 0 {
            // Reset daily counter for new day
            user_me_account.daily_minted_today = 0;
            user_me_account.last_mint_time = clock.unix_timestamp;
        }

        // Check daily limit
        require!(
            user_me_account.daily_minted_today < DAILY_LIMIT,
            ErrorCode::DailyLimitReached
        );

        // Calculate how many tokens can be minted
        let available_to_mint = DAILY_LIMIT - user_me_account.daily_minted_today;
        let to_mint = available_to_mint.min(DAILY_LIMIT);

        // Mint $ME tokens
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
                    to: ctx.accounts.user_me_wallet.to_account_info(),
                    authority: ctx.accounts.me_mint.to_account_info(),
                },
                signer_seeds,
            ),
            to_mint * 10u64.pow(ME_DECIMALS as u32),
        )?;

        user_me_account.daily_minted_today += to_mint;
        user_me_account.total_minted += to_mint;

        msg!("Minted {} $ME for {} (total lifetime: {})",
             to_mint, user_id, user_me_account.total_minted);
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(user_id: String, user_id_hash: [u8; 32])]
pub struct RegisterUser<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 64 + 32 + 8 + 8 + 8 + 1,
        seeds = [b"user_me", user_id_hash.as_ref()],
        bump
    )]
    pub user_me_account: Account<'info, UserMeAccount>,

    #[account(
        init,
        payer = payer,
        mint::decimals = 9,
        mint::authority = me_mint,
        seeds = [b"me_mint", user_id_hash.as_ref()],
        bump
    )]
    pub me_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = payer,
        token::mint = me_mint,
        token::authority = payer,
        seeds = [b"me_wallet", user_id_hash.as_ref()],
        bump
    )]
    pub user_me_wallet: Account<'info, TokenAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(user_id: String, user_id_hash: [u8; 32])]
pub struct MintDaily<'info> {
    #[account(
        mut,
        seeds = [b"user_me", user_id_hash.as_ref()],
        bump = user_me_account.bump,
    )]
    pub user_me_account: Account<'info, UserMeAccount>,

    #[account(
        mut,
        seeds = [b"me_mint", user_id_hash.as_ref()],
        bump
    )]
    pub me_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"me_wallet", user_id_hash.as_ref()],
        bump
    )]
    pub user_me_wallet: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[account]
pub struct UserMeAccount {
    pub user_id: [u8; 64],         // User identifier (fixed 64 bytes)
    pub me_mint: Pubkey,           // Personal ME token mint address (32 bytes)
    pub last_mint_time: i64,       // Unix timestamp of last mint (8 bytes)
    pub daily_minted_today: u64,   // Amount minted today (8 bytes)
    pub total_minted: u64,         // Total lifetime minted (8 bytes)
    pub bump: u8,                  // PDA bump seed (1 byte)
}

#[error_code]
pub enum ErrorCode {
    #[msg("Daily minting limit of 24 $ME reached. Try again tomorrow.")]
    DailyLimitReached,

    #[msg("User ID too long (max 64 bytes)")]
    UserIdTooLong,
}
