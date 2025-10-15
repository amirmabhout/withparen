#!/bin/bash

# Deploy PDA Wallet Program to Solana Devnet
# Prerequisites:
# - Anchor CLI installed (cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked)
# - Solana CLI installed and configured for devnet
# - Sufficient SOL in wallet for deployment

set -e

echo "🚀 Starting PDA Wallet Program Deployment to Devnet..."

# Check if we're in the right directory
if [ ! -f "Anchor.toml" ]; then
    echo "❌ Error: Anchor.toml not found. Please run this script from the programs/user-pda directory."
    exit 1
fi

# Configure Solana CLI for devnet
echo "📡 Configuring Solana CLI for devnet..."
solana config set --url https://api.devnet.solana.com

# Check wallet balance
echo "💰 Checking wallet balance..."
BALANCE=$(solana balance | awk '{print $1}')
echo "Current balance: $BALANCE SOL"

if (( $(echo "$BALANCE < 0.5" | bc -l) )); then
    echo "⚠️  Low balance detected. Requesting airdrop..."
    solana airdrop 2
    sleep 5
    echo "✅ Airdrop complete"
fi

# Build the program
echo "🔨 Building Anchor program..."
anchor build

# Get the program ID
PROGRAM_ID=$(solana address -k target/deploy/user_pda-keypair.json)
echo "📝 Program ID: $PROGRAM_ID"

# Update Anchor.toml with the program ID
echo "📝 Updating Anchor.toml with program ID..."
sed -i "s/user_pda = \".*\"/user_pda = \"$PROGRAM_ID\"/" Anchor.toml

# Deploy the program
echo "🚀 Deploying program to devnet..."
anchor deploy --provider.cluster devnet

echo "✅ Deployment complete!"
echo ""
echo "📋 Next steps:"
echo "1. Copy this program ID to your .env file:"
echo "   SOLANA_PDA_PROGRAM_ID=$PROGRAM_ID"
echo ""
echo "2. Make sure you have a payer wallet configured:"
echo "   SOLANA_PAYER_PRIVATE_KEY=your_private_key_in_base58"
echo ""
echo "3. Test the implementation by sending a message to the bot"
echo ""
echo "🔍 View your program on Solana Explorer:"
echo "   https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"