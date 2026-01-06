/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PARA_API_KEY: string
  readonly VITE_WALLETCONNECT_PROJECT_ID: string
  readonly VITE_PRIVY_APP_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

