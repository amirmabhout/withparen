# Ocean Protocol + Safe Wallet Setup Guide

This guide shows how to configure the Ocean Protocol plugin with Safe wallets on Optimism Sepolia.

## Configuration Summary

The plugins are now configured for:
- **Network**: Optimism Sepolia (Chain ID: 11155420)
- **Safe Wallets**: Deployed and managed on Optimism Sepolia
- **Ocean Node**: Local development node with gateway at localhost:8000

## Required Environment Variables

Add to your `.env` file:

```bash
# Safe Wallet Configuration (Updated for Optimism Sepolia)
ETHEREUM_RPC_URL=https://sepolia.optimism.io
CHAIN_ID=11155420
DELEGATEE_ADDRESS=0x67BdF78EA1E13D17e39A7f37b816C550359DA1e7
DELEGATEE_PRIVATE_KEY=your_private_key_here

# Ocean Protocol Configuration
OCEAN_NODE_GATEWAY=http://localhost:8000/api/aquarius/assets/ddo
OCEAN_NODE_URL=http://localhost:8001
OPTIMISM_RPC_URL=https://sepolia.optimism.io
OPTIMISM_CHAIN_ID=11155420

# Ocean Publishing Settings
OCEAN_AUTO_PUBLISH=true
OCEAN_MIN_MEMORY_LENGTH=50
OCEAN_PUBLISH_INTERVAL=300000  # 5 minutes
OCEAN_DEFAULT_LICENSE=CC-BY-4.0
OCEAN_TAG_PREFIX=eliza-memory
```

## Ocean Node Setup

1. **Clone Ocean Node Repository**:
```bash
git clone https://github.com/oceanprotocol/ocean-node.git
cd ocean-node
```

2. **Configure Ocean Node Environment**:
```bash
cp .env.example .env
```

3. **Edit `.env` for Ocean Node** with these key settings:
```bash
# Use your existing private key from the Safe configuration
OCEAN_PRIVATE_KEY=your_private_key_here

# Set network to testnet
OCEAN_NETWORK=testnet

# Configure for Optimism Sepolia
CHAIN_ID=11155420
RPC_URL=https://sepolia.optimism.io

# Development settings
LOG_LEVEL=info
INTERFACES=HTTP,P2P
```

4. **Start Ocean Node**:
```bash
docker-compose up -d
```

5. **Verify Ocean Node is Running**:
```bash
curl http://localhost:8001
curl http://localhost:8000/api/aquarius/assets/ddo
```

## Network Configuration Changes Made

### Safe Plugin Changes:
- **RPC URL**: Changed from Ethereum Sepolia to Optimism Sepolia
- **Chain ID**: Changed from 11155111 to 11155420
- **Network**: Now uses `https://sepolia.optimism.io`

### Ocean Plugin Configuration:
- **Default Chain ID**: Set to 11155420 (Optimism Sepolia)
- **Default RPC**: Set to `https://sepolia.optimism.io`  
- **Enhanced Connectivity**: Improved Ocean Node connection testing with multiple endpoints

## Expected Behavior

After these changes, you should see in the logs:
```
✅ Connected to network: optimism-sepolia (chainId: 11155420)
✅ Ocean Node connection successful at: http://localhost:8001
✅ Safe Wallet Service initialized successfully
✅ Ocean Publishing Service initialized successfully
```

## Troubleshooting

### Ocean Node Connection Issues:
- Verify Ocean Node is running: `docker ps | grep ocean`
- Check Ocean Node logs: `docker-compose logs -f`
- Test endpoints manually: `curl http://localhost:8001/health`

### Safe Wallet Issues:
- Ensure you have Optimism Sepolia ETH for gas fees
- Verify your delegatee private key has funds
- Check Safe deployment on Optimism Sepolia

### Network Mismatch Issues:
- Ensure all components use the same chain ID (11155420)
- Verify RPC URLs point to Optimism Sepolia
- Check that your Ocean Node is configured for the same network

## Next Steps

1. **Test Safe Wallet Creation**: The agent should automatically create Safe wallets for users on Optimism Sepolia
2. **Test Memory Extraction**: Have conversations with the agent to trigger memory extraction
3. **Test DataNFT Publishing**: Manually request memory publishing or enable auto-publishing
4. **Verify Ocean Assets**: Check that DataNFTs are created and owned by user Safe accounts

## Funding Requirements

For testing, you'll need Optimism Sepolia ETH:
- **Safe Wallet Deployment**: ~0.001 ETH per wallet
- **DataNFT Publishing**: ~0.0005 ETH per DataNFT
- **Get Testnet ETH**: Use Optimism Sepolia faucets

The configuration now ensures that Safe wallets and Ocean DataNFTs operate on the same network (Optimism Sepolia), resolving the network mismatch issues.