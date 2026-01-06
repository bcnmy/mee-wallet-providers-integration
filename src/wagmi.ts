import { base } from 'wagmi/chains';
import { createConfig, http } from 'wagmi';

export const config = createConfig({
  chains: [base],
  transports: {
    [base.id]: http()
  }
});

