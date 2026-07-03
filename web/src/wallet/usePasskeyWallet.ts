import { useCallback } from "react";
import {
  useAccount,
  useConnect,
  useConnectors,
  useDisconnect,
  useSendTransactionSync,
} from "wagmi";

// ---------------------------------------------------------------------------
// usePasskeyWallet — thin adapter over the standard wagmi hooks that localizes
// the wagmi / wagmi-tempo surface and hands `useAnte` ONE small object.
//
// This is NOT the retired OO `WalletProvider` seam, and it is NOT `Actions.*`
// (the Tempo protocol helpers). It is a plain hook returning connection state +
// a `connect`/`disconnect`/`sendTx` trio.
//
// ACTIVATION INVARIANT: `connect()` and `sendTx()` trigger the native WebAuthn
// OS dialog, which requires transient user activation. They MUST be reached
// only from a real user click, and there must be NO `await` between the click
// and the connector's sign call (otherwise the browser drops the activation and
// the OS dialog silently fails). Do not call these from effects or timers.
//
// SEND PATH. The passkey `sendTx` is backed by wagmi's `useSendTransactionSync`
// (the Tempo send primitive), which takes a flat viem transaction request
// (`{ to, data, value? }`) and resolves to the transaction RECEIPT once included.
// This localizes the wagmi/wagmi-tempo send surface here; `useAnte` only ever
// sees the frozen `sendTx({to,data,value?}) => Promise<hash>` signature, so if
// the send primitive changes only this body moves.
// NOTE: the passkey round-trip (register/login + a real staked write) can only
// be confirmed in a browser with a platform authenticator over HTTPS — the type
// surface below is validated by the build, the ceremony is a manual e2e.
// ---------------------------------------------------------------------------

export interface PasskeyWallet {
  /** The active address, or undefined if not connected. Plain value — reading
      it never connects as a side effect (connect() is explicit). */
  address: `0x${string}` | undefined;
  isConnected: boolean;
  /** Trigger the WebAuthn login ceremony. Login-only this round (no register).
      MUST be called synchronously from a user click. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Send raw calldata; resolves to the tx hash. Throws a clean
      "reconnect passkey" error if there is no active connection. MUST be
      reached from a user click (transient activation). */
  sendTx(tx: {
    to: `0x${string}`;
    data: `0x${string}`;
    value?: bigint;
  }): Promise<`0x${string}`>;
}

export function usePasskeyWallet(): PasskeyWallet {
  const { address, isConnected } = useAccount();
  const { connectAsync } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const connectors = useConnectors();
  const { mutateAsync: sendTransactionSyncAsync } = useSendTransactionSync();

  // There is exactly one connector in the AnteWeb3Provider config: webAuthn().
  const connector = connectors[0];

  const connect = useCallback(async (): Promise<void> => {
    if (!connector) {
      throw new Error(
        "Passkey connector unavailable — is <AnteWeb3Provider> mounted?"
      );
    }
    // "Sign in or sign up" in one step. The `register` capability makes the
    // Provider CREATE a passkey on first use (the Touch ID *create* ceremony)
    // and REUSE the existing one on return (it matches a stored account by
    // label). Without it, connect does a bare login/get, which on a first visit
    // finds no credential and drops to the browser's phone/security-key
    // fallback. wagmi forwards unknown connect params straight to the
    // connector, so `capabilities` threads through to `wallet_connect`.
    // wagmi's typed connect variables omit `capabilities`, but the Tempo
    // connector reads it and wagmi forwards unknown params to `connect` at
    // runtime (`const { connector: _, ...rest } = parameters`). Cast to pass it
    // without widening the public surface. Confirmed on-chain: this registers /
    // reuses the passkey and the staked write goes through.
    await connectAsync({
      connector,
      capabilities: { method: "register", name: "Ante" },
    } as Parameters<typeof connectAsync>[0]);
  }, [connectAsync, connector]);

  const disconnect = useCallback(async (): Promise<void> => {
    await disconnectAsync();
  }, [disconnectAsync]);

  const sendTx = useCallback(
    async (tx: {
      to: `0x${string}`;
      data: `0x${string}`;
      value?: bigint;
    }): Promise<`0x${string}`> => {
      if (!isConnected) {
        throw new Error("Passkey session lost — reconnect your passkey.");
      }
      // The installed `useSendTransactionSync` takes viem's flat transaction
      // request (`to` / `data` / `value`) — there is no `calls` array in this
      // SDK version (§9 item 1: the connector carries a raw `{to,data}` write).
      // `value` is threaded through only when present (Tempo uses stablecoin
      // gas; nearly all Ante calls are value-0).
      const receipt = await sendTransactionSyncAsync(
        tx.value !== undefined
          ? { to: tx.to, data: tx.data, value: tx.value }
          : { to: tx.to, data: tx.data }
      );
      // `sendTransactionSync` resolves to the transaction RECEIPT; the hash is
      // `transactionHash`.
      return receipt.transactionHash;
    },
    [isConnected, sendTransactionSyncAsync]
  );

  return {
    address,
    isConnected,
    connect,
    disconnect,
    sendTx,
  };
}
