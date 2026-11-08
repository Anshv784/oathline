use near_sdk::env;
use oathline_core::Crypto;

/// keccak-256 and secp256k1 recovery from the NEAR runtime's host functions.
pub struct NearCrypto;

impl Crypto for NearCrypto {
    fn keccak256(&self, data: &[u8]) -> [u8; 32] {
        env::keccak256_array(data)
    }

    fn ecrecover(&self, digest: &[u8; 32], signature: &[u8; 64], v: u8) -> Option<[u8; 64]> {
        // `true` rejects high-s signatures, which a correct signer never makes.
        env::ecrecover(digest, signature, v, true)
    }
}
