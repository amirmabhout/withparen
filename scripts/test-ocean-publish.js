#!/usr/bin/env node

/**
 * Simple Ocean Node Publishing Test Script
 * 
 * Tests basic DataNFT publishing to Ocean Node using the delegate address
 * This will help identify the correct endpoints and request format
 */

import axios from 'axios';
import { ethers } from 'ethers';

// Configuration
const OCEAN_NODE_URL = process.env.OCEAN_NODE_URL || 'http://localhost:8001';
const DELEGATE_ADDRESS = process.env.DELEGATEE_ADDRESS || '0x04e85399854AF819080E9F7f9c5771490373AA1f';
const CHAIN_ID = parseInt(process.env.OPTIMISM_CHAIN_ID || '11155420'); // Sepolia Optimism

console.log('🌊 Ocean Node Publishing Test');
console.log(`Node URL: ${OCEAN_NODE_URL}`);
console.log(`Delegate Address: ${DELEGATE_ADDRESS}`);
console.log(`Chain ID: ${CHAIN_ID}`);
console.log('---');

// Create simple test DDO
function createTestDDO() {
  const did = `did:op:${ethers.keccak256(ethers.randomBytes(32)).slice(2)}`;
  const currentDate = new Date().toISOString();
  
  return {
    '@context': ['https://w3id.org/did/v1'],
    id: did,
    version: '4.1.0',
    chainId: CHAIN_ID,
    nftAddress: ethers.ZeroAddress,
    metadata: {
      created: currentDate,
      updated: currentDate,
      type: 'dataset',
      name: 'Test Memory Dataset',
      description: 'Simple test dataset for Ocean Node publishing',
      tags: ['test', 'memory', 'eliza'],
      author: DELEGATE_ADDRESS,
      license: 'MIT',
      additionalInformation: {
        testData: true,
        createdBy: 'ocean-publish-test-script'
      }
    },
    services: [
      {
        id: 'access',
        type: 'access',
        files: [
          {
            type: 'url',
            url: 'data:text/plain;base64,' + Buffer.from('Hello Ocean Protocol!').toString('base64'),
            method: 'GET'
          }
        ],
        datatokenAddress: ethers.ZeroAddress,
        serviceEndpoint: OCEAN_NODE_URL,
        timeout: 3600
      }
    ]
  };
}

// Test Ocean Node connectivity
async function testConnectivity() {
  console.log('🔍 Testing Ocean Node connectivity...');
  
  const endpoints = [
    `${OCEAN_NODE_URL}/health`,
    `${OCEAN_NODE_URL}/status`,
    `${OCEAN_NODE_URL}/api/v1/status`,
    `${OCEAN_NODE_URL}`,
  ];
  
  for (const endpoint of endpoints) {
    try {
      console.log(`  Trying: ${endpoint}`);
      const response = await axios.get(endpoint, { timeout: 5000 });
      console.log(`  ✅ ${endpoint} - Status: ${response.status}`);
      if (response.data) {
        console.log(`     Response:`, JSON.stringify(response.data, null, 2));
      }
      return true;
    } catch (error) {
      console.log(`  ❌ ${endpoint} - Error: ${error.message}`);
    }
  }
  
  return false;
}

// Test different publishing endpoints
async function testPublishingEndpoints(ddo) {
  console.log('📤 Testing publishing endpoints...');
  
  const publishEndpoints = [
    { path: '/api/v1/ddo', method: 'POST', data: ddo },
    { path: '/api/aquarius/assets/ddo', method: 'POST', data: ddo },
    { path: '/api/v1/assets', method: 'POST', data: ddo },
    { path: '/ddo', method: 'POST', data: ddo },
    { path: '/publish', method: 'POST', data: ddo },
    { path: '/index', method: 'POST', data: { type: 'ddo', data: ddo } },
    { path: '/api/v1/metadata', method: 'POST', data: { ddo } },
    { path: '/store', method: 'POST', data: { ddo, chainId: CHAIN_ID } },
  ];
  
  for (const endpoint of publishEndpoints) {
    try {
      const url = `${OCEAN_NODE_URL}${endpoint.path}`;
      console.log(`  Trying: ${endpoint.method} ${url}`);
      
      const response = await axios({
        method: endpoint.method,
        url: url,
        data: endpoint.data,
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
      
      console.log(`  ✅ ${endpoint.path} - Status: ${response.status}`);
      console.log(`     Response:`, JSON.stringify(response.data, null, 2));
      
      return { endpoint: endpoint.path, response: response.data };
      
    } catch (error) {
      console.log(`  ❌ ${endpoint.path} - Error: ${error.response?.status || error.message}`);
      if (error.response?.data) {
        console.log(`     Error details:`, JSON.stringify(error.response.data, null, 2));
      }
    }
  }
  
  return null;
}

// Test querying/retrieving assets
async function testQueryEndpoints(did) {
  console.log('🔍 Testing query endpoints...');
  
  const queryEndpoints = [
    `/api/v1/ddo/${did}`,
    `/api/aquarius/assets/ddo/${did}`,
    `/ddo/${did}`,
    `/api/v1/assets/${did}`,
    `/assets/${did}`,
  ];
  
  for (const endpoint of queryEndpoints) {
    try {
      const url = `${OCEAN_NODE_URL}${endpoint}`;
      console.log(`  Trying: GET ${url}`);
      
      const response = await axios.get(url, { timeout: 5000 });
      console.log(`  ✅ ${endpoint} - Status: ${response.status}`);
      console.log(`     Response:`, JSON.stringify(response.data, null, 2));
      
    } catch (error) {
      console.log(`  ❌ ${endpoint} - Error: ${error.response?.status || error.message}`);
    }
  }
}

// Main test function
async function runTests() {
  try {
    console.log('🚀 Starting Ocean Node Publishing Tests\n');
    
    // Step 1: Test connectivity
    const isConnected = await testConnectivity();
    if (!isConnected) {
      console.log('\n❌ Could not connect to Ocean Node. Please check if it\'s running.');
      process.exit(1);
    }
    
    console.log('\n---\n');
    
    // Step 2: Create test DDO
    const testDDO = createTestDDO();
    console.log('📋 Created test DDO:');
    console.log(`   DID: ${testDDO.id}`);
    console.log(`   Name: ${testDDO.metadata.name}`);
    console.log(`   Author: ${testDDO.metadata.author}`);
    
    console.log('\n---\n');
    
    // Step 3: Test publishing endpoints
    const publishResult = await testPublishingEndpoints(testDDO);
    
    console.log('\n---\n');
    
    // Step 4: Test querying if publish worked
    if (publishResult) {
      console.log(`✅ Publishing succeeded via ${publishResult.endpoint}!`);
      await testQueryEndpoints(testDDO.id);
    } else {
      console.log('❌ No publishing endpoint worked');
    }
    
    console.log('\n🏁 Tests completed!');
    
  } catch (error) {
    console.error('💥 Test script failed:', error);
    process.exit(1);
  }
}

// Run the tests
runTests();