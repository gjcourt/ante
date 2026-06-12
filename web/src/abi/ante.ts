// Re-export the Ante ABI as a const-typed value so viem can infer argument and
// return types. The JSON is hand-written to match contracts/src/Ante.sol's
// signatures in SPEC.md; integration will swap in the compiled artifact.
//
// When the contract agent drops a compiled `web/src/abi/Ante.json` (Foundry
// artifact shaped `{ "abi": [...] }`), this guard unwraps it; the current
// hand-written file is a bare array.
import anteArtifact from "./Ante.json";

const raw: unknown = anteArtifact;
const abiArray =
  Array.isArray(raw) ? raw : (raw as { abi: unknown[] }).abi;

// Cast to the viem-friendly `Abi`-compatible shape. We keep it loose here
// (the JSON import is not `as const`), which is fine for runtime use; the
// hooks supply explicit generic types where stronger inference is needed.
export const anteAbi = abiArray as readonly {
  type: string;
  name?: string;
  stateMutability?: string;
  inputs?: readonly { name: string; type: string; indexed?: boolean }[];
  outputs?: readonly { name: string; type: string }[];
  anonymous?: boolean;
}[];
