# Para + Biconomy AbstractJS

This tutorial shows how to integrate Biconomy's AbstractJS with Para's embedded wallet SDK for gas-abstracted batch transactions.

## Prerequisites

- Para account and API key
- Node.js 18+
- Basic knowledge of viem and React

## Step 1: Get Your Keys

### Para API Key

1. Go to [developer.getpara.com](https://developer.getpara.com)
2. Create a new project
3. Navigate to **API Keys**
4. Copy your **API Key**

### Biconomy Keys

Biconomy AbstractJS doesn't require API keys for basic usage. For production, optionally register at [dashboard.biconomy.io](https://dashboard.biconomy.io/).

## Step 2: Install Dependencies

```bash
npm install @biconomy/abstractjs viem @getpara/react-sdk @getpara/web-sdk @getpara/viem-v2-integration @tanstack/react-query
```

## Step 3: Configure Environment Variables

Create a `.env` file:

```bash
VITE_PARA_API_KEY=your_api_key_here

# Optional: For external wallet connections
VITE_WALLETCONNECT_PROJECT_ID=your_project_id
```

## Step 4: Set Up the Para Provider

Para requires both a React Query client and the Para provider:

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ParaProvider } from '@getpara/react-sdk';
import '@getpara/react-sdk/styles.css';
import { base } from 'viem/chains';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ParaProvider
        paraClientConfig={{
          apiKey: import.meta.env.VITE_PARA_API_KEY,
        }}
        externalWalletConfig={{
          wallets: ['METAMASK'],
          evmConnector: {
            config: {
              chains: [base],
            },
          },
          walletConnect: {
            projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '',
          },
        }}
        config={{ appName: 'Your App Name' }}
      >
        <YourComponent />
      </ParaProvider>
    </QueryClientProvider>
  );
}
```

## Step 5: Create a Para Web SDK Instance

Para needs a separate SDK instance for signing:

```typescript
import Para, { Environment } from '@getpara/web-sdk';

// Create at module level - shares session with React SDK
const para = new Para(
  Environment.BETA,  // Use Environment.PROD for production
  import.meta.env.VITE_PARA_API_KEY || ''
);
```

## Step 6: Use Para React Hooks

```typescript
import { useModal, useAccount, useWallet } from '@getpara/react-sdk';

function YourComponent() {
  const { openModal } = useModal();
  const { isConnected } = useAccount();
  const { data: wallet } = useWallet();

  if (!isConnected) {
    return (
      <button onClick={() => openModal()}>
        Sign In / Connect
      </button>
    );
  }

  return <div>Connected: {wallet?.address}</div>;
}
```

## Step 7: Create a Para Viem Account

Para provides a dedicated viem integration package:

```typescript
import { createParaAccount } from '@getpara/viem-v2-integration';
import type { LocalAccount } from 'viem';

// Create a viem-compatible account from Para
const viemParaAccount = await createParaAccount(para);
```

The `createParaAccount` function automatically handles:
- Message signing (`signMessage`)
- Typed data signing (`signTypedData`)
- Transaction signing (if needed)

## Step 8: Set Up the Multichain Nexus Account

```typescript
import {
  toMultichainNexusAccount,
  getMEEVersion,
  MEEVersion,
} from '@biconomy/abstractjs';
import { http } from 'viem';
import { base } from 'viem/chains';

const multiAccount = await toMultichainNexusAccount({
  chainConfigurations: [
    {
      chain: base,
      transport: http(),
      version: getMEEVersion(MEEVersion.V2_1_0),
    },
  ],
  // Cast needed for type compatibility
  signer: viemParaAccount as LocalAccount as any,
});
```

## Step 9: Create the MEE Client

```typescript
import { createMeeClient } from '@biconomy/abstractjs';

const meeClient = await createMeeClient({ account: multiAccount });
```

## Step 10: Build Batch Instructions

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

## Step 11: Get Quote and Execute

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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ParaProvider, useModal, useAccount, useWallet } from '@getpara/react-sdk';
import '@getpara/react-sdk/styles.css';
import Para, { Environment } from '@getpara/web-sdk';
import { createParaAccount } from '@getpara/viem-v2-integration';
import { erc20Abi, http, type Hex, type LocalAccount } from 'viem';
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

const queryClient = new QueryClient();
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Create Para client at module level
const para = new Para(
  Environment.BETA,
  import.meta.env.VITE_PARA_API_KEY || ''
);

function ParaWallet() {
  const { openModal } = useModal();
  const { isConnected } = useAccount();
  const { data: wallet } = useWallet();

  const [meeClient, setMeeClient] = useState<MeeClient | null>(null);
  const [orchestrator, setOrchestrator] = useState<MultichainSmartAccount | null>(null);

  // Initialize MEE when wallet connects
  useEffect(() => {
    const init = async () => {
      if (!wallet?.address || !isConnected) return;
      if (meeClient) return;

      try {
        // Create Para viem account
        const viemParaAccount = await createParaAccount(para);

        // Create multichain account
        const multiAccount = await toMultichainNexusAccount({
          chainConfigurations: [
            {
              chain: base,
              transport: http(),
              version: getMEEVersion(MEEVersion.V2_1_0),
            },
          ],
          signer: viemParaAccount as LocalAccount as any,
        });
        setOrchestrator(multiAccount);

        // Create MEE client
        const mee = await createMeeClient({ account: multiAccount });
        setMeeClient(mee);
      } catch (err) {
        console.error('Failed to initialize MEE:', err);
      }
    };

    init();
  }, [wallet?.address, isConnected, meeClient]);

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

  if (!isConnected) {
    return (
      <button onClick={() => openModal()}>
        Sign In / Connect
      </button>
    );
  }

  return (
    <div>
      <p>Wallet: {wallet?.address}</p>
      <button 
        onClick={() => batchTransfer(['0x...', '0x...'])}
        disabled={!meeClient}
      >
        {meeClient ? 'Batch Transfer' : 'Initializing...'}
      </button>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ParaProvider
        paraClientConfig={{
          apiKey: import.meta.env.VITE_PARA_API_KEY,
        }}
        externalWalletConfig={{
          wallets: ['METAMASK'],
          evmConnector: {
            config: {
              chains: [base],
            },
          },
          walletConnect: {
            projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '',
          },
        }}
        config={{ appName: 'My App' }}
      >
        <ParaWallet />
      </ParaProvider>
    </QueryClientProvider>
  );
}
```

## Para-Specific Features

### Authentication Methods

Para supports multiple auth methods:

- **Email**: OTP-based authentication
- **Passkeys**: WebAuthn/FIDO2 biometric auth
- **External Wallets**: MetaMask, WalletConnect, etc.

### Environment Types

```typescript
import { Environment } from '@getpara/web-sdk';

// Development/Testing
const para = new Para(Environment.BETA, apiKey);

// Production
const para = new Para(Environment.PROD, apiKey);
```

### Modal Customization

The Para modal can be customized via the provider:

```typescript
<ParaProvider
  paraClientConfig={{
    apiKey: apiKey,
  }}
  config={{
    appName: 'Your App',
    // Additional config options
  }}
>
```

## Important Notes

### Session Sharing

The Para SDK instance created at the module level shares its session with the React SDK:

```typescript
// This instance shares session with <ParaProvider>
const para = new Para(Environment.BETA, apiKey);
```

This ensures that when a user authenticates via the React modal, the same session is available for signing operations.

### Viem Integration Package

Always use `@getpara/viem-v2-integration` for creating signers:

```typescript
import { createParaAccount } from '@getpara/viem-v2-integration';

// ✅ Correct - uses official integration
const account = await createParaAccount(para);

// ❌ Incorrect - don't manually create accounts
```

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| "Missing API Key" | Env var not set | Check `.env` file |
| "Session expired" | User session timed out | Prompt re-authentication |
| "Not connected" | User hasn't authenticated | Show `openModal()` |

## Resources

- [Para Documentation](https://docs.getpara.com/)
- [Para Developer Portal](https://developer.getpara.com)
- [AbstractJS Docs](https://docs.biconomy.io/abstractjs)
- [MEE Scan Explorer](https://meescan.biconomy.io/)

