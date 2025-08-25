#!/bin/bash

echo "🔧 Restarting Ocean Node with Proper Configuration"
echo "=================================================="

# Check if environment variables are set
if [ -z "$DELEGATEE_PRIVATE_KEY" ]; then
    echo "❌ DELEGATEE_PRIVATE_KEY not set!"
    echo "💡 Set it with: export DELEGATEE_PRIVATE_KEY=your_key"
    exit 1
fi

if [ -z "$DELEGATEE_ADDRESS" ]; then
    echo "❌ DELEGATEE_ADDRESS not set!"
    echo "💡 Set it with: export DELEGATEE_ADDRESS=0x04e85399854AF819080E9F7f9c5771490373AA1f"
    exit 1
fi

echo "✅ Environment variables detected:"
echo "   DELEGATEE_ADDRESS: $DELEGATEE_ADDRESS"
echo "   DELEGATEE_PRIVATE_KEY: [SET]"

# Stop existing Ocean Node
echo -e "\n🛑 Stopping existing Ocean Node..."
docker stop ocean-node 2>/dev/null || echo "No existing ocean-node container found"
docker rm ocean-node 2>/dev/null || echo "No existing ocean-node container to remove"

# Start Ocean Node with proper configuration
echo -e "\n🚀 Starting Ocean Node with proper configuration..."

docker run -d \
  --name ocean-node \
  -p 8001:8000 \
  -e PRIVATE_KEY="$DELEGATEE_PRIVATE_KEY" \
  -e 'RPCS={"11155420": "https://sepolia-optimism.drpc.org"}' \
  -e 'CHAIN_IDS=[11155420]' \
  -e 'INTERFACES=["HTTP", "P2P"]' \
  -e "AUTHORIZED_ADDRESSES=[\"$DELEGATEE_ADDRESS\"]" \
  -e LOG_LEVEL="debug" \
  oceanprotocol/ocean-node:latest

echo "✅ Ocean Node started!"

# Wait for it to initialize
echo -e "\n⏳ Waiting for Ocean Node to initialize (10 seconds)..."
sleep 10

# Test the new configuration
echo -e "\n🧪 Testing new Ocean Node configuration..."
echo "Status endpoint:"
curl -s http://localhost:8001 | jq '.chainIds' 2>/dev/null || echo "Could not get status"

echo -e "\n📋 Ocean Node logs (last 5 lines):"
docker logs ocean-node 2>&1 | tail -5

echo -e "\n🎯 If chainIds shows [11155420], the configuration is working!"
echo "Now try publishing a memory again in your agent."