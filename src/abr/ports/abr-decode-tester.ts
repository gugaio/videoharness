import type { DecodeTestResult } from "../domain/evidence.js";

export type AbrDecodeTestInput = {
  switchId: string;
  sourceInit: Uint8Array;
  sourceFragments: Uint8Array[];
  targetInit: Uint8Array;
  targetFragments: Uint8Array[];
  bitstreamSwitchingAllowed: boolean;
};

export interface AbrDecodeTester {
  run(input: AbrDecodeTestInput): Promise<DecodeTestResult[]>;
}
