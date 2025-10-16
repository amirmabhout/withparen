# $ME & $MEMO Programs - Deployment & Maintenance Guide

Complete guide for deploying, updating, and maintaining the ME Token and HumanConnection programs.

---

## Current Deployment Status

### ✅ Programs Deployed on Solana Devnet

| Program | Program ID | IDL Account | Size |
|---------|-----------|-------------|------|
| **ME Token** | `CbTbi8L4kmQeHNsCVJUVRH4PCWFYBvHq7vQqPaVd3SB3` | `4kMvdDFFmx2B2PTwomG4XeKiX8i1Cw8WUg3QiNpZzyob` | 277 KB |
| **HumanConnection** | `FhdroQrark3WFM6aSG1PpESmCXee4uvMxmYvRKD9FfTN` | `GqQSFpPAXkwYUe4ERpPAkcNtYE5wzLZn6Rfnyo1AQDAq` | 385 KB |

**Deployed on:** 2025-10-15
**Wallet:** `C7yJAjCGWrxsZhbj32Zp1zeSUC77ddthxuCPyuK3drBE`
**Network:** Devnet

### Integration Status

- ✅ TypeScript SDK program IDs updated
- ✅ IDL files copied to `packages/plugin-solana/src/programs/`
- ✅ Ready for ElizaOS integration

---

## Prerequisites

### Required Tools

- **Rust**: v1.75+ (`rustc --version`)
- **Solana CLI**: v1.18+ (`solana --version`)
- **Anchor CLI**: v0.30.1+ (`anchor --version`)
- **Bun**: For TypeScript builds (`bun --version`)

### Anchor Binary Location

This repository uses a custom-built Anchor binary at:
```
/home/specialpedrito/agents/anchor/target/release/anchor
```

To use it in commands, set PATH:
```bash
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
ANCHOR=/home/specialpedrito/agents/anchor/target/release/anchor
```

---

## Building Programs

### Build ME Token

```bash
cd anchor-programs/me-token
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
/home/specialpedrito/agents/anchor/target/release/anchor build
```

Build artifacts:
- Binary: `target/deploy/me_token.so`
- IDL: `target/idl/me_token.json`
- Keypair: `target/deploy/me_token-keypair.json`

### Build HumanConnection

```bash
cd anchor-programs/human-connection
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
/home/specialpedrito/agents/anchor/target/release/anchor build
```

Build artifacts:
- Binary: `target/deploy/human_connection.so`
- IDL: `target/idl/human_connection.json`
- Keypair: `target/deploy/human_connection-keypair.json`

---

## Deploying Programs

### Configure Wallet

The deployment uses the private key from `.env` files in each program directory:

```bash
# Both programs use the same .env
cat me-token/.env
# SOLANA_PRIVATE_KEY=57soUr65RteHK9T2GGfY9hZykLvbDwmFoyJ3An8D9CDyKrc54QQiJSMsqoR3khaUbRwBU2icACct3dpjmyHFRGoE
# SOLANA_NETWORK=devnet
```

Public Key: `C7yJAjCGWrxsZhbj32Zp1zeSUC77ddthxuCPyuK3drBE`

### Check Wallet Balance

```bash
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana config set --url https://api.devnet.solana.com
solana balance
```

**Required Balance:**
- ME Token deployment: ~0.5 SOL
- HumanConnection deployment: ~2.75 SOL
- **Total recommended:** 5+ SOL (for safety margin)

### Deploy to Devnet

```bash
# Deploy ME Token
cd anchor-programs/me-token
/home/specialpedrito/agents/anchor/target/release/anchor deploy --provider.cluster devnet

# Deploy HumanConnection
cd ../human-connection
/home/specialpedrito/agents/anchor/target/release/anchor deploy --provider.cluster devnet
```

Save the Program IDs from the deployment output.

---

## Updating After Deployment

After deploying new versions of the programs, you must update program IDs in **6 locations**:

### 1. Rust Source Files

**ME Token** (`me-token/programs/me-token/src/lib.rs:4`):
```rust
declare_id!("CbTbi8L4kmQeHNsCVJUVRH4PCWFYBvHq7vQqPaVd3SB3");
```

**HumanConnection** (`human-connection/programs/human-connection/src/lib.rs:5`):
```rust
declare_id!("FhdroQrark3WFM6aSG1PpESmCXee4uvMxmYvRKD9FfTN");
```

### 2. Anchor.toml Files

**ME Token** (`me-token/Anchor.toml`):
```toml
[programs.devnet]
me_token = "CbTbi8L4kmQeHNsCVJUVRH4PCWFYBvHq7vQqPaVd3SB3"
```

**HumanConnection** (`human-connection/Anchor.toml`):
```toml
[programs.devnet]
human_connection = "FhdroQrark3WFM6aSG1PpESmCXee4uvMxmYvRKD9FfTN"
```

### 3. TypeScript SDK Files

**ME Token** (`packages/plugin-solana/src/programs/me-token.ts:9`):
```typescript
export const ME_TOKEN_PROGRAM_ID = new PublicKey('CbTbi8L4kmQeHNsCVJUVRH4PCWFYBvHq7vQqPaVd3SB3');
```

**HumanConnection** (`packages/plugin-solana/src/programs/human-connection.ts:10`):
```typescript
export const HUMAN_CONNECTION_PROGRAM_ID = new PublicKey('FhdroQrark3WFM6aSG1PpESmCXee4uvMxmYvRKD9FfTN');
```

### 4. Copy IDL Files

```bash
# Copy IDL files to TypeScript SDK
cp anchor-programs/me-token/target/idl/me_token.json \
   packages/plugin-solana/src/programs/

cp anchor-programs/human-connection/target/idl/human_connection.json \
   packages/plugin-solana/src/programs/
```

### 5. Rebuild After Updates

```bash
# Rebuild Rust programs with new IDs
cd anchor-programs/me-token && anchor build
cd ../human-connection && anchor build

# Rebuild TypeScript SDK
cd ../../packages/plugin-solana
bun install
bun run build
```

---

## Making Code Changes

### Modify Program Logic

1. **Edit Rust source:**
   ```bash
   vim me-token/programs/me-token/src/lib.rs
   # or
   vim human-connection/programs/human-connection/src/lib.rs
   ```

2. **Build to test:**
   ```bash
   cd me-token  # or human-connection
   /home/specialpedrito/agents/anchor/target/release/anchor build
   ```

3. **Deploy updated program:**
   ```bash
   /home/specialpedrito/agents/anchor/target/release/anchor deploy --provider.cluster devnet
   ```

4. **Update IDL in SDK:**
   ```bash
   cp target/idl/me_token.json ../../packages/plugin-solana/src/programs/
   # or
   cp target/idl/human_connection.json ../../packages/plugin-solana/src/programs/
   ```

### Modify TypeScript SDK

1. **Edit SDK files:**
   ```bash
   vim packages/plugin-solana/src/programs/me-token.ts
   # or
   vim packages/plugin-solana/src/programs/human-connection.ts
   ```

2. **Rebuild:**
   ```bash
   cd packages/plugin-solana
   bun run build
   ```

3. **Test integration:**
   ```bash
   bun test
   ```

---

## Common Issues & Solutions

### Issue: "String is the wrong size"

**Cause:** Account structures use variable-length `String` types instead of fixed-size arrays.

**Solution:** Use fixed-size byte arrays:
```rust
// ❌ Wrong
pub user_id: String,

// ✅ Correct
pub user_id: [u8; 64],
```

### Issue: "GLIBC version not found"

**Cause:** System GLIBC version too old for prebuilt Anchor binaries.

**Solution:** Use the local Anchor build:
```bash
/home/specialpedrito/agents/anchor/target/release/anchor build
```

### Issue: "Insufficient funds for deployment"

**Cause:** Wallet doesn't have enough SOL.

**Solutions:**
1. Request airdrop: `solana airdrop 2`
2. Transfer from another wallet
3. Use web faucet: https://faucet.solana.com/

### Issue: "init_if_needed requires feature"

**Cause:** `init-if-needed` feature not enabled in Cargo.toml.

**Solution:**
```toml
[dependencies]
anchor-lang = { version = "0.32.1", features = ["init-if-needed"] }
```

### Issue: "anchor-spl idl-build feature"

**Cause:** IDL build feature missing for anchor-spl.

**Solution:**
```toml
[features]
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]
```

---

## Testing

### Unit Tests

```bash
cd me-token
/home/specialpedrito/agents/anchor/target/release/anchor test

cd ../human-connection
/home/specialpedrito/agents/anchor/target/release/anchor test
```

### Integration Testing

Test with TypeScript SDK:
```bash
cd packages/plugin-solana
bun test
```

### Manual Testing on Devnet

```bash
# Register a user
bun scripts/test-register.ts

# Mint daily tokens
bun scripts/test-mint-daily.ts

# Create connection
bun scripts/test-connection.ts

# Submit PIN
bun scripts/test-submit-pin.ts
```

---

## Monitoring & Verification

### Check Program Deployment

```bash
# ME Token
solana program show CbTbi8L4kmQeHNsCVJUVRH4PCWFYBvHq7vQqPaVd3SB3

# HumanConnection
solana program show FhdroQrark3WFM6aSG1PpESmCXee4uvMxmYvRKD9FfTN
```

### Check IDL Accounts

```bash
# ME Token IDL
solana account 4kMvdDFFmx2B2PTwomG4XeKiX8i1Cw8WUg3QiNpZzyob

# HumanConnection IDL
solana account GqQSFpPAXkwYUe4ERpPAkcNtYE5wzLZn6Rfnyo1AQDAq
```

### View Transactions

Use Solana Explorer:
- Devnet: https://explorer.solana.com/?cluster=devnet
- Search by program ID or transaction signature

---

## Environment Configuration

### Required Environment Variables

```bash
# .env in each program directory (me-token, human-connection)
SOLANA_PRIVATE_KEY=<base58_private_key>
SOLANA_NETWORK=devnet

# For integration in packages/plugin-solana
ME_TOKEN_PROGRAM_ID=CbTbi8L4kmQeHNsCVJUVRH4PCWFYBvHq7vQqPaVd3SB3
HUMAN_CONNECTION_PROGRAM_ID=FhdroQrark3WFM6aSG1PpESmCXee4uvMxmYvRKD9FfTN
AGENT_WALLET=C7yJAjCGWrxsZhbj32Zp1zeSUC77ddthxuCPyuK3drBE
SOLANA_RPC_URL=https://api.devnet.solana.com
```

---

## Upgrading to Mainnet

When ready to deploy to mainnet:

1. **Update Anchor.toml** files:
   ```toml
   [programs.mainnet-beta]
   me_token = "<new_mainnet_program_id>"
   ```

2. **Change cluster:**
   ```bash
   solana config set --url https://api.mainnet-beta.solana.com
   ```

3. **Fund mainnet wallet** with real SOL

4. **Deploy:**
   ```bash
   anchor deploy --provider.cluster mainnet
   ```

5. **Update all 6 program ID locations** with mainnet IDs

6. **Update environment variables** to use mainnet

---

## Quick Reference Commands

```bash
# Build both programs
cd anchor-programs/me-token && anchor build
cd ../human-connection && anchor build

# Deploy both programs
cd me-token && anchor deploy --provider.cluster devnet
cd ../human-connection && anchor deploy --provider.cluster devnet

# Copy IDL files
cp me-token/target/idl/me_token.json ../packages/plugin-solana/src/programs/
cp human-connection/target/idl/human_connection.json ../packages/plugin-solana/src/programs/

# Check balance
solana balance

# View program
solana program show <PROGRAM_ID>

# Get wallet address
solana address
```

---

## Support Resources

- **Anchor Documentation:** https://www.anchor-lang.com/
- **Solana Documentation:** https://docs.solana.com/
- **Solana Explorer (Devnet):** https://explorer.solana.com/?cluster=devnet
- **Devnet Faucet:** https://faucet.solana.com/

---

**Last Updated:** 2025-10-15
**Maintainer:** ElizaOS Team
