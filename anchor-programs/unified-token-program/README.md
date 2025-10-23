# Unified Token Program

A simplified, unified Solana program that replaces the fragmented PDA wallet, ME token, and Human Connection programs with a single, efficient implementation.

## Architecture Overview

### Design Goals
- **One PDA per user** - Simple, clean account structure
- **Standard ATAs** - Uses Associated Token Accounts for SPL tokens
- **Single program** - Easier maintenance and lower deployment costs
- **Lower rent** - Fewer accounts = lower costs
- **Standard patterns** - Compatible with wallets and explorers

## Token Economics

### $ME Token (Semi-Fungible)
- **Personal tokens**: Each user has their own unique ME token mint
- **Initial mint**: 48 $ME tokens upon registration
- **Daily limit**: 24 $ME tokens per day
- **Lockable**: Can be locked for $MEMO rewards
- **Transferable**: Standard SPL token behavior

### $MEMO Token (Fungible)
- **Global mint**: Single token mint shared by all users
- **Earning methods**:
  - Lock $ME tokens (1:1 ratio)
  - Complete human connections (8 $MEMO per connection)
- **Freely transferable**: Standard fungible token

## Account Structure

###Per User

```
User PDA Account
├── Seeds: ["user", sha256(user_id)]
├── Data: UserAccount struct
│   ├── user_id: [u8; 64]
│   ├── me_mint: Pubkey (personal ME mint)
│   ├── last_mint_time: i64
│   ├── daily_minted_today: u64
│   ├── total_me_minted: u64
│   ├── total_me_locked: u64
│   ├── total_memo_earned: u64
│   └── connections_count: u64
│
├── ME Mint (Personal)
│   ├── Seeds: ["me_mint", sha256(user_id)]
│   ├── Authority: Self (PDA)
│   └── Decimals: 9
│
├── ME Token Account (ATA)
│   ├── Mint: User's personal ME mint
│   ├── Authority: User's wallet
│   └── Balance: User's ME tokens
│
└── MEMO Token Account (ATA)
    ├── Mint: Global MEMO mint
    ├── Authority: User's wallet
    └── Balance: User's MEMO tokens
```

### Global State

```
Global State PDA
├── Seeds: ["global_state"]
├── Data:
│   ├── memo_mint: Pubkey
│   ├── me_escrow: Pubkey
│   ├── admin: Pubkey
│   ├── total_users: u64
│   └── total_connections: u64
│
├── MEMO Mint
│   ├── Seeds: ["memo_mint"]
│   ├── Authority: Global State PDA
│   └── Decimals: 9
│
└── ME Escrow
    ├── Seeds: ["me_escrow"]
    ├── Mint: Various user ME mints
    └── Purpose: Holds locked ME tokens
```

### Connection Accounts

```
Connection PDA
├── Seeds: ["connection", connection_id]
├── Data:
│   ├── connection_id: [u8; 64]
│   ├── user_a: Pubkey
│   ├── user_b: Pubkey
│   ├── pin_a_hash: [u8; 32] (SHA256)
│   ├── pin_b_hash: [u8; 32] (SHA256)
│   ├── user_a_unlocked: bool
│   ├── user_b_unlocked: bool
│   └── created_at: i64
```

## Instructions

### 1. `initialize_global`
Initialize the program's global state and MEMO mint.

**Accounts**:
- `global_state` (init, PDA)
- `memo_mint` (init, PDA)
- `me_escrow` (init, PDA, token account)
- `admin` (signer, payer)

**One-time setup** by program administrator.

### 2. `initialize_user`
Create a user account with PDA, personal ME mint, and token accounts. Mints initial 48 $ME.

**Parameters**:
- `user_id`: String (e.g., "telegram:user123")
- `user_id_hash`: [u8; 32] (SHA256 of user_id)

**Accounts Created**:
- User PDA account
- Personal ME mint
- ME token ATA
- MEMO token ATA

**Initial state**:
- 48 $ME minted to user's ME ATA
- Ready for daily minting

### 3. `mint_daily_me`
Mint daily $ME tokens (up to 24 per day).

**Parameters**:
- `user_id`: String
- `user_id_hash`: [u8; 32]

**Logic**:
- Checks if 24 hours passed since last mint
- Resets daily counter if new day
- Mints up to 24 $ME tokens
- Updates user account state

### 4. `lock_me_for_memo`
Lock $ME tokens in escrow and receive $MEMO tokens (1:1 ratio).

**Parameters**:
- `amount`: u64 (number of tokens, will be multiplied by 10^9)

**Flow**:
1. Transfers ME tokens from user ATA to escrow
2. Mints MEMO tokens to user's MEMO ATA
3. Updates user statistics

### 5. `create_connection`
Create a human verification connection between two users.

**Parameters**:
- `connection_id`: String (unique identifier)
- `user_a_id`: String
- `user_b_id`: String
- `pin_a_hash`: [u8; 32] (SHA256 hash of PIN A)
- `pin_b_hash`: [u8; 32] (SHA256 hash of PIN B)

**Validation**:
- Users must be different
- Connection ID must be unique

**Creates**: Connection PDA with stored PIN hashes

### 6. `unlock_connection`
Unlock a connection by submitting the other user's PIN.

**Parameters**:
- `pin`: [u8; 4] (4-digit PIN)

**Logic**:
1. Hashes submitted PIN with SHA256
2. Verifies against stored hash
3. User A unlocks with User B's PIN (and vice versa)
4. Mints 8 $MEMO to unlocking user
5. Updates connection state

**Reward**: 8 $MEMO per successful unlock

## Building & Deployment

### Build

```bash
cd anchor-programs/unified-token-program
anchor build
```

### Test

```bash
anchor test
```

### Deploy to Devnet

```bash
anchor deploy --provider.cluster devnet
```

### Update Program ID

After deployment, update the program ID in:
1. `lib.rs` - `declare_id!("...")`
2. `Anchor.toml` - `[programs.devnet]`

## Usage Example (TypeScript)

```typescript
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { createHash } from 'crypto';

// Helper: Hash user ID
function hashUserId(userId: string): Buffer {
  return createHash('sha256').update(userId).digest();
}

// 1. Initialize User
const userId = "telegram:user123";
const userIdHash = Array.from(hashUserId(userId));

await program.methods
  .initializeUser(userId, userIdHash)
  .accounts({
    userAccount, // Derived PDA
    meMint,      // Derived PDA
    userMeAta,   // Derived ATA
    userMemoAta, // Derived ATA
    globalState,
    memoMint,
    payer: wallet.publicKey,
  })
  .rpc();

// 2. Mint Daily ME
await program.methods
  .mintDailyMe(userId, userIdHash)
  .accounts({
    userAccount,
    meMint,
    userMeAta,
    payer: wallet.publicKey,
  })
  .rpc();

// 3. Lock ME for MEMO
await program.methods
  .lockMeForMemo(new BN(10)) // Lock 10 ME
  .accounts({
    userAccount,
    userMeAta,
    userMemoAta,
    globalState,
    memoMint,
    meEscrow,
    meMint,
    payer: wallet.publicKey,
  })
  .rpc();

// 4. Create Connection
const connectionId = `${userAId}-${userBId}`;
const pinA = "1234";
const pinB = "5678";
const pinAHash = Array.from(createHash('sha256').update(pinA).digest());
const pinBHash = Array.from(createHash('sha256').update(pinB).digest());

await program.methods
  .createConnection(connectionId, userAId, userBId, pinAHash, pinBHash)
  .accounts({
    connectionAccount,
    userAAccount,
    userBAccount,
    globalState,
    payer: wallet.publicKey,
  })
  .rpc();

// 5. Unlock Connection
const submittedPin = Buffer.from([0x35, 0x36, 0x37, 0x38]); // "5678"

await program.methods
  .unlockConnection(Array.from(submittedPin))
  .accounts({
    connectionAccount,
    userAccount,
    userMemoAta,
    globalState,
    memoMint,
    payer: wallet.publicKey,
  })
  .rpc();
```

## Security Considerations

### PIN Hashing
- PINs are hashed with SHA256 before storage
- Only hashes are stored on-chain
- Users submit raw PINs which are hashed and compared

### Access Control
- Users can only unlock connections they're part of
- Users must submit the OTHER person's PIN
- Double-unlock prevention (can't unlock twice)

### Rate Limiting
- Daily ME minting limited to 24 tokens
- 24-hour cooldown between mints

## Migration from Old Programs

### Old Architecture (3 programs)
```
user-pda (Generic PDA)
├── One PDA per user
└── No tokens

me-token (ME Token Program)
├── UserMeAccount PDA
├── ME Mint PDA
└── ME Wallet PDA

human-connection (Connection Program)
├── Connection PDA
└── PIN verification
```

### New Architecture (1 program)
```
unified-token-program
├── User PDA (combines user-pda + me-token UserAccount)
├── Personal ME Mint
├── ME Token ATA
├── MEMO Token ATA
├── Connection PDA
└── Global State
```

### Benefits
- **4+ accounts → 2-3 accounts** per user
- **3 programs → 1 program**
- **Lower rent costs** (fewer accounts)
- **Simpler client code** (one program to interact with)
- **Standard token patterns** (ATAs instead of custom PDAs)

## Constants

```rust
INITIAL_ME_MINT: 48 tokens
DAILY_ME_LIMIT: 24 tokens
DAY_IN_SECONDS: 86400
TOKEN_DECIMALS: 9
CONNECTION_MEMO_REWARD: 8 tokens
```

## Error Codes

- `DailyLimitReached` - Daily minting limit of 24 ME reached
- `UserIdTooLong` - User ID exceeds 64 bytes
- `InvalidAmount` - Amount must be greater than 0
- `InvalidPin` - Submitted PIN doesn't match
- `UnauthorizedUser` - User not part of connection
- `AlreadyUnlocked` - User already unlocked this connection
- `ConnectionFullyUnlocked` - Both users already unlocked
- `SameUserConnection` - Cannot create connection with same user

## Program ID

**Devnet**: `GXnod1W71vzjuFkXHxwQ2dkBe7t1auJMtwMQYL67ytVt`

_(Update after deployment)_

## Next Steps

1. ✅ Program implementation complete
2. ⏳ Write comprehensive Rust tests
3. ⏳ Create TypeScript SDK
4. ⏳ Deploy to devnet
5. ⏳ Integrate with ElizaOS plugin
6. ⏳ Test end-to-end flows
7. ⏳ Deploy to mainnet

---

## License

MIT

## Contributing

This is part of the ElizaOS project. See main repository for contribution guidelines.
