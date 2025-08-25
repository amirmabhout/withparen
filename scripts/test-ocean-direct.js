#!/usr/bin/env node

/**
 * Ocean Node Direct AdvertiseDid Test
 * 
 * Skip validation (which is broken) and try advertiseDid directly
 */

import axios from 'axios';
import { ethers } from 'ethers';

const OCEAN_NODE_URL = process.env.OCEAN_NODE_URL || 'http://localhost:8001';
const DELEGATE_ADDRESS = process.env.DELEGATEE_ADDRESS || '0x04e85399854AF819080E9F7f9c5771490373AA1f';
const CHAIN_ID = parseInt(process.env.OPTIMISM_CHAIN_ID || '11155420');

console.log('🌊 Ocean Node Direct AdvertiseDid Test');
console.log('Skipping validation (endpoint broken), trying advertiseDid directly');
console.log('---');

// Create simple DDO for testing
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
      name: 'Direct Test Dataset',
      description: 'Testing direct advertiseDid without validation',
      tags: ['test', 'direct', 'eliza'],
      author: DELEGATE_ADDRESS,
      license: 'MIT',
      additionalInformation: {
        testData: true,
        createdBy: 'ocean-direct-test'
      }
    },
    services: [
      {
        id: 'access',
        type: 'access',
        files: [
          {
            type: 'url',
            url: 'data:text/plain;base64,' + Buffer.from('Direct advertiseDid test data').toString('base64'),
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

// Test advertiseDid directly
async function testAdvertiseDid(ddo) {
  console.log('📢 Testing advertiseDid directly (no validation)...');
  
  const payload = {
    did: ddo.id,
    ddo: ddo,
    chainId: CHAIN_ID
  };
  
  console.log(`Payload: ${JSON.stringify(payload, null, 2)}`);
  
  try {
    const response = await axios.post(`${OCEAN_NODE_URL}/advertiseDid`, payload, {
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`   ✅ AdvertiseDid SUCCESS - Status: ${response.status}`);
    console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);
    return { success: true, did: ddo.id };
    
  } catch (error) {
    console.log(`   ❌ AdvertiseDid FAILED - Status: ${error.response?.status || 'Unknown'}`);
    console.log(`   Error: ${error.message}`);
    if (error.response?.data) {
      console.log(`   Details: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    return { success: false, error: error.message };
  }
}

// Test retrieval after advertising
async function testRetrieveDDO(did) {
  console.log(`\n🔍 Testing retrieval of DID: ${did}`);
  
  // Wait a moment for indexing
  console.log('   Waiting 3 seconds for indexing...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  try {
    const response = await axios.get(`${OCEAN_NODE_URL}/api/aquarius/assets/ddo/${did}`, {
      timeout: 5000
    });
    
    console.log(`   ✅ Retrieval SUCCESS - Status: ${response.status}`);
    console.log(`   Retrieved DDO: ${JSON.stringify(response.data, null, 2)}`);
    return true;
    
  } catch (error) {
    console.log(`   ❌ Retrieval FAILED - Status: ${error.response?.status || 'Unknown'}`);
    if (error.response?.data) {
      console.log(`   Details: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    return false;
  }
}

async function runTest() {
  console.log('🚀 Starting Direct AdvertiseDid Test\n');
  
  // Create test DDO
  const testDDO = createTestDDO();
  console.log('📋 Created test DDO:');
  console.log(`   DID: ${testDDO.id}`);
  console.log(`   Name: ${testDDO.metadata.name}\n`);
  
  // Try to advertise it
  const result = await testAdvertiseDid(testDDO);
  
  if (result.success) {
    console.log('\n---');
    await testRetrieveDDO(result.did);
    console.log('\n✅ SUCCESS: AdvertiseDid works without validation!');
    console.log('🎯 This means we should skip validation and use advertiseDid directly in the plugin.');
  } else {
    console.log('\n❌ FAILED: AdvertiseDid also doesn\'t work');
  }
  
  console.log('\n🏁 Test completed');
}

runTest();