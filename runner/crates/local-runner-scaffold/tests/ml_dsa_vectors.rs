use onevps_local_runner_scaffold::ml_dsa;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn vectors_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../protocol/fixtures/v0/support/ml-dsa-65-test-vectors.json")
}

fn seed(vectors: &Value) -> [u8; 32] {
    let encoded = vectors["test_seed_base64url"]
        .as_str()
        .expect("seed present");
    let decoded = ml_dsa::base64url_decode(encoded).expect("seed decodes");
    let mut out = [0u8; 32];
    out.copy_from_slice(&decoded);
    out
}

#[test]
fn committed_vectors_regenerate_byte_for_byte_from_the_committed_seed() {
    let vectors: Value =
        serde_json::from_str(&fs::read_to_string(vectors_path()).expect("vectors readable"))
            .expect("vectors parse");
    let seed = seed(&vectors);

    assert_eq!(
        ml_dsa::base64url_encode(&ml_dsa::public_key_from_seed(&seed)),
        vectors["test_public_key_base64url"]
            .as_str()
            .expect("public key present"),
        "the committed public key must derive from the committed seed"
    );

    let cases = vectors["rust_deterministic_vectors"]
        .as_array()
        .expect("vectors are an array");
    assert!(
        !cases.is_empty(),
        "at least one deterministic vector is required"
    );

    for case in cases {
        let canonical = case["canonical_input"]
            .as_str()
            .expect("canonical input present");
        let expected = case["signature_base64url"]
            .as_str()
            .expect("signature present");
        let message = ml_dsa::signed_message(canonical);
        let regenerated =
            ml_dsa::base64url_encode(&ml_dsa::sign_deterministic_from_seed(&seed, &message));
        assert_eq!(
            regenerated, expected,
            "committed signature for {canonical} must regenerate byte-for-byte"
        );
    }
}

#[test]
fn committed_vectors_verify() {
    let vectors: Value =
        serde_json::from_str(&fs::read_to_string(vectors_path()).expect("vectors readable"))
            .expect("vectors parse");
    let public_key = ml_dsa::base64url_decode(
        vectors["test_public_key_base64url"]
            .as_str()
            .expect("public key present"),
    )
    .expect("public key decodes");

    for case in vectors["rust_deterministic_vectors"]
        .as_array()
        .expect("array")
    {
        let message = ml_dsa::signed_message(case["canonical_input"].as_str().expect("input"));
        let signature =
            ml_dsa::base64url_decode(case["signature_base64url"].as_str().expect("signature"))
                .expect("signature decodes");
        assert!(
            ml_dsa::verify(&public_key, &message, &signature),
            "every committed vector must verify"
        );
    }
}

#[test]
fn rust_verifies_the_committed_node_produced_signature() {
    let vectors: Value =
        serde_json::from_str(&fs::read_to_string(vectors_path()).expect("vectors readable"))
            .expect("vectors parse");
    let node = &vectors["node_randomized_vector"];
    assert!(
        !node.is_null(),
        "the Node-produced vector must be committed; run scripts/generate-ml-dsa-test-vectors.mjs"
    );

    let public_key = ml_dsa::base64url_decode(
        node["public_key_base64url"]
            .as_str()
            .expect("public key present"),
    )
    .expect("public key decodes");
    let signature = ml_dsa::base64url_decode(
        node["signature_base64url"]
            .as_str()
            .expect("signature present"),
    )
    .expect("signature decodes");
    let message = ml_dsa::signed_message(node["canonical_input"].as_str().expect("input present"));

    assert!(
        ml_dsa::verify(&public_key, &message, &signature),
        "Rust must verify the TypeScript-produced signature"
    );

    let mut tampered = signature.clone();
    tampered[0] ^= 0x01;
    assert!(
        !ml_dsa::verify(&public_key, &message, &tampered),
        "a flipped bit in the Node signature must not verify"
    );
}
