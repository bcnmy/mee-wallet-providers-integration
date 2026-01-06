# Biconomy AbstractJS Integration Tutorials

This guide covers how to integrate Biconomy's AbstractJS (MEE Client) with various wallet providers for gas-abstracted, multi-chain transactions.

## What is Biconomy AbstractJS?

Biconomy AbstractJS is a toolkit for building chain-abstracted applications. It provides:

- **MEE (Multi-chain Execution Engine)**: Execute batched transactions across chains with a single signature
- **Fusion Mode**: Pull tokens from user EOAs and pay gas in ERC-20 tokens (like USDC)
- **Smart Account Orchestration**: Companion smart accounts handle batching and fee payments

## Available Tutorials

| Provider | Description | Auth Methods |
|----------|-------------|--------------|
| [MetaMask (Browser Wallet)](./biconomy.md) | Direct browser wallet integration | Wallet connection |
| [Dynamic](./dynamic.md) | Multi-auth platform with embedded wallets | Email, Social, Wallet |
| [Para](./para.md) | Embedded wallet infrastructure | Email, Passkeys, Wallet |
| [Privy](./privy.md) | Auth infrastructure with embedded wallets | Email, SMS, Social |

## Quick Start

### 1. Install Dependencies

```bash
npm install @biconomy/abstractjs viem
```

### 2. Choose a Provider

Pick a wallet provider based on your needs:

- **MetaMask**: Best for dApps targeting existing crypto users
- **Dynamic**: Best for flexible multi-auth with good UX
- **Para**: Best for seamless embedded wallet experiences
- **Privy**: Best for email-first onboarding

### 3. Core Concepts

All integrations follow the same pattern:

```typescript
import {
  createMeeClient,
  toMultichainNexusAccount,
  getMeeScanLink,
  getMEEVersion,
  MEEVersion,
} from '@biconomy/abstractjs';

// 1. Create a signer from your provider
const signer = /* provider-specific signer */;

// 2. Create multichain account (orchestrator)
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

// 3. Create MEE Client
const meeClient = await createMeeClient({ account: multiAccount });

// 4. Build instructions, get quote, execute
const instructions = await multiAccount.buildComposable({ ... });
const quote = await meeClient.getFusionQuote({ ... });
const { hash } = await meeClient.executeFusionQuote({ fusionQuote: quote });
```

## Environment Variables

Create a `.env` file with the required variables for your chosen provider:

```bash
# Dynamic (required for Dynamic integration)
VITE_DYNAMIC_ENVIRONMENT_ID=your_environment_id

# Para (required for Para integration)
VITE_PARA_API_KEY=your_api_key

# Privy (required for Privy integration)
VITE_PRIVY_APP_ID=your_app_id

# WalletConnect (optional, for external wallet connections)
VITE_WALLETCONNECT_PROJECT_ID=your_project_id
```

## Supported Chains

AbstractJS supports multiple chains. This demo uses Base (chain ID: 8453), but you can configure any supported EVM chain.

## Resources

- [AbstractJS Documentation](https://docs.biconomy.io/abstractjs)
- [MEE Scan Explorer](https://meescan.biconomy.io/)
- [Biconomy Dashboard](https://dashboard.biconomy.io/)

