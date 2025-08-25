#!/usr/bin/env node

/**
 * Ocean Node AdvertiseDid Test Script
 * 
 * Tests the correct approach using the advertiseDid endpoint
 * Based on the actual available endpoints from Ocean Node
 */

import axios from 'axios';
import { ethers } from 'ethers';

// Configuration
const OCEAN_NODE_URL = process.env.OCEAN_NODE_URL || 'http://localhost:8001';
const DELEGATE_ADDRESS = process.env.DELEGATEE_ADDRESS || '0x04e85399854AF819080E9F7f9c5771490373AA1f';
const CHAIN_ID = parseInt(process.env.OPTIMISM_CHAIN_ID || '11155420'); // Sepolia Optimism

console.log('🌊 Ocean Node AdvertiseDid Test');
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
      description: 'Simple test dataset for Ocean Node advertising',
      tags: ['test', 'memory', 'eliza'],
      author: DELEGATE_ADDRESS,
      license: 'MIT',
      additionalInformation: {
        testData: true,
        createdBy: 'ocean-advertise-test-script'
      }
    },
    services: [
      {
        id: 'access',
        type: 'access',
        files: [
          {
            type: 'url',
            url: 'data:text/plain;base64,' + Buffer.from('Hello Ocean Protocol from advertiseDid!').toString('base64'),
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

// Test DDO validation first
async function testValidateDDO(ddo) {
  console.log('✅ Testing DDO validation...');
  
  try {
    const response = await axios.post(`${OCEAN_NODE_URL}/api/aquarius/assets/ddo/validate`, ddo, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`   ✅ Validation successful - Status: ${response.status}`);
    console.log(`   Response:`, JSON.stringify(response.data, null, 2));
    return true;
    
  } catch (error) {
    console.log(`   ❌ Validation failed - Error: ${error.response?.status || error.message}`);
    if (error.response?.data) {
      console.log(`   Error details:`, JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
}

// Test advertiseDid endpoint
async function testAdvertiseDid(ddo) {
  console.log('📢 Testing advertiseDid endpoint...');
  
  const payload = {
    did: ddo.id,
    ddo: ddo,
    chainId: CHAIN_ID
  };
  
  try {
    const response = await axios.post(`${OCEAN_NODE_URL}/advertiseDid`, payload, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`   ✅ AdvertiseDid successful - Status: ${response.status}`);
    console.log(`   Response:`, JSON.stringify(response.data, null, 2));
    return true;
    
  } catch (error) {
    console.log(`   ❌ AdvertiseDid failed - Error: ${error.response?.status || error.message}`);
    if (error.response?.data) {
      console.log(`   Error details:`, JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
}

// Test retrieving the DDO after advertising
async function testRetrieveDDO(did) {
  console.log('🔍 Testing DDO retrieval...');
  
  // Wait a moment for indexing
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  try {
    const response = await axios.get(`${OCEAN_NODE_URL}/api/aquarius/assets/ddo/${did}`, {
      timeout: 5000
    });
    
    console.log(`   ✅ Retrieval successful - Status: ${response.status}`);
    console.log(`   Retrieved DDO:`, JSON.stringify(response.data, null, 2));
    return true;
    
  } catch (error) {
    console.log(`   ❌ Retrieval failed - Error: ${error.response?.status || error.message}`);
    if (error.response?.data) {
      console.log(`   Error details:`, JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
}

// Main test function
async function runTests() {
  try {
    console.log('🚀 Starting Ocean Node AdvertiseDid Tests\n');
    
    // Step 1: Create test DDO
    const testDDO = createTestDDO();
    console.log('📋 Created test DDO:');
    console.log(`   DID: ${testDDO.id}`);
    console.log(`   Name: ${testDDO.metadata.name}`);
    console.log(`   Chain ID: ${testDDO.chainId}`);
    
    console.log('\n---\n');
    
    // Step 2: Validate DDO first
    const isValid = await testValidateDDO(testDDO);
    if (!isValid) {
      console.log('\n❌ DDO validation failed, cannot proceed with advertising');
      return;
    }
    
    console.log('\n---\n');
    
    // Step 3: Advertise the DID
    const isAdvertised = await testAdvertiseDid(testDDO);
    if (!isAdvertised) {
      console.log('\n❌ AdvertiseDid failed');
      return;
    }
    
    console.log('\n---\n');
    
    // Step 4: Try to retrieve it
    await testRetrieveDDO(testDDO.id);
    
    console.log('\n🏁 Tests completed successfully!');
    console.log(`✅ The correct approach is: validate DDO first, then use advertiseDid`);
    
  } catch (error) {
    console.error('💥 Test script failed:', error);
    process.exit(1);
  }
}

// Run the tests
runTests();