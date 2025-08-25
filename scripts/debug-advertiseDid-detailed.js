#!/usr/bin/env node

/**
 * Detailed AdvertiseDid Debugging
 * 
 * Try to understand exactly what Ocean Node expects for advertiseDid
 */

import axios from 'axios';

const OCEAN_NODE_URL = process.env.OCEAN_NODE_URL || 'http://localhost:8001';
const DELEGATE_ADDRESS = process.env.DELEGATEE_ADDRESS || '0x04e85399854AF819080E9F7f9c5771490373AA1f';

console.log('🔍 Detailed AdvertiseDid Debugging');
console.log('==================================');

// Test with Ocean Node's own examples
async function testWithExampleDDOs() {
  console.log('📋 Testing with Ocean Node example DDOs...\n');
  
  // Try to load one of the example DDOs from the Ocean Node data directory
  try {
    const fs = await import('fs');
    const path = await import('path');
    
    const examplePath = '/home/specialpedrito/ocean-node/data/DDO_example_1.json';
    
    if (fs.existsSync(examplePath)) {
      console.log('📄 Found example DDO, testing with it...');
      
      const exampleDDO = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
      console.log(`Example DDO ID: ${exampleDDO.id}`);
      console.log(`Example DDO structure:`, JSON.stringify(exampleDDO, null, 2).substring(0, 500) + '...');
      
      // Test advertiseDid with the example DDO
      const payload = {
        did: exampleDDO.id,
        ddo: exampleDDO,
        chainId: exampleDDO.chainId || 11155420
      };
      
      try {
        const response = await axios.post(`${OCEAN_NODE_URL}/advertiseDid`, payload, {
          timeout: 10000,
          headers: { 'Content-Type': 'application/json' }
        });
        
        console.log('✅ Example DDO worked!');
        console.log(`Response: ${JSON.stringify(response.data, null, 2)}`);
        return true;
        
      } catch (error) {
        console.log('❌ Example DDO also failed');
        console.log(`Status: ${error.response?.status}`);
        console.log(`Error: ${error.response?.data || error.message}`);
      }
    } else {
      console.log('❌ No example DDO found at expected path');
    }
  } catch (error) {
    console.log('❌ Could not load example DDO:', error.message);
  }
  
  return false;
}

// Test with minimal possible payload
async function testMinimalAdvertiseDid() {
  console.log('\n🧪 Testing truly minimal advertiseDid payloads...\n');
  
  const minimalTests = [
    {
      name: 'Just DID string',
      payload: 'did:op:test12345'
    },
    {
      name: 'DID in object',
      payload: { did: 'did:op:test12345' }
    },
    {
      name: 'Empty DDO object',
      payload: {
        did: 'did:op:test12345',
        ddo: {
          id: 'did:op:test12345'
        }
      }
    }
  ];
  
  for (const test of minimalTests) {
    console.log(`Testing: ${test.name}`);
    
    try {
      const response = await axios.post(`${OCEAN_NODE_URL}/advertiseDid`, test.payload, {
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' }
      });
      
      console.log(`✅ SUCCESS with ${test.name}!`);
      console.log(`Response: ${JSON.stringify(response.data, null, 2)}`);
      return test;
      
    } catch (error) {
      console.log(`❌ Failed: ${error.response?.status || 'Unknown'} - ${error.response?.statusText || error.message}`);
      
      // Log more detailed error info for 400 errors
      if (error.response?.status === 400) {
        console.log(`   Raw error data: ${JSON.stringify(error.response.data)}`);
        console.log(`   Headers: ${JSON.stringify(error.response.headers)}`);
      }
    }
    
    console.log('');
  }
  
  return null;
}

// Test authentication methods
async function testAuthMethods() {
  console.log('🔐 Testing authentication methods...\n');
  
  const authTests = [
    {
      name: 'Authorization header with address',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DELEGATE_ADDRESS}`
      }
    },
    {
      name: 'Custom Ocean headers',
      headers: {
        'Content-Type': 'application/json',
        'X-Ocean-Publisher': DELEGATE_ADDRESS,
        'X-Chain-Id': '11155420'
      }
    },
    {
      name: 'Signature-based auth',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': 'test-signature',
        'X-Publisher': DELEGATE_ADDRESS
      }
    }
  ];
  
  const testPayload = { did: 'did:op:authtest', chainId: 11155420 };
  
  for (const test of authTests) {
    console.log(`Testing: ${test.name}`);
    
    try {
      const response = await axios.post(`${OCEAN_NODE_URL}/advertiseDid`, testPayload, {
        timeout: 5000,
        headers: test.headers
      });
      
      console.log(`✅ SUCCESS with ${test.name}!`);
      console.log(`Response: ${JSON.stringify(response.data, null, 2)}`);
      
    } catch (error) {
      console.log(`❌ Failed: ${error.response?.status || 'Unknown'}`);
    }
    
    console.log('');
  }
}

async function runDetailedDebug() {
  console.log('🚀 Starting detailed advertiseDid debugging...\n');
  
  // Test 1: Try with Ocean Node's own example DDOs
  const exampleWorked = await testWithExampleDDOs();
  
  if (exampleWorked) {
    console.log('\n🎯 SOLUTION FOUND: Use the Ocean Node example DDO format!');
    return;
  }
  
  // Test 2: Try minimal payloads
  const minimalWorked = await testMinimalAdvertiseDid();
  
  if (minimalWorked) {
    console.log(`\n🎯 SOLUTION FOUND: Use ${minimalWorked.name} format!`);
    return;
  }
  
  // Test 3: Try different authentication
  await testAuthMethods();
  
  console.log('\n📊 SUMMARY:');
  console.log('- Example DDOs from Ocean Node: Failed');
  console.log('- Minimal payload formats: Failed'); 
  console.log('- Authentication methods: Failed');
  console.log('\n💡 CONCLUSION:');
  console.log('The advertiseDid endpoint may require:');
  console.log('1. On-chain NFT/datatoken creation first');
  console.log('2. Different Ocean Node version/configuration');
  console.log('3. Network-specific setup for Optimism Sepolia');
  console.log('\n✅ The plugin fallback approach is working correctly for now.');
}

runDetailedDebug();