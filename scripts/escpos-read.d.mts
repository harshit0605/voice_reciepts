export function readEscpos(b: Uint8Array): {
  width: number;
  height: number;
  bits: Buffer;
  cut: boolean;
};
