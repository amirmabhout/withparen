use anchor_lang::prelude::*;

declare_id!("11111111111111111111111111111111"); // Will be replaced when deployed

#[program]
pub mod user_pda {
    use super::*;

    /// Create a PDA wallet for a user based on platform and user ID
    pub fn create_user_wallet(
        ctx: Context<CreateUserWallet>,
        platform: String,
        user_id: String,
    ) -> Result<()> {
        let user_wallet = &mut ctx.accounts.user_wallet;
        user_wallet.platform = platform.clone();
        user_wallet.user_id = user_id.clone();
        user_wallet.created_at = Clock::get()?.unix_timestamp;
        user_wallet.bump = ctx.bumps.user_wallet;

        msg!(
            "Created PDA wallet for {}:{} at address {}",
            platform,
            user_id,
            ctx.accounts.user_wallet.key()
        );
        Ok(())
    }

    /// Update wallet metadata (future use)
    pub fn update_wallet_metadata(
        ctx: Context<UpdateWallet>,
        metadata: String,
    ) -> Result<()> {
        let user_wallet = &mut ctx.accounts.user_wallet;
        user_wallet.metadata = metadata;
        user_wallet.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(platform: String, user_id: String)]
pub struct CreateUserWallet<'info> {
    #[account(
        init,
        payer = payer,
        space = UserWallet::SPACE,
        seeds = [b"user", platform.as_bytes(), user_id.as_bytes()],
        bump
    )]
    pub user_wallet: Account<'info, UserWallet>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction()]
pub struct UpdateWallet<'info> {
    #[account(
        mut,
        seeds = [b"user", user_wallet.platform.as_bytes(), user_wallet.user_id.as_bytes()],
        bump = user_wallet.bump,
    )]
    pub user_wallet: Account<'info, UserWallet>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[account]
pub struct UserWallet {
    pub platform: String,      // "telegram", "discord", etc. (32 bytes max)
    pub user_id: String,       // Platform-specific user ID (32 bytes max)
    pub created_at: i64,       // Unix timestamp
    pub updated_at: i64,       // Unix timestamp
    pub metadata: String,      // Optional metadata (64 bytes max)
    pub bump: u8,              // PDA bump seed
}

impl UserWallet {
    // Calculate space: 8 (discriminator) + 32 (platform) + 32 (user_id) + 8 (created_at)
    // + 8 (updated_at) + 64 (metadata) + 1 (bump) = 153
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 64 + 1;
}

#[error_code]
pub enum ErrorCode {
    #[msg("Platform name too long (max 32 bytes)")]
    PlatformTooLong,

    #[msg("User ID too long (max 32 bytes)")]
    UserIdTooLong,

    #[msg("Metadata too long (max 64 bytes)")]
    MetadataTooLong,
}