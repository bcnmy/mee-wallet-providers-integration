import { useState, useEffect } from 'react';
import {
  DynamicContextProvider,
  DynamicWidget,
  useDynamicContext,
  useUserWallets,
} from '@dynamic-labs/sdk-react-core';
import { EthereumWalletConnectors, isEthereumWallet } from '@dynamic-labs/ethereum';
import {
  erc20Abi,
  formatUnits,
  http,
  type Hex,
  getAddress,
  type LocalAccount,
} from 'viem';
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
const USDC_DECIMALS = 6;
const TRANSFER_AMOUNT = 100_000n; // 0.1 USDC

function DynamicWallet() {
  const { user, handleLogOut, sdkHasLoaded, primaryWallet: contextPrimaryWallet } = useDynamicContext();
  const isAuthenticated = !!user;
  const userWallets = useUserWallets();
  
  // Get the first available wallet - try context first, then userWallets hook
  const primaryWallet = contextPrimaryWallet || userWallets[0];
  
  // Debug logging
  useEffect(() => {
    console.log('[Dynamic] Auth state:', { isAuthenticated, sdkHasLoaded });
    console.log('[Dynamic] User:', user);
    console.log('[Dynamic] Context primaryWallet:', contextPrimaryWallet);
    console.log('[Dynamic] User wallets hook:', userWallets);
    console.log('[Dynamic] Selected wallet:', primaryWallet);
    console.log('[Dynamic] Wallet address:', primaryWallet?.address);
  }, [isAuthenticated, sdkHasLoaded, user, userWallets, primaryWallet, contextPrimaryWallet]);

  const [status, setStatus] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<string[]>(['']);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [meeScanLink, setMeeScanLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Biconomy MEE state - uses Fusion mode with Companion Smart Account
  const [meeClient, setMeeClient] = useState<MeeClient | null>(null);
  const [orchestrator, setOrchestrator] = useState<MultichainSmartAccount | null>(null);

  // Initialize Biconomy MEE when wallet is available
  // Uses Fusion mode with a Companion Smart Account (orchestrator)
  // The orchestrator handles batching and gas abstraction while tokens are pulled from the EOA
  useEffect(() => {
    const initMee = async () => {
      if (!primaryWallet?.address) return;
      if (meeClient) return; // Already initialized
      
      // Check if it's an Ethereum wallet (has getWalletClient method)
      if (!isEthereumWallet(primaryWallet)) {
        console.error('[Dynamic] Wallet is not an Ethereum wallet');
        return;
      }

      try {
        console.log('[Dynamic] Initializing Biconomy MEE with Fusion mode...');

        // Try to switch to Base chain (might already be on it or not supported)
        try {
          await primaryWallet.switchNetwork(base.id);
          console.log('[Dynamic] Switched to Base network');
        } catch (switchErr) {
          console.log('[Dynamic] Network switch skipped:', switchErr);
          // Continue anyway - wallet might already be on Base or doesn't support switching
        }

        // Get the viem wallet client from Dynamic for Base chain
        const walletClient = await primaryWallet.getWalletClient(base.id.toString());

        // Get checksummed address
        const address = getAddress(primaryWallet.address) as Hex;
        console.log('[Dynamic] Wallet address:', address);

        // Create a LocalAccount that delegates signing to Dynamic's wallet client
        // The wallet client provides native viem signing methods
        const signer = toAccount({
          address,

          // Sign message using the wallet client's native signMessage
          async signMessage({ message }) {
            const signature = await walletClient.signMessage({
              account: walletClient.account!,
              message,
            });
            return signature;
          },

          // Sign typed data using the wallet client's native signTypedData
          async signTypedData(typedData) {
            const signature = await walletClient.signTypedData({
              account: walletClient.account!,
              ...typedData,
            } as any);
            return signature;
          },

          // Not used by abstractjs but required by the Account interface
          async signTransaction() {
            throw new Error('signTransaction not supported - use MEE for transactions');
          },
        }) as LocalAccount;

        // Create multichain account - this creates a Companion Smart Account (orchestrator)
        // The orchestrator acts as a passthrough executor that handles batching and fee payments
        // No accountAddress specified = creates a separate companion account (not EIP-7702)
        const multiAccount = await toMultichainNexusAccount({
          chainConfigurations: [
            {
              chain: base,
              transport: http(),
              version: getMEEVersion(MEEVersion.V2_1_0),
            },
          ],
          // Cast to any to bypass AbstractJS type restrictions
          // The account implements all required signing methods
          signer: signer as any,
        });
        setOrchestrator(multiAccount);

        const mee = await createMeeClient({ account: multiAccount });
        setMeeClient(mee);
        console.log('[Dynamic] MEE Client initialized with Fusion mode');
      } catch (err) {
        console.error('[Dynamic] Failed to initialize MEE:', err);
        setStatus(`Error initializing MEE: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    initMee();
  }, [primaryWallet?.address, meeClient]);

  // Fetch USDC balance
  useEffect(() => {
    const fetchBalance = async () => {
      if (!primaryWallet?.address) return;

      try {
        const response = await fetch('https://mainnet.base.org', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_call',
            params: [
              {
                to: USDC_ADDRESS,
                data: `0x70a08231000000000000000000000000${primaryWallet.address.slice(2)}`,
              },
              'latest',
            ],
          }),
        });
        const data = await response.json();
        if (data.result) {
          setBalance(BigInt(data.result));
        }
      } catch (err) {
        console.error('Failed to fetch balance:', err);
      }
    };

    fetchBalance();
    const interval = setInterval(fetchBalance, 10000);
    return () => clearInterval(interval);
  }, [primaryWallet?.address]);

  const handleRecipientChange = (index: number, value: string) => {
    const newRecipients = [...recipients];
    newRecipients[index] = value;
    setRecipients(newRecipients);
  };

  const addRecipient = () => setRecipients([...recipients, '']);
  const removeRecipient = (index: number) => {
    if (recipients.length > 1) {
      setRecipients(recipients.filter((_, i) => i !== index));
    }
  };

  const copyAddress = async () => {
    if (!primaryWallet?.address) return;
    await navigator.clipboard.writeText(primaryWallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const executeTransfers = async () => {
    if (!orchestrator || !meeClient || !primaryWallet) {
      setStatus('Error: MEE client not initialized. Please wait...');
      return;
    }

    const validRecipients = recipients.filter((r) => r.trim().length > 0);
    if (validRecipients.length === 0) {
      setStatus('Error: Please add at least one recipient.');
      return;
    }

    try {
      setStatus('Preparing transaction...');

      // Ensure we're on Base (skip if already on Base or switch not supported)
      try {
        await primaryWallet.switchNetwork(base.id);
        console.log('[Dynamic] Switched to Base for transfer');
      } catch (e) {
        console.log('[Dynamic] Network switch skipped for transfer:', e);
      }

      setStatus('Building transfer instructions...');
      // Build composable instructions for each transfer
      // These will be executed by the Companion Smart Account (orchestrator)
      const transfers = await Promise.all(
        validRecipients.map((recipient) =>
          orchestrator.buildComposable({
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

      const totalAmount = BigInt(transfers.length) * TRANSFER_AMOUNT;

      setStatus('Simulating & requesting Fusion Quote...');
      // Fusion flow: The trigger authorizes the orchestrator to pull tokens from the EOA
      // This enables gas abstraction and batching with a single signature
      const fusionQuote = await meeClient.getFusionQuote({
        instructions: transfers,
        // Trigger pulls USDC from the user's EOA to the orchestrator
        trigger: {
          chainId: base.id,
          tokenAddress: USDC_ADDRESS,
          amount: totalAmount,
        },
        // Gas fees are paid in USDC (not ETH)
        feeToken: {
          address: USDC_ADDRESS,
          chainId: base.id,
        },
        // Enable simulation to get precise gas estimates and optimize costs
        // This adds ~250ms latency but provides tight gas limits for lower fees
        simulation: {
          simulate: true,
        },
      });

      setStatus('Awaiting signature...');
      // Execute the fusion quote - user signs once to authorize everything
      // The signature covers: token pull permission + all instructions + fee payment
      const { hash } = await meeClient.executeFusionQuote({ fusionQuote });

      const link = getMeeScanLink(hash);
      setMeeScanLink(link);
      setStatus('Waiting for confirmation...');

      await meeClient.waitForSupertransactionReceipt({ hash });
      setStatus('Transaction confirmed!');
    } catch (err: any) {
      console.error(err);
      setStatus(`Error: ${err.message}`);
    }
  };

  if (!sdkHasLoaded) {
    return (
      <div className="page-content">
        <div className="page-header">
          <h1>Dynamic + Biconomy MEE</h1>
          <p className="page-description">Multi-chain wallet with gas-abstracted transfers</p>
        </div>
        <div className="card">
          <div className="loading-state">Loading Dynamic...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Dynamic + Biconomy MEE</h1>
        <p className="page-description">
          Multi-chain wallet with gas-abstracted transfers (pay fees in USDC)
        </p>
      </div>

      {!user?.userId ? (
        <div className="login-container">
          <div className="card" style={{ maxWidth: '400px', width: '100%' }}>
            <div
              className="card-header"
              style={{
                justifyContent: 'center',
                flexDirection: 'column',
                gap: '8px',
                marginBottom: '24px',
              }}
            >
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Welcome to Dynamic</h2>
              <p className="tagline">Connect with email, social, or your wallet</p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <DynamicWidget />
            </div>
          </div>
        </div>
      ) : userWallets.length === 0 || !primaryWallet?.address ? (
        <div className="card" style={{ maxWidth: '500px' }}>
          <div className="card-header">
            <span className="card-title">Connect a Wallet</span>
            <button className="btn btn-small" onClick={handleLogOut}>
              Sign Out
            </button>
          </div>
          <div style={{ padding: '16px 0' }}>
            <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
              Logged in as <strong>{user.email}</strong>
            </p>
            <p style={{ marginBottom: '16px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Please connect an Ethereum wallet to continue, or enable Embedded Wallets in your{' '}
              <a href="https://app.dynamic.xyz" target="_blank" rel="noopener noreferrer">
                Dynamic Dashboard
              </a>
              .
            </p>
            <DynamicWidget />
          </div>
        </div>
      ) : (
        <div className="dashboard">
          {/* Wallet Card */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Total Balance</span>
              <button className="btn btn-small" onClick={handleLogOut}>
                Sign Out
              </button>
            </div>

            <div className="balance-wrapper">
              <span className="balance-amount">
                {balance !== null ? formatUnits(balance, USDC_DECIMALS) : '0.00'}
              </span>
              <span className="balance-unit">USDC</span>
            </div>

            <div className="wallet-info" style={{ marginTop: '20px' }}>
              <div className="info-row">
                <span className="info-label">Wallet</span>
                <button
                  className="address-pill address-copy"
                  onClick={copyAddress}
                  title="Click to copy address"
                >
                  {primaryWallet.address.slice(0, 6)}...
                  {primaryWallet.address.slice(-4)}
                  <span className="copy-icon">{copied ? '✓' : '⧉'}</span>
                </button>
              </div>
              {user?.email && (
                <div className="info-row" style={{ marginTop: '8px' }}>
                  <span className="info-label">Email</span>
                  <span className="info-value">{user.email}</span>
                </div>
              )}
            </div>

            {!meeClient && (
              <div
                style={{
                  marginTop: '16px',
                  padding: '12px',
                  background: '#f8f9fa',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                Initializing Biconomy MEE...
              </div>
            )}
          </div>

          {/* Operations Card */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Quick Transfer</span>
            </div>

            <div className="input-group">
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Recipients (0.10 USDC each)
              </label>

              {recipients.map((recipient, idx) => (
                <div key={idx} className="input-row">
                  <span className="index-badge">{idx + 1}</span>
                  <input
                    type="text"
                    className="input-field"
                    value={recipient}
                    onChange={(e) => handleRecipientChange(idx, e.target.value)}
                    placeholder="Enter 0x address"
                  />
                  <button
                    className="btn btn-icon"
                    onClick={() => removeRecipient(idx)}
                    disabled={recipients.length === 1}
                    title="Remove recipient"
                  >
                    ✕
                  </button>
                </div>
              ))}

              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <button className="btn btn-add" onClick={addRecipient}>
                  + Add another recipient
                </button>
              </div>

              <div style={{ marginTop: '32px' }}>
                <button
                  className="btn btn-primary"
                  onClick={executeTransfers}
                  disabled={!meeClient}
                >
                  {meeClient ? 'Pay Now' : 'Setting up Biconomy MEE...'}
                </button>

                {status && (
                  <div
                    className={`status-message ${
                      status.includes('Error') ? 'status-error' : 'status-info'
                    }`}
                    style={{ marginTop: '16px' }}
                  >
                    {status}
                  </div>
                )}

                {meeScanLink && (
                  <div className="status-success">
                    Payment Successful!
                    <a
                      href={meeScanLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="status-link"
                    >
                      View on MEE Scan
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DynamicExample() {
  const environmentId = import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID;

  if (!environmentId) {
    return (
      <div className="page-content">
        <div className="page-header">
          <h1>Dynamic + Biconomy MEE</h1>
          <p className="page-description">Multi-chain wallet with gas-abstracted transfers</p>
        </div>

        <div className="card" style={{ maxWidth: '600px' }}>
          <div className="card-header">
            <span className="card-title">Configuration Required</span>
          </div>

          <div className="error-box">
            <p>
              <strong>Missing Environment ID</strong>
            </p>
            <p>
              Please add your Dynamic Environment ID to the <code>.env</code> file:
            </p>
            <pre className="code-block">VITE_DYNAMIC_ENVIRONMENT_ID=your_environment_id_here</pre>
            <p style={{ marginTop: '16px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Get your Environment ID at{' '}
              <a href="https://app.dynamic.xyz" target="_blank" rel="noopener noreferrer">
                app.dynamic.xyz
              </a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <DynamicContextProvider
      settings={{
        environmentId,
        walletConnectors: [EthereumWalletConnectors],
        overrides: {
          evmNetworks: [
            {
              chainId: base.id,
              networkId: base.id,
              name: base.name,
              nativeCurrency: base.nativeCurrency,
              rpcUrls: ['https://mainnet.base.org'],
              blockExplorerUrls: [base.blockExplorers?.default.url || 'https://basescan.org'],
              iconUrls: ['https://avatars.githubusercontent.com/u/108554348'],
            },
          ],
        },
      }}
    >
      <DynamicWallet />
    </DynamicContextProvider>
  );
}

