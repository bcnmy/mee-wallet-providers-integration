import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from './wagmi';
import App from './App';
import BiconomyExample from './pages/BiconomyExample';
import ParaExample from './pages/ParaExample';
import PrivyExample from './pages/PrivyExample';
import DynamicExample from './pages/DynamicExample';
import './index.css';

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <WagmiProvider config={config}>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />}>
            <Route index element={<BiconomyExample />} />
            <Route path="para" element={<ParaExample />} />
            <Route path="privy" element={<PrivyExample />} />
            <Route path="dynamic" element={<DynamicExample />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </WagmiProvider>
);
