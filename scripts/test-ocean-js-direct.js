#!/usr/bin/env node

/**
 * Test Ocean.js Direct Publishing
 * 
 * Bypass Ocean Node entirely and use Ocean.js library directly
 * This will help determine if the issue is with our Ocean Node setup
 */

// First, let's check if we can install and use Ocean.js
console.log('🌊 Testing Ocean.js Direct Publishing');
console.log('---');

// Check if ocean.js is available
let oceanLib;
try {
  oceanLib = await import('@oceanprotocol/lib');
  console.log('✅ Ocean.js library found');
} catch (error) {
  console.log('❌ Ocean.js library not found, attempting to install...');
  
  // Try to install ocean.js
  const { execSync } = await import('child_process');
  try {
    console.log('📦 Installing @oceanprotocol/lib...');
    execSync('npm install @oceanprotocol/lib', { stdio: 'inherit' });
    console.log('✅ Ocean.js installed successfully');
    
    // Try importing again
    oceanLib = await import('@oceanprotocol/lib');
  } catch (installError) {
    console.log('❌ Failed to install Ocean.js:', installError.message);
    console.log('\n💡 Manual installation required:');
    console.log('   npm install @oceanprotocol/lib');
    console.log('   Then run this script again');
    process.exit(1);
  }
}

// Configuration
const config = {
  nodeUri: process.env.OCEAN_NODE_URL || 'http://localhost:8001',
  providerUri: process.env.OCEAN_PROVIDER_URL || 'http://localhost:8030',
  web3Provider: process.env.OPTIMISM_RPC_URL || 'https://sepolia-optimism.drpc.org',
  chainId: parseInt(process.env.OPTIMISM_CHAIN_ID || '11155420'),
  delegateAddress: process.env.DELEGATEE_ADDRESS || '0x04e85399854AF819080E9F7f9c5771490373AA1f',
  delegateKey: process.env.DELEGATEE_PRIVATE_KEY
};

console.log('🔧 Configuration:');
Object.entries(config).forEach(([key, value]) => {
  if (key === 'delegateKey') {
    console.log(`   ${key}: ${value ? '[SET]' : '[NOT SET]'}`);
  } else {
    console.log(`   ${key}: ${value}`);
  }
});

async function testOceanJsPublishing() {
  if (!config.delegateKey) {
    console.log('\n❌ DELEGATEE_PRIVATE_KEY not set');
    console.log('💡 Set environment variable: export DELEGATEE_PRIVATE_KEY=your_key');
    return;
  }
  
  try {
    console.log('\n🚀 Testing Ocean.js publishing flow...');
    
    // Initialize Ocean instance
    console.log('📊 Initializing Ocean.js...');
    const { Ocean, ConfigHelper } = oceanLib;
    
    const oceanConfig = new ConfigHelper().getConfig(config.chainId);
    oceanConfig.providerUri = config.providerUri;
    
    const ocean = await Ocean.getInstance({
      ...oceanConfig,
      web3Provider: config.web3Provider,
      privateKey: config.delegateKey
    });
    
    console.log('✅ Ocean.js initialized successfully');
    
    // Create simple asset metadata
    const asset = {
      metadata: {
        type: 'dataset',
        name: 'Eliza Memory Test Dataset',
        description: 'Test dataset published via Ocean.js',
        author: config.delegateAddress,
        license: 'MIT',
        tags: ['test', 'eliza', 'memory']
      }
    };
    
    console.log('📝 Publishing asset with Ocean.js...');
    
    // This is the proper way to publish with Ocean.js
    const publishedAsset = await ocean.assets.create(asset, config.delegateAddress);
    
    console.log('✅ Asset published successfully!');
    console.log(`   DID: ${publishedAsset.id}`);
    console.log(`   NFT Address: ${publishedAsset.nftAddress}`);
    console.log(`   Datatoken Address: ${publishedAsset.datatokenAddress}`);
    
    return publishedAsset;
    
  } catch (error) {
    console.log('❌ Ocean.js publishing failed:', error.message);
    console.log('   Stack:', error.stack);
    
    // Check if it's a network/connection issue
    if (error.message.includes('network') || error.message.includes('connection')) {
      console.log('\n💡 This might be a network connectivity issue');
      console.log('   Check if Optimism Sepolia RPC is accessible');
      console.log('   Check if Ocean contracts are deployed on this network');
    }
    
    return null;
  }
}

async function testSimpleHTTPCalls() {
  console.log('\n🌐 Testing basic HTTP connectivity...');
  
  const axios = (await import('axios')).default;
  
  const urls = [
    config.nodeUri,
    config.providerUri, 
    config.web3Provider
  ];
  
  for (const url of urls) {
    try {
      console.log(`   Testing: ${url}`);
      const response = await axios.get(url, { timeout: 5000 });
      console.log(`   ✅ ${url} - Status: ${response.status}`);
    } catch (error) {
      console.log(`   ❌ ${url} - Error: ${error.message}`);
    }
  }
}

async function runTests() {
  await testSimpleHTTPCalls();
  const result = await testOceanJsPublishing();
  
  console.log('\n🏁 Tests completed!');
  
  if (result) {
    console.log('✅ SUCCESS: Ocean.js publishing works!');
    console.log('💡 Recommendation: Use Ocean.js library instead of raw HTTP calls');
  } else {
    console.log('❌ FAILED: Ocean.js publishing doesn\'t work either');
    console.log('💡 This suggests broader Ocean Protocol setup issues');
  }
}

runTests();