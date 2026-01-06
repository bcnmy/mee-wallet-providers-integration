import { useState, useEffect } from 'react';
import {
  PrivyProvider,
  usePrivy,
  useLoginWithEmail,
  useWallets,
} from '@privy-io/react-auth';
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

function PrivyWallet() {
  const { ready, authenticated, user, logout } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { wallets } = useWallets();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<string[]>(['']);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [meeScanLink, setMeeScanLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Biconomy MEE state - uses Fusion mode with Companion Smart Account
  const [meeClient, setMeeClient] = useState<MeeClient | null>(null);
  const [orchestrator, setOrchestrator] = useState<MultichainSmartAccount | null>(null);

  // Get the embedded wallet
  const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === 'privy');

  // Initialize Biconomy MEE when wallet is available
  // Uses Fusion mode with a Companion Smart Account (orchestrator)
  // The orchestrator handles batching and gas abstraction while tokens are pulled from the EOA
  useEffect(() => {
    const initMee = async () => {
      if (!embeddedWallet?.address) return;
      if (meeClient) return; // Already initialized

      try {
        console.log('[Privy] Initializing Biconomy MEE with Fusion mode...');
        
        // Switch to Base chain first
        await embeddedWallet.switchChain(base.id);
        
        const provider = await embeddedWallet.getEthereumProvider();
        
        // Get checksummed address
        const address = getAddress(embeddedWallet.address) as Hex;
        console.log('[Privy] Wallet address:', address);

        // Create a LocalAccount that delegates signing to Privy's provider
        // This avoids the "from should be same as current address" error by using
        // Privy's signing methods directly rather than going through viem's JsonRpcAccount
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
            // Serialize with BigInt support
            const replacer = (_key: string, value: unknown) =>
              typeof value === 'bigint' ? value.toString() : value;
            
            const signature = await provider.request({
              method: 'eth_signTypedData_v4',
              params: [address, JSON.stringify(typedData, replacer)],
            });
            return signature as Hex;
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
        console.log('[Privy] MEE Client initialized with Fusion mode');
      } catch (err) {
        console.error('[Privy] Failed to initialize MEE:', err);
      }
    };

    initMee();
  }, [embeddedWallet?.address, meeClient]);

  // Fetch USDC balance
  useEffect(() => {
    const fetchBalance = async () => {
      if (!embeddedWallet?.address) return;

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
                data: `0x70a08231000000000000000000000000${embeddedWallet.address.slice(2)}`,
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
  }, [embeddedWallet?.address]);

  const handleSendCode = async () => {
    try {
      setStatus('Sending code...');
      await sendCode({ email });
      setCodeSent(true);
      setStatus('Code sent! Check your email.');
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
  };

  const handleLogin = async () => {
    try {
      setStatus('Verifying code...');
      await loginWithCode({ code });
      setStatus(null);
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
  };

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
    if (!embeddedWallet?.address) return;
    await navigator.clipboard.writeText(embeddedWallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const executeTransfers = async () => {
    if (!orchestrator || !meeClient || !embeddedWallet) {
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
      
      // Ensure we're on Base
      try {
        await embeddedWallet.switchChain(base.id);
      } catch (e) {
        console.log('[Privy] Already on Base or switch not needed');
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

  if (!ready) {
    return (
      <div className="page-content">
        <div className="page-header">
          <h1>Privy + Biconomy MEE</h1>
          <p className="page-description">Email login with gas-abstracted transfers</p>
        </div>
        <div className="card">
          <div className="loading-state">Loading Privy...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Privy + Biconomy MEE</h1>
        <p className="page-description">Email login with gas-abstracted transfers (pay fees in USDC)</p>
      </div>

      {!authenticated ? (
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
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Sign In with Email</h2>
              <p className="tagline">Enter your email to receive a one-time code</p>
            </div>

            <div className="input-group">
              <div>
                <label className="input-label">Email Address</label>
                <input
                  type="email"
                  className="input-field"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={codeSent}
                />
              </div>

              {!codeSent ? (
                <button className="btn btn-primary" onClick={handleSendCode} disabled={!email}>
                  Send Code
                </button>
              ) : (
                <>
                  <div>
                    <label className="input-label">Verification Code</label>
                    <input
                      type="text"
                      className="input-field"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="Enter 6-digit code"
                    />
                  </div>
                  <button className="btn btn-primary" onClick={handleLogin} disabled={!code}>
                    Verify & Login
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setCodeSent(false);
                      setCode('');
                      setStatus(null);
                    }}
                  >
                    Use Different Email
                  </button>
                </>
              )}

              {status && (
                <div
                  className={`status-message ${
                    status.includes('Error') ? 'status-error' : 'status-info'
                  }`}
                >
                  {status}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="dashboard">
          {/* Wallet Card */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Total Balance</span>
              <button className="btn btn-small" onClick={logout}>
                Sign Out
              </button>
            </div>

            {embeddedWallet ? (
              <>
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
                      {embeddedWallet.address.slice(0, 6)}...
                      {embeddedWallet.address.slice(-4)}
                      <span className="copy-icon">{copied ? '✓' : '⧉'}</span>
                    </button>
                  </div>
                  {user?.email && (
                    <div className="info-row" style={{ marginTop: '8px' }}>
                      <span className="info-label">Email</span>
                      <span className="info-value">{user.email.address}</span>
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
              </>
            ) : (
              <div
                style={{
                  padding: '16px',
                  background: '#f8f9fa',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                Creating embedded wallet...
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

export default function PrivyExample() {
  const appId = import.meta.env.VITE_PRIVY_APP_ID;

  if (!appId) {
    return (
      <div className="page-content">
        <div className="page-header">
          <h1>Privy + Biconomy MEE</h1>
          <p className="page-description">Email login with gas-abstracted transfers</p>
        </div>

        <div className="card" style={{ maxWidth: '600px' }}>
          <div className="card-header">
            <span className="card-title">Configuration Required</span>
          </div>

          <div className="error-box">
            <p>
              <strong>Missing App ID</strong>
            </p>
            <p>
              Please add your Privy App ID to the <code>.env</code> file:
            </p>
            <pre className="code-block">VITE_PRIVY_APP_ID=your_privy_app_id_here</pre>
            <p style={{ marginTop: '16px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Get your App ID at{' '}
              <a href="https://dashboard.privy.io" target="_blank" rel="noopener noreferrer">
                dashboard.privy.io
              </a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['email'],
        appearance: {
          theme: 'light',
          accentColor: '#111111',
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets',
          },
        },
        defaultChain: base,
        supportedChains: [base],
      }}
    >
      <PrivyWallet />
    </PrivyProvider>
  );
}
