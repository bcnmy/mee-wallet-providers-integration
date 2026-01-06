# MetaMask / Browser Wallet + Biconomy AbstractJS

This tutorial shows how to integrate Biconomy's AbstractJS with a standard browser wallet (MetaMask) for gas-abstracted batch transactions.

## Prerequisites

- A browser wallet (MetaMask, Rabby, etc.)
- Node.js 18+
- Basic knowledge of viem and React

## Step 1: Get Your Biconomy Keys

**Good news**: Biconomy AbstractJS doesn't require API keys for basic usage! The MEE (Multi-chain Execution Engine) works without authentication.

For production applications with higher rate limits, you can optionally register at [dashboard.biconomy.io](https://dashboard.biconomy.io/).

## Step 2: Install Dependencies

```bash
npm install @biconomy/abstractjs viem
```

## Step 3: Initialize the Browser Wallet

Create a viem wallet client connected to the browser's injected provider:

```typescript
import { createWalletClient, custom, http } from 'viem';
import { base } from 'viem/chains';

// Check if wallet is available
if (typeof window.ethereum === 'undefined') {
  throw new Error('No wallet detected');
}

// Create wallet client
const walletClient = createWalletClient({
  chain: base,
  transport: custom(window.ethereum),
});

// Request wallet connection
const [address] = await walletClient.requestAddresses();
console.log('Connected:', address);
```

## Step 4: Set Up the Multichain Nexus Account

The Multichain Nexus Account acts as an orchestrator that handles batching and fee payments:

```typescript
import {
  toMultichainNexusAccount,
  getMEEVersion,
  MEEVersion,
} from '@biconomy/abstractjs';
import { createWalletClient, custom, http } from 'viem';
import { base } from 'viem/chains';

// Create a signer wallet client with the user's account
const signer = createWalletClient({
  account: address,  // The connected address from Step 3
  transport: custom(window.ethereum),
});

// Create the multichain account (orchestrator)
const multiAccount = await toMultichainNexusAccount({
  chainConfigurations: [
    {
      chain: base,
      transport: http(),
      version: getMEEVersion(MEEVersion.V2_1_0),
    },
  ],
  signer,
});
```

### Understanding Chain Configurations

- **chain**: The viem chain object (imported from `viem/chains`)
- **transport**: HTTP transport for RPC calls
- **version**: MEE protocol version (use `V2_1_0` for latest features)

You can add multiple chains to enable cross-chain operations:

```typescript
import { base, optimism, arbitrum } from 'viem/chains';

const multiAccount = await toMultichainNexusAccount({
  chainConfigurations: [
    { chain: base, transport: http(), version: getMEEVersion(MEEVersion.V2_1_0) },
    { chain: optimism, transport: http(), version: getMEEVersion(MEEVersion.V2_1_0) },
    { chain: arbitrum, transport: http(), version: getMEEVersion(MEEVersion.V2_1_0) },
  ],
  signer,
});
```

## Step 5: Create the MEE Client

The MEE Client handles quote fetching and transaction execution:

```typescript
import { createMeeClient } from '@biconomy/abstractjs';

const meeClient = await createMeeClient({ account: multiAccount });
```

## Step 6: Build Batch Instructions

Use `buildComposable` to create transaction instructions:

```typescript
import { erc20Abi, type Hex } from 'viem';

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // USDC on Base
const recipients = ['0x123...', '0x456...', '0x789...'];
const amountPerRecipient = 100_000n; // 0.1 USDC (6 decimals)

// Build transfer instructions for each recipient
const transfers = await Promise.all(
  recipients.map((recipient) =>
    multiAccount.buildComposable({
      type: 'default',
      data: {
        abi: erc20Abi,
        chainId: base.id,
        to: USDC_ADDRESS,
        functionName: 'transfer',
        args: [recipient as Hex, amountPerRecipient],
      },
    })
  )
);
```

## Step 7: Get a Fusion Quote

The Fusion Quote calculates fees and prepares the transaction:

```typescript
const totalAmount = BigInt(transfers.length) * amountPerRecipient;

const fusionQuote = await meeClient.getFusionQuote({
  // Array of transaction instructions
  instructions: transfers,
  
  // Trigger: Where to pull tokens from (user's EOA)
  trigger: {
    chainId: base.id,
    tokenAddress: USDC_ADDRESS,
    amount: totalAmount,
  },
  
  // Fee payment token (pay gas in USDC, not ETH!)
  feeToken: {
    address: USDC_ADDRESS,
    chainId: base.id,
  },
  
  // Enable simulation for accurate gas estimates
  simulation: {
    simulate: true,
  },
});
```

### Quote Options Explained

| Option | Description |
|--------|-------------|
| `instructions` | Array of composable operations to execute |
| `trigger` | Token to pull from user's wallet to fund the operations |
| `feeToken` | Token used to pay gas fees (enables gasless UX) |
| `simulation` | Enable for accurate estimates (~250ms latency) |

## Step 8: Execute the Transaction

Execute with a single signature:

```typescript
import { getMeeScanLink } from '@biconomy/abstractjs';

// User signs once to authorize everything
const { hash } = await meeClient.executeFusionQuote({ fusionQuote });

// Get explorer link
const meeScanLink = getMeeScanLink(hash);
console.log('View on MEE Scan:', meeScanLink);

// Wait for confirmation
await meeClient.waitForSupertransactionReceipt({ hash });
console.log('Transaction confirmed!');
```

## Complete Example

Here's a full working example:

```typescript
import { useState } from 'react';
import { createWalletClient, custom, http, erc20Abi, type Hex } from 'viem';
import { base } from 'viem/chains';
import {
  createMeeClient,
  toMultichainNexusAccount,
  getMeeScanLink,
  getMEEVersion,
  MEEVersion,
  type MeeClient,
  type MultichainSmartAccount,
} from '@biconomy/abstractjs';

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

export default function BatchTransfer() {
  const [meeClient, setMeeClient] = useState<MeeClient | null>(null);
  const [orchestrator, setOrchestrator] = useState<MultichainSmartAccount | null>(null);

  const connect = async () => {
    // 1. Connect wallet
    const wallet = createWalletClient({
      chain: base,
      transport: custom(window.ethereum),
    });
    const [address] = await wallet.requestAddresses();

    // 2. Create multichain account
    const multiAccount = await toMultichainNexusAccount({
      chainConfigurations: [
        {
          chain: base,
          transport: http(),
          version: getMEEVersion(MEEVersion.V2_1_0),
        },
      ],
      signer: createWalletClient({
        account: address,
        transport: custom(window.ethereum),
      }),
    });
    setOrchestrator(multiAccount);

    // 3. Create MEE client
    const mee = await createMeeClient({ account: multiAccount });
    setMeeClient(mee);
  };

  const batchTransfer = async (recipients: string[]) => {
    if (!orchestrator || !meeClient) return;

    // 4. Build instructions
    const transfers = await Promise.all(
      recipients.map((r) =>
        orchestrator.buildComposable({
          type: 'default',
          data: {
            abi: erc20Abi,
            chainId: base.id,
            to: USDC_ADDRESS,
            functionName: 'transfer',
            args: [r as Hex, 100_000n],
          },
        })
      )
    );

    // 5. Get quote
    const quote = await meeClient.getFusionQuote({
      instructions: transfers,
      trigger: {
        chainId: base.id,
        tokenAddress: USDC_ADDRESS,
        amount: BigInt(transfers.length) * 100_000n,
      },
      feeToken: {
        address: USDC_ADDRESS,
        chainId: base.id,
      },
      simulation: { simulate: true },
    });

    // 6. Execute
    const { hash } = await meeClient.executeFusionQuote({ fusionQuote: quote });
    
    // 7. Wait for confirmation
    await meeClient.waitForSupertransactionReceipt({ hash });
    
    console.log('Done!', getMeeScanLink(hash));
  };

  return (
    <div>
      <button onClick={connect}>Connect Wallet</button>
      <button onClick={() => batchTransfer(['0x...', '0x...'])}>
        Batch Transfer
      </button>
    </div>
  );
}
```

## Error Handling

Common errors and solutions:

| Error | Cause | Solution |
|-------|-------|----------|
| "No wallet detected" | No browser wallet installed | Prompt user to install MetaMask |
| "User rejected" | User declined signature | Show retry button |
| "Insufficient balance" | Not enough tokens for transfer + fees | Check balance before executing |

## Next Steps

- Add support for multiple chains
- Implement cross-chain transfers
- Add transaction history using MEE Scan API

## Resources

- [AbstractJS Docs](https://docs.biconomy.io/abstractjs)
- [MEE Scan Explorer](https://meescan.biconomy.io/)
- [Viem Documentation](https://viem.sh/)

