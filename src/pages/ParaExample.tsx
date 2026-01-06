import { useState, useEffect, useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ParaProvider, useModal, useAccount, useWallet } from '@getpara/react-sdk';
import '@getpara/react-sdk/styles.css';
import Para, { Environment } from '@getpara/web-sdk';
import { createParaAccount } from '@getpara/viem-v2-integration';
import { base } from 'viem/chains';
import {
  erc20Abi,
  formatUnits,
  http,
  type Hex,
  type LocalAccount,
} from 'viem';
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
const USDC_DECIMALS = 6;
const TRANSFER_AMOUNT = 100_000n; // 0.1 USDC

// Create Para client at module level - will share session with React SDK
const para = new Para(
  Environment.BETA,
  import.meta.env.VITE_PARA_API_KEY || ''
);

function ParaWallet() {
  const { openModal } = useModal();
  const { isConnected } = useAccount();
  const { data: wallet } = useWallet();

  const [status, setStatus] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<string[]>(['']);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [meeScanLink, setMeeScanLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Biconomy MEE state - uses Fusion mode with Companion Smart Account
  const [meeClient, setMeeClient] = useState<MeeClient | null>(null);
  const [orchestrator, setOrchestrator] = useState<MultichainSmartAccount | null>(null);

  // Initialize Biconomy MEE when wallet is connected
  // Uses Fusion mode with a Companion Smart Account (orchestrator)
  // The orchestrator handles batching and gas abstraction while tokens are pulled from the EOA
  useEffect(() => {
    const initMee = async () => {
      if (!wallet?.address || !isConnected) return;
      if (meeClient) return; // Already initialized

      try {
        console.log('[Para] Initializing Biconomy MEE with Fusion mode...');
        console.log('[Para] Wallet address:', wallet.address);

        // Create a Para viem account using the @getpara/viem-v2-integration package
        // This creates a LocalAccount that delegates signing to Para's signing methods
        const viemParaAccount = await createParaAccount(para);
        console.log('[Para] Created Para viem account');

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
          signer: viemParaAccount as LocalAccount as any,
        });
        setOrchestrator(multiAccount);

        const mee = await createMeeClient({ account: multiAccount });
        setMeeClient(mee);
        console.log('[Para] MEE Client initialized with Fusion mode');
      } catch (err) {
        console.error('[Para] Failed to initialize MEE:', err);
        setStatus(`Error initializing MEE: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    initMee();
  }, [wallet?.address, isConnected, meeClient]);

  // Fetch USDC balance
  useEffect(() => {
    const fetchBalance = async () => {
      if (!wallet?.address) return;

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
                data: `0x70a08231000000000000000000000000${wallet.address.slice(2)}`,
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
  }, [wallet?.address]);

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
    if (!wallet?.address) return;
    await navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const executeTransfers = async () => {
    if (!orchestrator || !meeClient || !wallet?.address) {
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

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Para + Biconomy MEE</h1>
        <p className="page-description">Embedded wallet with gas-abstracted transfers (pay fees in USDC)</p>
      </div>

      {!isConnected ? (
        <div className="login-container">
          <div className="card login-card">
            <div
              className="card-header"
              style={{
                justifyContent: 'center',
                flexDirection: 'column',
                gap: '8px',
                marginBottom: '32px',
              }}
            >
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Welcome to Para</h2>
              <p className="tagline">Sign in with email or connect your wallet</p>
            </div>
            <button className="btn btn-primary" onClick={() => openModal()}>
              Sign In / Connect
            </button>
          </div>
        </div>
      ) : (
        <div className="dashboard">
          {/* Wallet Card */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Total Balance</span>
              <button className="btn btn-small" onClick={() => openModal()}>
                Manage
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
                  {wallet?.address?.slice(0, 6)}...{wallet?.address?.slice(-4)}
                  <span className="copy-icon">{copied ? '✓' : '⧉'}</span>
                </button>
              </div>
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

export default function ParaExample() {
  const apiKey = import.meta.env.VITE_PARA_API_KEY;

  if (!apiKey) {
    return (
      <div className="page-content">
        <div className="page-header">
          <h1>Para + Biconomy MEE</h1>
          <p className="page-description">Embedded wallet with gas-abstracted transfers</p>
        </div>

        <div className="card" style={{ maxWidth: '600px' }}>
          <div className="card-header">
            <span className="card-title">Configuration Required</span>
          </div>

          <div className="error-box">
            <p>
              <strong>Missing API Key</strong>
            </p>
            <p>
              Please add your Para API key to the <code>.env</code> file:
            </p>
            <pre className="code-block">VITE_PARA_API_KEY=your_api_key_here</pre>
            <p style={{ marginTop: '16px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Get your API key at{' '}
              <a href="https://developer.getpara.com" target="_blank" rel="noopener noreferrer">
                developer.getpara.com
              </a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ParaProvider
        paraClientConfig={{
          apiKey: apiKey,
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
        config={{ appName: 'Transak Bico Demo' }}
      >
        <ParaWallet />
      </ParaProvider>
    </QueryClientProvider>
  );
}
