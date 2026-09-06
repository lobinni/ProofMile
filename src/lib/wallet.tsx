"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { CHAIN_ID, EXPLORER_URL, getWriteContract, RPC_URL } from "./contract";

// Minimal EIP-1193 provider shape
interface EthereumProvider {
  isMetaMask?: boolean;
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    handler: (...args: unknown[]) => void
  ) => void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

const DISCONNECT_FLAG = "pm_wallet_disconnected";
const CHAIN_HEX = "0x" + CHAIN_ID.toString(16);

export interface WalletState {
  address: string | null;
  chainId: number | null;
  isConnected: boolean;
  isCorrectNetwork: boolean;
  isMetaMaskInstalled: boolean;
  isBusy: boolean;
  error: string | null;
}

interface WalletContextValue extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToStudionet: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

async function readChainId(provider: EthereumProvider): Promise<number | null> {
  try {
    const hex = (await provider.request({ method: "eth_chainId" })) as string;
    return parseInt(hex, 16);
  } catch {
    return null;
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({
    address: null,
    chainId: null,
    isConnected: false,
    isCorrectNetwork: false,
    isMetaMaskInstalled: false,
    isBusy: false,
    error: null,
  });

  const refresh = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) {
      setState((s) => ({ ...s, isMetaMaskInstalled: false }));
      return;
    }
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_accounts",
      })) as string[];
      const chainId = await readChainId(window.ethereum);
      const intentionallyDisconnected =
        localStorage.getItem(DISCONNECT_FLAG) === "true";
      const address =
        accounts.length > 0 && !intentionallyDisconnected ? accounts[0] : null;
      setState({
        address,
        chainId,
        isConnected: address !== null,
        isCorrectNetwork: chainId === CHAIN_ID,
        isMetaMaskInstalled: true,
        isBusy: false,
        error: null,
      });
    } catch {
      setState((s) => ({ ...s, isMetaMaskInstalled: true, isBusy: false }));
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (typeof window === "undefined" || !window.ethereum?.on) return;

    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      if (!accounts || accounts.length === 0) {
        setState((s) => ({ ...s, address: null, isConnected: false }));
      } else {
        setState((s) => ({
          ...s,
          address: accounts[0],
          isConnected: true,
        }));
      }
      void refresh();
    };
    const onChainChanged = (...args: unknown[]) => {
      const hex = args[0] as string;
      const chainId = parseInt(hex, 16);
      setState((s) => ({ ...s, chainId, isCorrectNetwork: chainId === CHAIN_ID }));
    };

    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged", onChainChanged);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", onAccountsChanged);
      window.ethereum?.removeListener?.("chainChanged", onChainChanged);
    };
  }, [refresh]);

  const switchToStudionet = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) return;
    setState((s) => ({ ...s, isBusy: true, error: null }));
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_HEX }],
      });
    } catch (err) {
      const code = (err as { code?: number })?.code;
      if (code === 4902) {
        // Chain unknown to the wallet — register Studionet.
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: CHAIN_HEX,
                chainName: "GenLayer Studionet",
                rpcUrls: [RPC_URL],
                nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
                blockExplorerUrls: [EXPLORER_URL],
              },
            ],
          });
        } catch (addErr) {
          setState((s) => ({
            ...s,
            isBusy: false,
            error:
              addErr instanceof Error
                ? addErr.message
                : "Could not add Studionet to the wallet",
          }));
          return;
        }
      } else if (code === 4001) {
        setState((s) => ({
          ...s,
          isBusy: false,
          error: "Network switch was cancelled in MetaMask.",
        }));
        return;
      } else {
        setState((s) => ({
          ...s,
          isBusy: false,
          error: err instanceof Error ? err.message : "Network switch failed",
        }));
        return;
      }
    }
    await refresh();
  }, [refresh]);

  const connect = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) {
      setState((s) => ({
        ...s,
        error:
          "MetaMask is not installed. Install MetaMask to use ProofMile Escrow.",
      }));
      return;
    }
    setState((s) => ({ ...s, isBusy: true, error: null }));
    try {
      localStorage.removeItem(DISCONNECT_FLAG);
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      if (accounts.length === 0) throw new Error("No accounts found");
      const chainId = await readChainId(window.ethereum);
      setState({
        address: accounts[0],
        chainId,
        isConnected: true,
        isCorrectNetwork: chainId === CHAIN_ID,
        isMetaMaskInstalled: true,
        isBusy: false,
        error: null,
      });
      // Auto-prompt the Studionet switch when the wallet is elsewhere.
      if (chainId !== CHAIN_ID) {
        void switchToStudionet();
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Wallet connection failed";
      setState((s) => ({ ...s, isBusy: false, error: msg }));
    }
  }, [switchToStudionet]);

  const disconnect = useCallback(() => {
    localStorage.setItem(DISCONNECT_FLAG, "true");
    setState((s) => ({
      address: null,
      chainId: s.chainId,
      isConnected: false,
      isCorrectNetwork: s.chainId === CHAIN_ID,
      isMetaMaskInstalled: s.isMetaMaskInstalled,
      isBusy: false,
      error: null,
    }));
  }, []);

  return (
    <WalletContext.Provider
      value={{ ...state, connect, disconnect, switchToStudionet }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}

/** Contract bound to the connected wallet (null if unavailable). */
export function useWriteContract() {
  const { address, isConnected, isCorrectNetwork } = useWallet();
  if (!address || !isConnected || !isCorrectNetwork) return null;
  try {
    return getWriteContract(address);
  } catch {
    return null;
  }
}
