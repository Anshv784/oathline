//! Verification rules for answers produced by NEAR AI Cloud models.
//!
//! Two questions are answered here, without any network access:
//!
//! 1. [`attestation`]: does this TDX evidence prove that a given signing key
//!    lives inside a measured, non-debug NEAR AI model enclave, and that the
//!    evidence was produced for *our* nonce?
//! 2. [`inference`]: was this exact response, to this exact request, signed
//!    by that key, and what answer does it carry?
//!
//! The Intel quote signature itself is checked by the `tee-verifier` contract
//! (dcap-qvl); everything after that, the binding between the quote and the
//! model, lives here so the contract, the registrar and the tests share one
//! implementation.
//!
//! The crate is `no_std` so it compiles unchanged into the NEAR contract.
//! Hashing that the NEAR runtime offers natively (keccak-256, secp256k1
//! recovery) is passed in through [`Crypto`] instead of being linked here.

#![no_std]
#![forbid(unsafe_code)]

extern crate alloc;

pub mod attestation;
pub mod inference;

/// The two host functions the inference check needs. The contract implements
/// them with `near_sdk::env`; tests implement them with `sha3` and `k256`.
pub trait Crypto {
    fn keccak256(&self, data: &[u8]) -> [u8; 32];

    /// Recovers the uncompressed public key (64 bytes, no `0x04` prefix)
    /// from a 32-byte digest and a 64-byte `r || s` signature.
    /// `v` is the recovery id, 0 or 1.
    fn ecrecover(&self, digest: &[u8; 32], signature: &[u8; 64], v: u8) -> Option<[u8; 64]>;
}

/// An Ethereum-style address: the last 20 bytes of keccak-256(public key).
pub type Address = [u8; 20];
