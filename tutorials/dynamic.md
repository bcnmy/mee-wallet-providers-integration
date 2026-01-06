# Dynamic + Biconomy AbstractJS

This tutorial shows how to integrate Biconomy's AbstractJS with Dynamic's authentication SDK for gas-abstracted batch transactions with multi-auth support.

## Prerequisites

- Dynamic account and Environment ID
- Node.js 18+
- Basic knowledge of viem and React

## Step 1: Get Your Keys

### Dynamic Environment ID

1. Go to [app.dynamic.xyz](https://app.dynamic.xyz)
2. Create a new project or select existing
3. Navigate to **Developers → SDK & API Keys**
4. Copy your **Environment ID**

### Biconomy Keys

Biconomy AbstractJS doesn't require API keys for basic usage. For production, optionally register at [dashboard.biconomy.io](https://dashboard.biconomy.io/).

## Step 2: Install Dependencies

```bash
npm install @biconomy/abstractjs viem @dynamic-labs/sdk-react-core @dynamic-labs/ethereum
```

## Step 3: Configure Environment Variables

Create a `.env` file:

```bash
VITE_DYNAMIC_ENVIRONMENT_ID=your_environment_id_here
```

## Step 4: Set Up the Dynamic Provider

Wrap your app with `DynamicContextProvider`:

```typescript
import { DynamicContextProvider } from '@dynamic-labs/sdk-react-core';
import { EthereumWalletConnectors } from '@dynamic-labs/ethereum';
import { base } from 'viem/chains';

function App() {
  return (
    <DynamicContextProvider
      settings={{
        environmentId: import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID,
        walletConnectors: [EthereumWalletConnectors],
        overrides: {
          evmNetworks: [
            {
              chainId: base.id,
              networkId: base.id,
              name: base.name,
              nativeCurrency: base.nativeCurrency,
              rpcUrls: ['https://mainnet.base.org'],
              blockExplorerUrls: ['https://basescan.org'],
              iconUrls: ['https://avatars.githubusercontent.com/u/108554348'],
            },
          ],
        },
      }}
    >
      <YourComponent />
    </DynamicContextProvider>
  );
}
```

## Step 5: Get the Wallet Client from Dynamic

Use Dynamic hooks to access the wallet:

```typescript
import {
  useDynamicContext,
  useUserWallets,
} from '@dynamic-labs/sdk-react-core';
import { isEthereumWallet } from '@dynamic-labs/ethereum';

function YourComponent() {
  const { user, primaryWallet: contextPrimaryWallet } = useDynamicContext();
  const userWallets = useUserWallets();
  
  // Get the first available wallet
  const primaryWallet = contextPrimaryWallet || userWallets[0];
  
  if (!primaryWallet || !isEthereumWallet(primaryWallet)) {
    return <div>Please connect an Ethereum wallet</div>;
  }
  
  // Get viem wallet client
  const walletClient = await primaryWallet.getWalletClient(base.id.toString());
}
```

## Step 6: Create a Signer for AbstractJS

Dynamic requires a special signer adapter since its wallet client works differently:

```typescript
import { toAccount } from 'viem/accounts';
import { getAddress, type Hex, type LocalAccount } from 'viem';

async function createDynamicSigner(primaryWallet: any): Promise<LocalAccount> {
  // Get viem wallet client from Dynamic
  const walletClient = await primaryWallet.getWalletClient(base.id.toString());
  const address = getAddress(primaryWallet.address) as Hex;

  // Create a LocalAccount that delegates signing to Dynamic
  const signer = toAccount({
    address,

    // Sign message using Dynamic's wallet client
    async signMessage({ message }) {
      const signature = await walletClient.signMessage({
        account: walletClient.account!,
        message,
      });
      return signature;
    },

    // Sign typed data using Dynamic's wallet client
    async signTypedData(typedData) {
      const signature = await walletClient.signTypedData({
        account: walletClient.account!,
        ...typedData,
      } as any);
      return signature;
    },

    // Not used by abstractjs
    async signTransaction() {
      throw new Error('signTransaction not supported - use MEE');
    },
  }) as LocalAccount;

  return signer;
}
```

## Step 7: Set Up the Multichain Nexus Account

```typescript
import {
  toMultichainNexusAccount,
  getMEEVersion,
  MEEVersion,
} from '@biconomy/abstractjs';
import { http } from 'viem';
import { base } from 'viem/chains';

async function initMee(primaryWallet: any) {
  // Create the signer adapter
  const signer = await createDynamicSigner(primaryWallet);

  // Create multichain account (orchestrator)
  const multiAccount = await toMultichainNexusAccount({
    chainConfigurations: [
      {
        chain: base,
        transport: http(),
        version: getMEEVersion(MEEVersion.V2_1_0),
      },
    ],
    signer: signer as any,  // Type cast needed for compatibility
  });

  return multiAccount;
}
```

## Step 8: Create the MEE Client

```typescript
import { createMeeClient } from '@biconomy/abstractjs';

const meeClient = await createMeeClient({ account: multiAccount });
```

## Step 9: Build Batch Instructions

```typescript
import { erc20Abi, type Hex } from 'viem';

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_AMOUNT = 100_000n; // 0.1 USDC

const recipients = ['0x123...', '0x456...'];

const transfers = await Promise.all(
  recipients.map((recipient) =>
    multiAccount.buildComposable({
      type: 'default',
      data: {
        abi: erc20Abi,
        chainId: base.id,
        to: USDC_ADDRESS,
        functionName: 'transfer',
        args: [recipient as Hex, TRANSFER_AMOUNT],
      },
    })
  )
);
```

## Step 10: Get Quote and Execute

```typescript
import { getMeeScanLink } from '@biconomy/abstractjs';

const totalAmount = BigInt(transfers.length) * TRANSFER_AMOUNT;

// Get fusion quote
const fusionQuote = await meeClient.getFusionQuote({
  instructions: transfers,
  trigger: {
    chainId: base.id,
    tokenAddress: USDC_ADDRESS,
    amount: totalAmount,
  },
  feeToken: {
    address: USDC_ADDRESS,
    chainId: base.id,
  },
  simulation: {
    simulate: true,
  },
});

// Execute with single signature
const { hash } = await meeClient.executeFusionQuote({ fusionQuote });

console.log('MEE Scan:', getMeeScanLink(hash));

// Wait for confirmation
await meeClient.waitForSupertransactionReceipt({ hash });
```

## Complete Example

```typescript
import { useState, useEffect } from 'react';
import {
  DynamicContextProvider,
  DynamicWidget,
  useDynamicContext,
  useUserWallets,
} from '@dynamic-labs/sdk-react-core';
import { EthereumWalletConnectors, isEthereumWallet } from '@dynamic-labs/ethereum';
import { erc20Abi, http, type Hex, getAddress, type LocalAccount } from 'viem';
import { toAccount } from 'viem/accounts';
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

function DynamicWallet() {
  const { user } = useDynamicContext();
  const userWallets = useUserWallets();
  const primaryWallet = userWallets[0];

  const [meeClient, setMeeClient] = useState<MeeClient | null>(null);
  const [orchestrator, setOrchestrator] = useState<MultichainSmartAccount | null>(null);

  // Initialize MEE when wallet is available
  useEffect(() => {
    const init = async () => {
      if (!primaryWallet?.address || !isEthereumWallet(primaryWallet)) return;
      if (meeClient) return;

      const walletClient = await primaryWallet.getWalletClient(base.id.toString());
      const address = getAddress(primaryWallet.address) as Hex;

      const signer = toAccount({
        address,
        async signMessage({ message }) {
          return await walletClient.signMessage({
            account: walletClient.account!,
            message,
          });
        },
        async signTypedData(typedData) {
          return await walletClient.signTypedData({
            account: walletClient.account!,
            ...typedData,
          } as any);
        },
        async signTransaction() {
          throw new Error('Use MEE for transactions');
        },
      }) as LocalAccount;

      const multiAccount = await toMultichainNexusAccount({
        chainConfigurations: [
          { chain: base, transport: http(), version: getMEEVersion(MEEVersion.V2_1_0) },
        ],
        signer: signer as any,
      });
      setOrchestrator(multiAccount);

      const mee = await createMeeClient({ account: multiAccount });
      setMeeClient(mee);
    };

    init();
  }, [primaryWallet?.address, meeClient]);

  const batchTransfer = async (recipients: string[]) => {
    if (!orchestrator || !meeClient) return;

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

    const quote = await meeClient.getFusionQuote({
      instructions: transfers,
      trigger: {
        chainId: base.id,
        tokenAddress: USDC_ADDRESS,
        amount: BigInt(transfers.length) * 100_000n,
      },
      feeToken: { address: USDC_ADDRESS, chainId: base.id },
      simulation: { simulate: true },
    });

    const { hash } = await meeClient.executeFusionQuote({ fusionQuote: quote });
    await meeClient.waitForSupertransactionReceipt({ hash });
    
    console.log('Done!', getMeeScanLink(hash));
  };

  if (!user) {
    return <DynamicWidget />;
  }

  return (
    <div>
      <p>Wallet: {primaryWallet?.address}</p>
      <button onClick={() => batchTransfer(['0x...', '0x...'])}>
        Batch Transfer
      </button>
    </div>
  );
}

export default function App() {
  return (
    <DynamicContextProvider
      settings={{
        environmentId: import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID,
        walletConnectors: [EthereumWalletConnectors],
        overrides: {
          evmNetworks: [
            {
              chainId: base.id,
              networkId: base.id,
              name: base.name,
              nativeCurrency: base.nativeCurrency,
              rpcUrls: ['https://mainnet.base.org'],
              blockExplorerUrls: ['https://basescan.org'],
            },
          ],
        },
      }}
    >
      <DynamicWallet />
    </DynamicContextProvider>
  );
}
```

## Dynamic-Specific Features

### Multiple Auth Methods

Dynamic supports various login methods. Configure in your dashboard:

- Email (magic link or OTP)
- Social (Google, Twitter, Discord, etc.)
- External wallets (MetaMask, WalletConnect)
- Embedded wallets

### Embedded Wallets

Enable embedded wallets in your Dynamic dashboard for users without existing wallets:

1. Go to **Configurations → Embedded Wallets**
2. Enable **Embedded Wallets**
3. Users can now create wallets with just an email

### Network Switching

Dynamic handles network switching automatically:

```typescript
// Switch to Base before operations
await primaryWallet.switchNetwork(base.id);
```

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| "Wallet is not an Ethereum wallet" | Non-EVM wallet selected | Check `isEthereumWallet()` |
| "No wallet found" | User hasn't connected | Show `<DynamicWidget />` |
| "Missing Environment ID" | Env var not set | Check `.env` file |

## Resources

- [Dynamic Documentation](https://docs.dynamic.xyz/)
- [Dynamic Dashboard](https://app.dynamic.xyz)
- [AbstractJS Docs](https://docs.biconomy.io/abstractjs)
- [MEE Scan Explorer](https://meescan.biconomy.io/)

