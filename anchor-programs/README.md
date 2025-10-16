# $ME & $MEMO Tokenomics Smart Contracts

Solana smart contracts implementing a two-token system for human connections and rewards.

## Overview

This directory contains two Anchor programs that power the tokenomics for the ElizaOS connection discovery system:

### 1. ME Token Program (`me-token/`)
Personal, non-fungible currency unique to each user.

**Features:**
- Initial mint: 48 $ME tokens upon registration
- Daily minting: Up to 24 $ME per day
- Personal mint per user (each user has their own $ME tokens)
- Only PDA accounts can mint
- 24-hour reset cycle for daily limits

### 2. HumanConnection Program (`human-connection/`)
Facilitates in-person meetings and rewards with fungible $MEMO tokens.

**Features:**
- Locks 24 $ME from requesting user
- Stores PIN hashes (SHA256) for security
- Independent unlock (either user can submit PIN first)
- Rewards: 8 $MEMO per user on correct PIN
- Agent receives 8 $MEMO when both users unlock
- $MEMO tokens are fungible and tradeable

## Architecture

```
User Registration → 48 $ME (initial)
       ↓
Daily Mint → +24 $ME (max per day)
       ↓
Match Accepted → HumanConnection Created
       ↓
24 $ME Locked → PIN_A & PIN_B Generated (hashed)
       ↓
Users Meet IRL → Exchange PINs
       ↓
User A submits PIN_B → Gets 8 $MEMO
User B submits PIN_A → Gets 8 $MEMO
       ↓
Both Unlocked → Agent gets 8 $MEMO
```

## Token Properties

| Property | $ME Token | $MEMO Token |
|----------|-----------|-------------|
| Symbol | ME | MEMO |
| Decimals | 9 | 9 |
| Supply | Dynamic (per user) | Dynamic (global) |
| Transferable | Only to HumanConnection | Yes (fungible) |
| Tradeable | No | Yes |
| Mint Authority | Personal PDA | HumanConnection program |

## Directory Structure

```
anchor-programs/
├── me-token/
│   ├── programs/me-token/
│   │   ├── src/lib.rs          # ME Token program code
│   │   └── Cargo.toml
│   ├── Anchor.toml
│   └── Cargo.toml
├── human-connection/
│   ├── programs/human-connection/
│   │   ├── src/lib.rs          # HumanConnection program code
│   │   └── Cargo.toml
│   ├── Anchor.toml
│   └── Cargo.toml
├── DEPLOYMENT_GUIDE.md         # Complete deployment & integration guide
└── README.md                   # This file
```

## Quick Start

### 1. Prerequisites

- Rust v1.75+
- Solana CLI v1.18+
- Anchor CLI v0.30.1+
- Funded Solana wallet

### 2. Build Programs

```bash
# Build ME Token
cd me-token
anchor build

# Build HumanConnection
cd ../human-connection
anchor build
```

### 3. Deploy to Devnet

```bash
# Deploy ME Token
cd me-token
anchor deploy --provider.cluster devnet

# Deploy HumanConnection
cd ../human-connection
anchor deploy --provider.cluster devnet
```

### 4. Update Program IDs

After deployment, update the program IDs in:
- Program source code (`declare_id!`)
- Anchor.toml files
- TypeScript SDK files

See [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for detailed instructions.

## Integration with ElizaOS

The programs are integrated into ElizaOS via:

1. **TypeScript SDK** (`packages/plugin-solana/src/programs/`)
   - `me-token.ts` - ME token interactions
   - `human-connection.ts` - Connection and PIN management

2. **Token Service** (`packages/plugin-solana/src/services/tokenService.ts`)
   - High-level API for token operations
   - Handles registration, minting, connections, and PIN submission

3. **PIN Submission Action** (`packages/plugin-discover-connection/`)
   - User action to submit PINs
   - Automatically distributes $MEMO rewards

## Security Features

- **PIN Hashing**: PINs stored as SHA256 hashes on-chain
- **PDA Validation**: Only PDAs can mint $ME tokens
- **Daily Limits**: Prevents spam with 24 $ME/day limit
- **One-Time Unlock**: Each user can only unlock once per connection
- **Independent Verification**: Users can unlock in any order

## Testing

```bash
# Test ME Token program
cd me-token
anchor test

# Test HumanConnection program
cd human-connection
anchor test
```

## Environment Variables

```bash
# Program IDs (update after deployment)
ME_TOKEN_PROGRAM_ID=<your_deployed_program_id>
HUMAN_CONNECTION_PROGRAM_ID=<your_deployed_program_id>

# Agent Configuration
AGENT_WALLET=<agent_public_key>

# Solana Configuration
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_PRIVATE_KEY=<your_base58_private_key>
```

## Resources

- **Full Deployment Guide**: [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)
- **Anchor Documentation**: https://www.anchor-lang.com/
- **Solana Documentation**: https://docs.solana.com/
- **ElizaOS Plugin Development**: See `packages/plugin-starter/`

## Program Accounts

### ME Token Program

- **UserMeAccount**: Tracks user's ME token mint and minting history
- **ME Mint**: Personal token mint (one per user)
- **ME Wallet**: User's token account for holding ME tokens

### HumanConnection Program

- **Connection**: Stores PIN hashes and unlock status
- **Escrow**: Temporarily holds locked ME tokens
- **MEMO Mint**: Global fungible token mint
- **MEMO Wallets**: Token accounts for MEMO tokens

## Support

For issues, questions, or contributions:
1. Review the [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)
2. Check Anchor/Solana documentation
3. Open an issue in your repository

---

**Built with ❤️ for the ElizaOS ecosystem**
