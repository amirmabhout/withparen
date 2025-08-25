#!/usr/bin/env node

/**
 * Debug Ocean Node Request Format
 * 
 * Test different request formats systematically to find what works
 */

import axios from 'axios';
import { ethers } from 'ethers';

const OCEAN_NODE_URL = process.env.OCEAN_NODE_URL || 'http://localhost:8001';
const DELEGATE_ADDRESS = process.env.DELEGATEE_ADDRESS || '0x04e85399854AF819080E9F7f9c5771490373AA1f';
const CHAIN_ID = parseInt(process.env.OPTIMISM_CHAIN_ID || '11155420');

console.log('🔍 Debug Ocean Node Request Format');
console.log('---');

// First, let's check what the Ocean Node actually expects
async function inspectAvailableEndpoints() {
  console.log('📋 Available Ocean Node endpoints:');
  try {
    const response = await axios.get(OCEAN_NODE_URL);
    const endpoints = response.data.serviceEndpoints;
    
    console.log('🌊 AdvertiseDid endpoint details:');
    if (endpoints.advertiseDid) {
      console.log(`   Method: ${endpoints.advertiseDid[0]}`);
      console.log(`   Path: ${endpoints.advertiseDid[1]}`);
    }
    
    console.log('\n📡 Other potentially useful endpoints:');
    Object.entries(endpoints).forEach(([name, details]) => {
      if (name.toLowerCase().includes('ddo') || name.toLowerCase().includes('metadata')) {
        console.log(`   ${name}: ${details[0]} ${details[1]}`);
      }
    });
    
    return endpoints;
  } catch (error) {
    console.log('❌ Failed to get endpoints:', error.message);
    return null;
  }
}

// Test minimal payloads for advertiseDid
async function testMinimalPayloads() {
  console.log('\n🧪 Testing minimal advertiseDid payloads:');
  
  const testPayloads = [
    {
      name: 'Just DID',
      payload: {
        did: 'did:op:test123'
      }
    },
    {
      name: 'DID + ChainId',
      payload: {
        did: 'did:op:test123',
        chainId: CHAIN_ID
      }
    },
    {
      name: 'DID + ChainId (string)',
      payload: {
        did: 'did:op:test123',
        chainId: CHAIN_ID.toString()
      }
    },
    {
      name: 'Empty object',
      payload: {}
    }
  ];
  
  for (const test of testPayloads) {
    console.log(`\n   Testing: ${test.name}`);
    console.log(`   Payload: ${JSON.stringify(test.payload)}`);
    
    try {
      const response = await axios.post(`${OCEAN_NODE_URL}/advertiseDid`, test.payload, {
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' }
      });
      
      console.log(`   ✅ SUCCESS - Status: ${response.status}`);
      console.log(`   Response: ${JSON.stringify(response.data)}`);
      
    } catch (error) {
      console.log(`   ❌ FAILED - Status: ${error.response?.status || 'Unknown'}`);
      if (error.response?.data && typeof error.response.data === 'string' && error.response.data.length < 200) {
        console.log(`   Error: ${error.response.data}`);
      } else if (error.response?.data && typeof error.response.data === 'object') {
        console.log(`   Error: ${JSON.stringify(error.response.data)}`);
      } else {
        console.log(`   Error: ${error.message}`);
      }
    }
    
    // Wait between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

// Test if we need authentication or specific headers
async function testAuthAndHeaders() {
  console.log('\n🔐 Testing different headers and auth:');
  
  const testDid = 'did:op:headertest';
  const basePayload = { did: testDid, chainId: CHAIN_ID };
  
  const headerTests = [
    {
      name: 'No special headers',
      headers: { 'Content-Type': 'application/json' }
    },
    {
      name: 'With Authorization',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DELEGATE_ADDRESS}`
      }
    },
    {
      name: 'With Custom Ocean Headers',
      headers: { 
        'Content-Type': 'application/json',
        'X-Ocean-Provider': DELEGATE_ADDRESS,
        'X-Chain-Id': CHAIN_ID.toString()
      }
    },
    {
      name: 'Plain text content type',
      headers: { 'Content-Type': 'text/plain' }
    }
  ];
  
  for (const test of headerTests) {
    console.log(`\n   Testing: ${test.name}`);
    
    try {
      const response = await axios.post(`${OCEAN_NODE_URL}/advertiseDid`, basePayload, {
        timeout: 5000,
        headers: test.headers
      });
      
      console.log(`   ✅ SUCCESS - Status: ${response.status}`);
      console.log(`   Response: ${JSON.stringify(response.data)}`);
      
    } catch (error) {
      console.log(`   ❌ FAILED - Status: ${error.response?.status || 'Unknown'}`);
      if (error.response?.data && typeof error.response.data === 'string' && error.response.data.length < 200) {
        console.log(`   Error: ${error.response.data}`);
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

async function runDebug() {
  console.log('🚀 Starting Ocean Node Format Debug\n');
  
  // Step 1: Check available endpoints
  await inspectAvailableEndpoints();
  
  // Step 2: Test minimal payloads
  await testMinimalPayloads();
  
  // Step 3: Test different headers
  await testAuthAndHeaders();
  
  console.log('\n🏁 Debug completed!');
  console.log('\n💡 Next steps:');
  console.log('1. Check Ocean Node logs for more detailed error messages');
  console.log('2. Verify Ocean Node configuration and authorization settings');
  console.log('3. Check if Ocean Node requires on-chain NFT/datatoken creation first');
}

runDebug();