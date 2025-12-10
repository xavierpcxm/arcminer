import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import App from "./App";
import { WagmiProvider, createConfig, http } from "wagmi";
import { defineChain } from "viem";
import { mainnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";

// Arc Testnet Configuration
const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "USDC",
    symbol: "USDC",
  },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

const config = createConfig({
  chains: [arcTestnet, mainnet],
  connectors: [
    injected({ shimDisconnect: true }),
  ],
  transports: {
    [arcTestnet.id]: http("https://rpc.testnet.arc.network"),
    [mainnet.id]: http(),
  },
});

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
