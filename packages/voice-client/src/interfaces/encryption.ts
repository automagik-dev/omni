export interface EncryptionLayer {
  encrypt(packet: Uint8Array, nonce: Uint8Array): Uint8Array;
  decrypt(packet: Uint8Array, nonce: Uint8Array): Uint8Array;
}
