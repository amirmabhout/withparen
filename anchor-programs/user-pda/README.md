# User PDA Anchor Program

## Setup

### Environment Variables

This project uses environment variables to securely store sensitive data like private keys.

1. Copy the `.env.example` file to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your actual private key:
   ```
   SOLANA_PRIVATE_KEY=your_actual_private_key_here
   SOLANA_NETWORK=devnet
   ```

3. **IMPORTANT**: Never commit the `.env` file to git. It's already in `.gitignore`.

### Running the Setup Wallet Script

To setup your Solana wallet:

```bash
bun run setup-wallet.ts
```

This will:
- Read your private key from the `.env` file
- Create a wallet file at `~/.config/solana/id.json`
- Configure the Solana CLI

## Security Notes

- All sensitive data should be stored in `.env` files
- `.env` files are automatically ignored by git
- Only `.env.example` files (without actual secrets) should be committed
- Keypair JSON files in `target/deploy/` are build artifacts and are gitignored
