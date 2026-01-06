# Privy + Biconomy AbstractJS

This tutorial shows how to integrate Biconomy's AbstractJS with Privy's authentication SDK for gas-abstracted batch transactions with email-first onboarding.

## Prerequisites

- Privy account and App ID
- Node.js 18+
- Basic knowledge of viem and React

## Step 1: Get Your Keys

### Privy App ID

1. Go to [dashboard.privy.io](https://dashboard.privy.io)
2. Create a new app or select existing
3. Navigate to **Settings**
4. Copy your **App ID**

### Configure Privy Settings

In your Privy dashboard:

1. Go to **Login Methods** → Enable **Email**
2. Go to **Embedded Wallets** → Enable **Create wallet for users on login**
3. Go to **Chains** → Add **Base** (chain ID: 8453)

### Biconomy Keys

Biconomy AbstractJS doesn't require API keys for basic usage. For production, optionally register at [dashboard.biconomy.io](https://dashboard.biconomy.io/).

## Step 2: Install Dependencies

```bash
npm install @biconomy/abstractjs viem @privy-io/react-auth
```

## Step 3: Configure Environment Variables

Create a `.env` file:

```bash
VITE_PRIVY_APP_ID=your_privy_app_id_here
```

## Step 4: Set Up the Privy Provider

Wrap your app with `PrivyProvider`:

```typescript
import { PrivyProvider } from '@privy-io/react-auth';
import { base } from 'viem/chains';

function App() {
  return (
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID}
      config={{
        // Enable email login
        loginMethods: ['email'],
        
        // Styling
        appearance: {
          theme: 'light',
          accentColor: '#111111',
        },
        
        // Auto-create embedded wallets
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets',
          },
        },
        
        // Configure chains
        defaultChain: base,
        supportedChains: [base],
      }}
    >
      <YourComponent />
    </PrivyProvider>
  );
}
```

## Step 5: Use Privy Hooks for Authentication

```typescript
import { usePrivy, useWallets } from '@privy-io/react-auth';

function YourComponent() {
  const { ready, authenticated, user, logout } = usePrivy();
  const { wallets } = useWallets();
  
  // Get the embedded wallet created by Privy
  const embeddedWallet = wallets.find(
    (wallet) => wallet.walletClientType === 'privy'
  );
  
  if (!ready) {
    return <div>Loading...</div>;
  }
  
  if (!authenticated) {
    return <LoginForm />;
  }
  
  return <div>Wallet: {embeddedWallet?.address}</div>;
}
```

## Step 6: Implement Email Login

Privy provides hooks for email OTP authentication:

```typescript
import { useLoginWithEmail } from '@privy-io/react-auth';

function LoginForm() {
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);

  const handleSendCode = async () => {
    await sendCode({ email });
    setCodeSent(true);
  };

  const handleLogin = async () => {
    await loginWithCode({ code });
  };

  return (
    <div>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        disabled={codeSent}
      />
      
      {!codeSent ? (
        <button onClick={handleSendCode}>Send Code</button>
      ) : (
        <>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter 6-digit code"
          />
          <button onClick={handleLogin}>Verify & Login</button>
        </>
      )}
    </div>
  );
}
```

## Step 7: Create a Signer for AbstractJS

Privy's embedded wallet requires a custom signer adapter:

```typescript
import { toAccount } from 'viem/accounts';
import { getAddress, type Hex, type LocalAccount } from 'viem';

async function createPrivySigner(embeddedWallet: any): Promise<LocalAccount> {
  // Switch to Base chain first
  await embeddedWallet.switchChain(base.id);
  
  // Get the Ethereum provider from Privy
  const provider = await embeddedWallet.getEthereumProvider();
  const address = getAddress(embeddedWallet.address) as Hex;

  // Create a LocalAccount that delegates signing to Privy
  const signer = toAccount({
    address,

    // Sign message using personal_sign
    async signMessage({ message }) {
      let messageToSign: string;
      
      if (typeof message === 'string') {
        messageToSign = message;
      } else if (typeof message === 'object' && 'raw' in message) {
        const raw = message.raw;
        messageToSign = typeof raw === 'string'
          ? raw
          : `0x${Buffer.from(raw).toString('hex')}`;
      } else {
        messageToSign = String(message);
      }

      const signature = await provider.request({
        method: 'personal_sign',
        params: [messageToSign, address],
      });
      return signature as Hex;
    },

    // Sign typed data using eth_signTypedData_v4
    async signTypedData(typedData) {
      // Serialize BigInt values to strings
      const replacer = (_key: string, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value;

      const signature = await provider.request({
        method: 'eth_signTypedData_v4',
        params: [address, JSON.stringify(typedData, replacer)],
      });
      return signature as Hex;
    },

    // Not used by abstractjs
    async signTransaction() {
      throw new Error('signTransaction not supported - use MEE');
    },
  }) as LocalAccount;

  return signer;
}
```

## Step 8: Set Up the Multichain Nexus Account

```typescript
import {
  toMultichainNexusAccount,
  getMEEVersion,
  MEEVersion,
} from '@biconomy/abstractjs';
import { http } from 'viem';
import { base } from 'viem/chains';

async function initMee(embeddedWallet: any) {
  const signer = await createPrivySigner(embeddedWallet);

  const multiAccount = await toMultichainNexusAccount({
    chainConfigurations: [
      {
        chain: base,
        transport: http(),
        version: getMEEVersion(MEEVersion.V2_1_0),
      },
    ],
    signer: signer as any,
  });

  return multiAccount;
}
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
import {
  PrivyProvider,
  usePrivy,
  useLoginWithEmail,
  useWallets,
} from '@privy-io/react-auth';
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

function PrivyWallet() {
  const { ready, authenticated, logout } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { wallets } = useWallets();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [meeClient, setMeeClient] = useState<MeeClient | null>(null);
  const [orchestrator, setOrchestrator] = useState<MultichainSmartAccount | null>(null);

  const embeddedWallet = wallets.find((w) => w.walletClientType === 'privy');

  // Initialize MEE when wallet is available
  useEffect(() => {
    const init = async () => {
      if (!embeddedWallet?.address) return;
      if (meeClient) return;

      try {
        await embeddedWallet.switchChain(base.id);
        const provider = await embeddedWallet.getEthereumProvider();
        const address = getAddress(embeddedWallet.address) as Hex;

        const signer = toAccount({
          address,
          async signMessage({ message }) {
            let msg: string;
            if (typeof message === 'string') {
              msg = message;
            } else if (typeof message === 'object' && 'raw' in message) {
              const raw = message.raw;
              msg = typeof raw === 'string' ? raw : `0x${Buffer.from(raw).toString('hex')}`;
            } else {
              msg = String(message);
            }
            return await provider.request({
              method: 'personal_sign',
              params: [msg, address],
            }) as Hex;
          },
          async signTypedData(typedData) {
            const replacer = (_k: string, v: unknown) =>
              typeof v === 'bigint' ? v.toString() : v;
            return await provider.request({
              method: 'eth_signTypedData_v4',
              params: [address, JSON.stringify(typedData, replacer)],
            }) as Hex;
          },
          async signTransaction() {
            throw new Error('Use MEE');
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
      } catch (err) {
        console.error('Failed to init MEE:', err);
      }
    };

    init();
  }, [embeddedWallet?.address, meeClient]);

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

  if (!ready) return <div>Loading...</div>;

  if (!authenticated) {
    return (
      <div>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          disabled={codeSent}
        />
        {!codeSent ? (
          <button onClick={() => { sendCode({ email }); setCodeSent(true); }}>
            Send Code
          </button>
        ) : (
          <>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6-digit code"
            />
            <button onClick={() => loginWithCode({ code })}>
              Verify
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <p>Wallet: {embeddedWallet?.address}</p>
      <button onClick={logout}>Sign Out</button>
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
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID}
      config={{
        loginMethods: ['email'],
        appearance: { theme: 'light', accentColor: '#111111' },
        embeddedWallets: {
          ethereum: { createOnLogin: 'users-without-wallets' },
        },
        defaultChain: base,
        supportedChains: [base],
      }}
    >
      <PrivyWallet />
    </PrivyProvider>
  );
}
```

## Privy-Specific Features

### Login Methods

Privy supports multiple auth methods. Configure in `loginMethods`:

```typescript
loginMethods: ['email', 'sms', 'google', 'twitter', 'discord', 'github', 'wallet']
```

### Embedded Wallet Options

Control when wallets are created:

```typescript
embeddedWallets: {
  ethereum: {
    // Options:
    // - 'users-without-wallets': Only for users without external wallets
    // - 'all-users': Create for everyone
    // - 'off': Disable embedded wallets
    createOnLogin: 'users-without-wallets',
  },
}
```

### Theming

Customize the Privy UI:

```typescript
appearance: {
  theme: 'light',  // or 'dark'
  accentColor: '#111111',
  logo: 'https://your-logo.png',
}
```

### Multi-Chain Support

Add multiple chains:

```typescript
import { base, optimism, arbitrum } from 'viem/chains';

config={{
  defaultChain: base,
  supportedChains: [base, optimism, arbitrum],
}}
```

## Important Notes

### Chain Switching

Always switch to the correct chain before operations:

```typescript
await embeddedWallet.switchChain(base.id);
```

### BigInt Serialization

When signing typed data, serialize BigInt values:

```typescript
const replacer = (_key: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value;

JSON.stringify(typedData, replacer);
```

### Finding the Embedded Wallet

Privy may expose multiple wallets. Filter for the embedded one:

```typescript
const embeddedWallet = wallets.find(
  (wallet) => wallet.walletClientType === 'privy'
);
```

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| "Missing App ID" | Env var not set | Check `.env` file |
| "Wallet not found" | Embedded wallet not created | Ensure `createOnLogin` is set |
| "Invalid code" | Wrong OTP entered | Prompt user to retry |
| "Chain not supported" | Chain not in `supportedChains` | Add chain to config |

## Resources

- [Privy Documentation](https://docs.privy.io/)
- [Privy Dashboard](https://dashboard.privy.io)
- [AbstractJS Docs](https://docs.biconomy.io/abstractjs)
- [MEE Scan Explorer](https://meescan.biconomy.io/)

