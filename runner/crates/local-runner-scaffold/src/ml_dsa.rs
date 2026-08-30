//! FIPS-204 ML-DSA-65 signing and verification for the Local Runner.
//!
//! Pure ML-DSA with an empty context string over domain-separated RFC 8785
//! canonical bytes. That pairing is what makes these signatures verifiable by
//! the TypeScript side, which uses OpenSSL through `node:crypto`.
//!
//! Signing is deterministic by seed. Every committed signature fixture in
//! `protocol/fixtures/` is produced here, because the TypeScript
//! implementation's signing is randomized and cannot regenerate fixed bytes.

use ml_dsa::common::array::Array;
use ml_dsa::{
    EncodedSignature, EncodedVerifyingKey, Keypair, MlDsa65, Signature, SigningKey, VerifyingKey,
};

/// FIPS-204 ML-DSA-65 signature length.
pub const SIGNATURE_BYTES: usize = 3309;
/// FIPS-204 ML-DSA-65 raw verifying-key length.
pub const PUBLIC_KEY_BYTES: usize = 1952;
/// ML-DSA key-generation seed length.
pub const SEED_BYTES: usize = 32;
/// Domain tag prefixed to canonical bytes before signing.
pub const SIGNED_MESSAGE_DOMAIN: &str = "codeattest-ml-dsa-65-v1";

const BASE64URL_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Encode bytes as unpadded base64url. Hand-rolled to keep this crate's
/// dependency additions at exactly one.
pub fn base64url_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        let indices = [
            (triple >> 18) & 0x3F,
            (triple >> 12) & 0x3F,
            (triple >> 6) & 0x3F,
            triple & 0x3F,
        ];
        for index in indices.iter().take(chunk.len() + 1) {
            out.push(BASE64URL_ALPHABET[*index as usize] as char);
        }
    }
    out
}

/// Decode unpadded base64url. Returns `None` for padding, the standard-base64
/// alphabet, a length that cannot encode a whole number of bytes, or a
/// non-canonical final group (trailing slack bits that aren't zero — those
/// bits carry no byte, so a canonical encoder always emits zero there, and a
/// non-zero value means a different string would decode to the same bytes).
pub fn base64url_decode(text: &str) -> Option<Vec<u8>> {
    if text.len() % 4 == 1 {
        return None;
    }
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    for chunk in text.as_bytes().chunks(4) {
        let mut accumulator = 0u32;
        for byte in chunk {
            let value = decode_char(*byte)?;
            accumulator = (accumulator << 6) | u32::from(value);
        }
        // Slack bits: 6 bits per char minus 8 bits per output byte. Zero for
        // a full 4-char group (24 bits -> 3 bytes exactly, no leftover).
        let slack_bits = 8 - 2 * chunk.len() as u32;
        if accumulator & ((1u32 << slack_bits) - 1) != 0 {
            return None;
        }
        let shift = (4 - chunk.len()) * 6;
        accumulator <<= shift;
        let decoded = [
            ((accumulator >> 16) & 0xFF) as u8,
            ((accumulator >> 8) & 0xFF) as u8,
            (accumulator & 0xFF) as u8,
        ];
        out.extend_from_slice(&decoded[..chunk.len() - 1]);
    }
    Some(out)
}

fn decode_char(byte: u8) -> Option<u8> {
    BASE64URL_ALPHABET
        .iter()
        .position(|candidate| *candidate == byte)
        .map(|index| index as u8)
}

/// Prefix canonical JSON with the domain tag so a signature over one scheme's
/// bytes can never be replayed as a signature over another's.
pub fn signed_message(canonical_identity_signing_input: &str) -> Vec<u8> {
    format!("{SIGNED_MESSAGE_DOMAIN}\n{canonical_identity_signing_input}").into_bytes()
}

fn signing_key(seed: &[u8; SEED_BYTES]) -> SigningKey<MlDsa65> {
    SigningKey::<MlDsa65>::from_seed(&Array(*seed))
}

/// Derive the raw verifying key for a seed.
pub fn public_key_from_seed(seed: &[u8; SEED_BYTES]) -> [u8; PUBLIC_KEY_BYTES] {
    let encoded = signing_key(seed).verifying_key().encode();
    let mut out = [0u8; PUBLIC_KEY_BYTES];
    out.copy_from_slice(&encoded);
    out
}

/// Sign deterministically. The same seed and message always produce the same
/// bytes, which is what makes committed signature fixtures reviewable.
pub fn sign_deterministic_from_seed(
    seed: &[u8; SEED_BYTES],
    message: &[u8],
) -> [u8; SIGNATURE_BYTES] {
    let key = signing_key(seed);
    let signature = key
        .expanded_key()
        .sign_deterministic(message, &[])
        .expect("an empty context string is always within the 255-byte limit");
    let mut out = [0u8; SIGNATURE_BYTES];
    out.copy_from_slice(&signature.encode());
    out
}

/// Verify a raw signature against a raw verifying key. Wrong-length inputs
/// return `false` rather than panicking, because these come off the wire.
pub fn verify(public_key: &[u8], message: &[u8], signature: &[u8]) -> bool {
    let Ok(encoded_key) = <EncodedVerifyingKey<MlDsa65>>::try_from(public_key) else {
        return false;
    };
    let Ok(encoded_signature) = <EncodedSignature<MlDsa65>>::try_from(signature) else {
        return false;
    };
    let Some(parsed) = Signature::<MlDsa65>::decode(&encoded_signature) else {
        return false;
    };
    VerifyingKey::<MlDsa65>::decode(&encoded_key).verify_with_context(message, &[], &parsed)
}
