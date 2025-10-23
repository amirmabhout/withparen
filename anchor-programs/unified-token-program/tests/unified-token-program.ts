import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { UnifiedTokenProgram } from "../target/types/unified_token_program";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount
} from "@solana/spl-token";
import { createHash } from "crypto";
import { assert } from "chai";

describe("unified-token-program", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.UnifiedTokenProgram as Program<UnifiedTokenProgram>;

  // Admin/payer
  const admin = provider.wallet as anchor.Wallet;

  // Test users
  const userAId = "telegram:alice123";
  const userBId = "telegram:bob456";

  // Helper function: Hash user ID
  function hashUserId(userId: string): Buffer {
    return createHash('sha256').update(userId).digest();
  }

  // Helper function: Derive user PDA
  function deriveUserPDA(userId: string): [PublicKey, number] {
    const userIdHash = hashUserId(userId);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("user"), userIdHash],
      program.programId
    );
  }

  // Helper function: Derive ME mint PDA
  function deriveMeMintPDA(userId: string): [PublicKey, number] {
    const userIdHash = hashUserId(userId);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("me_mint"), userIdHash],
      program.programId
    );
  }

  // Helper function: Hash PIN
  function hashPin(pin: string): Buffer {
    return createHash('sha256').update(pin).digest();
  }

  // Global PDAs
  let globalState: PublicKey;
  let memoMint: PublicKey;
  let meEscrow: PublicKey;

  before("Derive global PDAs", async () => {
    [globalState] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_state")],
      program.programId
    );

    [memoMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("memo_mint")],
      program.programId
    );

    [meEscrow] = PublicKey.findProgramAddressSync(
      [Buffer.from("me_escrow")],
      program.programId
    );

    console.log("Program ID:", program.programId.toString());
    console.log("Global State:", globalState.toString());
    console.log("MEMO Mint:", memoMint.toString());
    console.log("ME Escrow:", meEscrow.toString());
  });

  describe("1. Initialize Global State", () => {
    it("Should initialize global state with MEMO mint and escrow", async () => {
      try {
        const tx = await program.methods
          .initializeGlobal()
          .accounts({
            globalState,
            memoMint,
            meEscrow,
            admin: admin.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .rpc();

        console.log("Initialize global tx:", tx);

        // Verify global state
        const globalStateAccount = await program.account.globalState.fetch(globalState);
        assert.equal(globalStateAccount.memoMint.toString(), memoMint.toString());
        assert.equal(globalStateAccount.meEscrow.toString(), meEscrow.toString());
        assert.equal(globalStateAccount.admin.toString(), admin.publicKey.toString());
        assert.equal(globalStateAccount.totalUsers.toNumber(), 0);
        assert.equal(globalStateAccount.totalConnections.toNumber(), 0);

        console.log("✓ Global state initialized successfully");
      } catch (error) {
        console.error("Error:", error);
        throw error;
      }
    });
  });

  describe("2. Initialize User A", () => {
    let userAPDA: PublicKey;
    let userAMeMint: PublicKey;
    let userAMeAta: PublicKey;
    let userAMemoAta: PublicKey;

    it("Should create user with PDA, ME mint, and token accounts", async () => {
      const userIdHash = Array.from(hashUserId(userAId));

      [userAPDA] = deriveUserPDA(userAId);
      [userAMeMint] = deriveMeMintPDA(userAId);

      userAMeAta = await getAssociatedTokenAddress(
        userAMeMint,
        admin.publicKey
      );

      userAMemoAta = await getAssociatedTokenAddress(
        memoMint,
        admin.publicKey
      );

      const tx = await program.methods
        .initializeUser(userAId, userIdHash)
        .accounts({
          userAccount: userAPDA,
          meMint: userAMeMint,
          userMeAta: userAMeAta,
          userMemoAta: userAMemoAta,
          globalState,
          memoMint,
          payer: admin.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      console.log("Initialize user A tx:", tx);

      // Verify user account
      const userAccount = await program.account.userAccount.fetch(userAPDA);
      assert.equal(userAccount.meMint.toString(), userAMeMint.toString());
      assert.equal(userAccount.totalMeMinted.toNumber(), 48);
      assert.equal(userAccount.dailyMintedToday.toNumber(), 48);

      // Verify ME token balance (48 with 9 decimals)
      const meTokenAccount = await getAccount(provider.connection, userAMeAta);
      assert.equal(meTokenAccount.amount.toString(), (48 * 1e9).toString());

      // Verify MEMO token balance (should be 0)
      const memoTokenAccount = await getAccount(provider.connection, userAMemoAta);
      assert.equal(memoTokenAccount.amount.toString(), "0");

      // Verify global state updated
      const globalStateAccount = await program.account.globalState.fetch(globalState);
      assert.equal(globalStateAccount.totalUsers.toNumber(), 1);

      console.log("✓ User A initialized with 48 ME tokens");
    });
  });

  describe("3. Initialize User B", () => {
    let userBPDA: PublicKey;
    let userBMeMint: PublicKey;
    let userBMeAta: PublicKey;
    let userBMemoAta: PublicKey;

    it("Should create second user", async () => {
      const userIdHash = Array.from(hashUserId(userBId));

      [userBPDA] = deriveUserPDA(userBId);
      [userBMeMint] = deriveMeMintPDA(userBId);

      userBMeAta = await getAssociatedTokenAddress(
        userBMeMint,
        admin.publicKey
      );

      userBMemoAta = await getAssociatedTokenAddress(
        memoMint,
        admin.publicKey
      );

      const tx = await program.methods
        .initializeUser(userBId, userIdHash)
        .accounts({
          userAccount: userBPDA,
          meMint: userBMeMint,
          userMeAta: userBMeAta,
          userMemoAta: userBMemoAta,
          globalState,
          memoMint,
          payer: admin.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      console.log("Initialize user B tx:", tx);

      // Verify global state updated
      const globalStateAccount = await program.account.globalState.fetch(globalState);
      assert.equal(globalStateAccount.totalUsers.toNumber(), 2);

      console.log("✓ User B initialized");
    });
  });

  describe("4. Mint Daily ME Tokens", () => {
    it("Should fail to mint more ME on same day (daily limit)", async () => {
      const userIdHash = Array.from(hashUserId(userAId));
      const [userAPDA] = deriveUserPDA(userAId);
      const [userAMeMint] = deriveMeMintPDA(userAId);
      const userAMeAta = await getAssociatedTokenAddress(userAMeMint, admin.publicKey);

      try {
        await program.methods
          .mintDailyMe(userAId, userIdHash)
          .accounts({
            userAccount: userAPDA,
            meMint: userAMeMint,
            userMeAta: userAMeAta,
            payer: admin.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();

        assert.fail("Should have failed due to daily limit");
      } catch (error) {
        assert.include(error.toString(), "DailyLimitReached");
        console.log("✓ Correctly rejected minting beyond daily limit");
      }
    });
  });

  describe("5. Lock ME for MEMO", () => {
    it("Should lock 10 ME and receive 10 MEMO", async () => {
      const userIdHash = Array.from(hashUserId(userAId));
      const [userAPDA] = deriveUserPDA(userAId);
      const [userAMeMint] = deriveMeMintPDA(userAId);
      const userAMeAta = await getAssociatedTokenAddress(userAMeMint, admin.publicKey);
      const userAMemoAta = await getAssociatedTokenAddress(memoMint, admin.publicKey);

      // Get balances before
      const meBeforeAccount = await getAccount(provider.connection, userAMeAta);
      const meBalanceBefore = Number(meBeforeAccount.amount) / 1e9;

      const memoBeforeAccount = await getAccount(provider.connection, userAMemoAta);
      const memoBalanceBefore = Number(memoBeforeAccount.amount) / 1e9;

      // Lock 10 ME for 10 MEMO
      const tx = await program.methods
        .lockMeForMemo(userIdHash, new BN(10))
        .accounts({
          userAccount: userAPDA,
          userMeAta: userAMeAta,
          userMemoAta: userAMemoAta,
          globalState,
          memoMint,
          meEscrow,
          meMint: userAMeMint,
          payer: admin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      console.log("Lock ME for MEMO tx:", tx);

      // Get balances after
      const meAfterAccount = await getAccount(provider.connection, userAMeAta);
      const meBalanceAfter = Number(meAfterAccount.amount) / 1e9;

      const memoAfterAccount = await getAccount(provider.connection, userAMemoAta);
      const memoBalanceAfter = Number(memoAfterAccount.amount) / 1e9;

      // Verify balances changed correctly
      assert.equal(meBalanceBefore - meBalanceAfter, 10, "Should have locked 10 ME");
      assert.equal(memoBalanceAfter - memoBalanceBefore, 10, "Should have received 10 MEMO");

      // Verify user account updated
      const userAccount = await program.account.userAccount.fetch(userAPDA);
      assert.equal(userAccount.totalMeLocked.toNumber(), 10);
      assert.equal(userAccount.totalMemoEarned.toNumber(), 10);

      console.log("✓ Successfully locked 10 ME and received 10 MEMO");
    });
  });

  describe("6. Create Connection", () => {
    let connectionPDA: PublicKey;
    const connectionId = `${userAId}-${userBId}`;
    const pinA = "1234";
    const pinB = "5678";

    it("Should create connection between User A and User B", async () => {
      const [userAPDA] = deriveUserPDA(userAId);
      const [userBPDA] = deriveUserPDA(userBId);

      [connectionPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("connection"), Buffer.from(connectionId)],
        program.programId
      );

      const pinAHash = Array.from(hashPin(pinA));
      const pinBHash = Array.from(hashPin(pinB));

      const tx = await program.methods
        .createConnection(connectionId, userAId, userBId, pinAHash, pinBHash)
        .accounts({
          connectionAccount: connectionPDA,
          userAAccount: userAPDA,
          userBAccount: userBPDA,
          globalState,
          payer: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Create connection tx:", tx);

      // Verify connection created
      const connection = await program.account.connectionAccount.fetch(connectionPDA);
      assert.equal(connection.userA.toString(), userAPDA.toString());
      assert.equal(connection.userB.toString(), userBPDA.toString());
      assert.equal(connection.userAUnlocked, false);
      assert.equal(connection.userBUnlocked, false);

      // Verify global state updated
      const globalStateAccount = await program.account.globalState.fetch(globalState);
      assert.equal(globalStateAccount.totalConnections.toNumber(), 1);

      console.log("✓ Connection created successfully");
    });

    it("Should unlock connection with correct PIN and mint MEMO reward", async () => {
      const [userAPDA] = deriveUserPDA(userAId);
      const userAMemoAta = await getAssociatedTokenAddress(memoMint, admin.publicKey);

      // Get MEMO balance before
      const memoBeforeAccount = await getAccount(provider.connection, userAMemoAta);
      const memoBalanceBefore = Number(memoBeforeAccount.amount) / 1e9;

      // User A unlocks with User B's PIN ("5678")
      const pinToSubmit = Buffer.from([0x35, 0x36, 0x37, 0x38]); // ASCII "5678"

      const tx = await program.methods
        .unlockConnection(Array.from(pinToSubmit))
        .accounts({
          connectionAccount: connectionPDA,
          userAccount: userAPDA,
          userMemoAta: userAMemoAta,
          globalState,
          memoMint,
          payer: admin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      console.log("Unlock connection tx:", tx);

      // Verify connection unlocked
      const connection = await program.account.connectionAccount.fetch(connectionPDA);
      assert.equal(connection.userAUnlocked, true);
      assert.equal(connection.userBUnlocked, false); // User B hasn't unlocked yet

      // Verify MEMO reward (8 tokens)
      const memoAfterAccount = await getAccount(provider.connection, userAMemoAta);
      const memoBalanceAfter = Number(memoAfterAccount.amount) / 1e9;
      assert.equal(memoBalanceAfter - memoBalanceBefore, 8, "Should have received 8 MEMO reward");

      // Verify user account updated
      const userAccount = await program.account.userAccount.fetch(userAPDA);
      assert.equal(userAccount.totalMemoEarned.toNumber(), 18); // 10 from locking + 8 from connection
      assert.equal(userAccount.connectionsCount.toNumber(), 1);

      console.log("✓ Connection unlocked and 8 MEMO reward minted");
    });

    it("Should fail to unlock twice", async () => {
      const [userAPDA] = deriveUserPDA(userAId);
      const userAMemoAta = await getAssociatedTokenAddress(memoMint, admin.publicKey);

      const pinToSubmit = Buffer.from([0x35, 0x36, 0x37, 0x38]);

      try {
        await program.methods
          .unlockConnection(Array.from(pinToSubmit))
          .accounts({
            connectionAccount: connectionPDA,
            userAccount: userAPDA,
            userMemoAta: userAMemoAta,
            globalState,
            memoMint,
            payer: admin.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();

        assert.fail("Should have failed - already unlocked");
      } catch (error) {
        assert.include(error.toString(), "AlreadyUnlocked");
        console.log("✓ Correctly rejected double unlock");
      }
    });
  });

  describe("7. Summary", () => {
    it("Should display final state", async () => {
      const [userAPDA] = deriveUserPDA(userAId);
      const [userBPDA] = deriveUserPDA(userBId);

      const userA = await program.account.userAccount.fetch(userAPDA);
      const userB = await program.account.userAccount.fetch(userBPDA);
      const global = await program.account.globalState.fetch(globalState);

      console.log("\n=== FINAL STATE ===");
      console.log("Global:");
      console.log("  Total Users:", global.totalUsers.toNumber());
      console.log("  Total Connections:", global.totalConnections.toNumber());

      console.log("\nUser A:");
      console.log("  Total ME Minted:", userA.totalMeMinted.toNumber());
      console.log("  Total ME Locked:", userA.totalMeLocked.toNumber());
      console.log("  Total MEMO Earned:", userA.totalMemoEarned.toNumber());
      console.log("  Connections:", userA.connectionsCount.toNumber());

      console.log("\nUser B:");
      console.log("  Total ME Minted:", userB.totalMeMinted.toNumber());
      console.log("  Total ME Locked:", userB.totalMeLocked.toNumber());
      console.log("  Total MEMO Earned:", userB.totalMemoEarned.toNumber());
      console.log("  Connections:", userB.connectionsCount.toNumber());

      console.log("\n✓ All tests passed!");
    });
  });
});
