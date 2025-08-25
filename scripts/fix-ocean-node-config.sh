#!/bin/bash

echo "🔧 Ocean Node Configuration Fix"
echo "================================"

# Check current Ocean Node status
echo "📊 Current Ocean Node status:"
curl -s http://localhost:8001 | jq '.' 2>/dev/null || echo "Ocean Node not responding or jq not installed"

echo -e "\n🔍 Ocean Node logs (last 10 lines):"
docker logs ocean-node 2>&1 | tail -10

echo -e "\n⚙️ Current Ocean Node environment variables:"
docker exec ocean-node env | grep -E "(CHAIN|RPC|INTERFACE|PROVIDER|PRIVATE)" | sort

echo -e "\n🛠️  Recommended Ocean Node configuration:"
echo "The Ocean Node logs show missing configuration. Here's what should be set:"

cat << 'EOF'

# Required Environment Variables for Ocean Node:
PRIVATE_KEY=your_delegatee_private_key_here
RPCS='{"11155420": "https://sepolia-optimism.drpc.org"}'
CHAIN_IDS='[11155420]'  
INTERFACES='["HTTP", "P2P"]'
DB_URL=http://typesense:8108/?apiKey=xyz
AUTHORIZED_ADDRESSES=["0x04e85399854AF819080E9F7f9c5771490373AA1f"]

EOF

echo -e "\n🔄 To fix Ocean Node, try running:"
echo "1. Stop current Ocean Node: docker stop ocean-node"
echo "2. Update docker-compose.yml with proper environment variables"
echo "3. Restart with: docker-compose up -d ocean-node"

echo -e "\n📋 Or create a properly configured Ocean Node:"
cat << 'EOF'

# Example docker-compose.yml section for Ocean Node:
services:
  ocean-node:
    image: oceanprotocol/ocean-node:latest
    ports:
      - "8001:8000"
    environment:
      PRIVATE_KEY: "${DELEGATEE_PRIVATE_KEY}"
      RPCS: '{"11155420": "${OPTIMISM_RPC_URL}"}'
      CHAIN_IDS: '[11155420]'
      INTERFACES: '["HTTP", "P2P"]'
      AUTHORIZED_ADDRESSES: '["${DELEGATEE_ADDRESS}"]'
      DB_URL: "http://typesense:8108/?apiKey=xyz"
      LOG_LEVEL: "info"

EOF

echo -e "\n🎯 Quick test - try restarting Ocean Node with proper config:"
echo "docker run --rm -p 8001:8000 \\"
echo "  -e PRIVATE_KEY=\"\$DELEGATEE_PRIVATE_KEY\" \\"
echo "  -e 'RPCS={\"11155420\": \"https://sepolia-optimism.drpc.org\"}' \\"
echo "  -e 'CHAIN_IDS=[11155420]' \\"
echo "  -e 'INTERFACES=[\"HTTP\", \"P2P\"]' \\"
echo "  -e 'AUTHORIZED_ADDRESSES=[\"\$DELEGATEE_ADDRESS\"]' \\"
echo "  oceanprotocol/ocean-node:latest"