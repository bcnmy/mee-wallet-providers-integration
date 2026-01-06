import { useState } from 'react';
import {
  createWalletClient,
  custom,
  erc20Abi,
  http,
  type WalletClient,
  type Hex,
  formatUnits
} from 'viem';
import { base } from 'viem/chains';
import {
  createMeeClient,
  toMultichainNexusAccount,
  getMeeScanLink,
  getMEEVersion,
  MEEVersion,
  type MeeClient,
  type MultichainSmartAccount
} from '@biconomy/abstractjs';
import { useReadContract } from 'wagmi';

export default function BiconomyExample() {
  const [account, setAccount] = useState<string | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [meeClient, setMeeClient] = useState<MeeClient | null>(null);
  const [orchestrator, setOrchestrator] = useState<MultichainSmartAccount | null>(null);
  const [meeScanLink, setMeeScanLink] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<string[]>(['']);
  
  const addLog = (msg: string) => {
    console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
  };

  const usdcAddress = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

  const { data: balance } = useReadContract({
    abi: erc20Abi,
    address: usdcAddress,
    chainId: base.id,
    functionName: 'balanceOf',
    args: account ? [account as Hex] : undefined,
    query: { enabled: !!account }
  });

  const addBaseToWallet = async () => {
    try {
      await (window as any).ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${base.id.toString(16)}` }]
      });
    } catch (switchError: any) {
      if (switchError.code === 4902) {
        await (window as any).ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: `0x${base.id.toString(16)}`,
              chainName: base.name,
              nativeCurrency: base.nativeCurrency,
              rpcUrls: [base.rpcUrls.default.http[0]],
              blockExplorerUrls: [base.blockExplorers?.default.url]
            }
          ]
        });
      } else {
        throw switchError;
      }
    }
  };

  const connectAndInit = async () => {
    if (typeof (window as any).ethereum === 'undefined') {
      alert('MetaMask not detected');
      return;
    }

    try {
      addLog('Initializing wallet connection...');
      const wallet = createWalletClient({
        chain: base,
        transport: custom((window as any).ethereum)
      });
      setWalletClient(wallet);
  
      const [address] = await wallet.requestAddresses();
      setAccount(address);
      addLog(`Wallet connected: ${address.slice(0, 6)}...${address.slice(-4)}`);
  
      await addBaseToWallet();
      addLog('Network switched to Base');
  
      addLog('Creating Multichain Nexus Account...');
      const multiAccount = await toMultichainNexusAccount({
        chainConfigurations: [
          {
            chain: base,
            transport: http(),
            version: getMEEVersion(MEEVersion.V2_1_0)
          }
        ],
        signer: createWalletClient({
          account: address,
          transport: custom((window as any).ethereum)
        })
      });
      setOrchestrator(multiAccount);
  
      addLog('Initializing MEE Client...');
      const mee = await createMeeClient({ account: multiAccount });
      setMeeClient(mee);
      addLog('SYSTEM READY. MEE Client initialized.');
    } catch (err: any) {
      addLog(`ERROR: ${err.message}`);
    }
  };

  const executeTransfers = async () => {
    if (!orchestrator || !meeClient || !account) {
      alert('Account not initialized');
      return;
    }

    try {
      addLog('Switching to Base network...');
      await addBaseToWallet();

      addLog('Encoding transfer instructions...');
      const validRecipients = recipients.filter(r => r.length > 0);
      
      if (validRecipients.length === 0) {
        addLog('ERROR: No valid recipients.');
        return;
      }

      const transfers = await Promise.all(
        validRecipients.map((recipient) =>
            orchestrator.buildComposable({
              type: 'default',
              data: {
                abi: erc20Abi,
                chainId: base.id,
                to: usdcAddress,
                functionName: 'transfer',
                args: [recipient as Hex, 100_000n] // 0.1 USDC
              }
            })
          )
      );

      const totalAmount = BigInt(transfers.length) * 100_000n; // 0.1 USDC per recipient

      addLog('Simulating & requesting Fusion Quote...');
      const fusionQuote = await meeClient.getFusionQuote({
        instructions: transfers,
        trigger: {
          chainId: base.id,
          tokenAddress: usdcAddress,
          amount: totalAmount
        },
        feeToken: {
          address: usdcAddress,
          chainId: base.id
        },
        // Enable simulation to get precise gas estimates and optimize costs
        // This adds ~250ms latency but provides tight gas limits for lower fees
        simulation: {
          simulate: true,
        },
      });

      addLog('Quote received. Awaiting signature...');
      const { hash } = await meeClient.executeFusionQuote({ fusionQuote });

      const link = getMeeScanLink(hash);
      setMeeScanLink(link);
      addLog(`Transaction submitted. Hash: ${hash.slice(0, 10)}...`);
      addLog('Waiting for supertransaction receipt...');

      await meeClient.waitForSupertransactionReceipt({ hash });

      addLog('SUCCESS: Transaction confirmed on-chain.');
    } catch (err: any) {
      console.error(err);
      addLog(`ERROR: ${err.message ?? err}`);
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
      const newRecipients = recipients.filter((_, i) => i !== index);
      setRecipients(newRecipients);
    }
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Biconomy MEE Example</h1>
        <p className="page-description">Multi-chain execution with Biconomy's MEE Client</p>
      </div>

      {!account ? (
        <div className="login-container">
          <div className="card login-card">
            <div className="card-header" style={{ justifyContent: 'center', flexDirection: 'column', gap: '8px', marginBottom: '32px' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Welcome Back</h2>
              <p className="tagline">Connect your wallet to manage assets</p>
            </div>
            <button className="btn btn-primary" onClick={connectAndInit}>
              Connect Wallet
            </button>
          </div>
        </div>
      ) : (
        <div className="dashboard">
          
          {/* Wallet Card */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Total Balance</span>
              <span className="address-pill">
                {account.slice(0, 6)}...{account.slice(-4)}
              </span>
            </div>
            
            <div className="balance-wrapper">
              <span className="balance-amount">{balance ? formatUnits(balance, 6) : '0.00'}</span>
              <span className="balance-unit">USDC</span>
            </div>

            {!meeClient && (
              <div style={{ marginTop: '24px', padding: '12px', background: '#f8f9fa', borderRadius: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                Initializing MEE Client...
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
                    placeholder="Enter 0x address or ENS"
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
                  {meeClient ? 'Pay Now' : 'Setting up secure channel...'}
                </button>
                
                {meeScanLink && (
                  <div className="status-success">
                    Payment Successful!
                    <a href={meeScanLink} target="_blank" rel="noopener noreferrer" className="status-link">
                      View Receipt on MEE Scan
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

