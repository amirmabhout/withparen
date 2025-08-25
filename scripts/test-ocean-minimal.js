#!/usr/bin/env node

/**
 * Ocean Node Minimal DDO Test
 * 
 * Tests with the most minimal DDO possible to identify what's causing the 500 error
 */

import axios from 'axios';
import { ethers } from 'ethers';

const OCEAN_NODE_URL = process.env.OCEAN_NODE_URL || 'http://localhost:8001';
const DELEGATE_ADDRESS = process.env.DELEGATEE_ADDRESS || '0x04e85399854AF819080E9F7f9c5771490373AA1f';
const CHAIN_ID = parseInt(process.env.OPTIMISM_CHAIN_ID || '11155420');

console.log('🌊 Ocean Node Minimal DDO Test');
console.log('---');

// Test different DDO formats, starting with most minimal
const testDDOs = [
  {
    name: 'Minimal DDO v1',
    ddo: {
      '@context': ['https://w3id.org/did/v1'],
      id: 'did:op:test123',
      version: '4.1.0',
      chainId: CHAIN_ID
    }
  },
  {
    name: 'Basic DDO with metadata',
    ddo: {
      '@context': ['https://w3id.org/did/v1'],
      id: 'did:op:test456',
      version: '4.1.0',
      chainId: CHAIN_ID,
      metadata: {
        name: 'Test Dataset',
        type: 'dataset'
      }
    }
  },
  {
    name: 'DDO with services',
    ddo: {
      '@context': ['https://w3id.org/did/v1'],
      id: 'did:op:test789',
      version: '4.1.0',
      chainId: CHAIN_ID,
      metadata: {
        name: 'Test Dataset',
        type: 'dataset'
      },
      services: []
    }
  },
  {
    name: 'Ocean.js style DDO',
    ddo: {
      '@context': ['https://w3id.org/did/v1'],
      id: 'did:op:testxyz',
      version: '4.1.0',
      chainId: CHAIN_ID,
      nftAddress: '0x0000000000000000000000000000000000000000',
      metadata: {
        type: 'dataset',
        name: 'Test Dataset',
        description: 'Test description',
        author: DELEGATE_ADDRESS,
        license: 'MIT'
      },
      services: [
        {
          id: '0',
          type: 'access',
          datatokenAddress: '0x0000000000000000000000000000000000000000',
          serviceEndpoint: OCEAN_NODE_URL,
          timeout: 3600
        }
      ]
    }
  }
];

async function testValidation(testCase) {
  console.log(`\n🧪 Testing: ${testCase.name}`);
  console.log(`   DDO: ${JSON.stringify(testCase.ddo, null, 2)}`);
  
  try {
    const response = await axios.post(
      `${OCEAN_NODE_URL}/api/aquarius/assets/ddo/validate`, 
      testCase.ddo,
      {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`   ✅ Validation SUCCESS - Status: ${response.status}`);
    console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);
    return true;
    
  } catch (error) {
    console.log(`   ❌ Validation FAILED - Status: ${error.response?.status || 'Unknown'}`);
    console.log(`   Error: ${error.message}`);
    if (error.response?.data) {
      console.log(`   Details: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    return false;
  }
}

async function runTests() {
  console.log('🚀 Starting Minimal DDO Tests');
  
  for (const testCase of testDDOs) {
    const success = await testValidation(testCase);
    if (success) {
      console.log(`\n✅ FOUND WORKING FORMAT: ${testCase.name}`);
      break;
    }
    
    // Wait between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n🏁 Minimal tests completed');
}

runTests();