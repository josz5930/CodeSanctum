use onevps_local_runner_scaffold::ml_dsa;

const TEST_SEED: [u8; 32] = [7u8; 32];

#[test]
fn base64url_round_trips_without_padding() {
    for len in [0usize, 1, 2, 3, 1952, 3309] {
        let bytes = vec![0xA5u8; len];
        let encoded = ml_dsa::base64url_encode(&bytes);
        assert!(
            !encoded.contains('='),
            "base64url must never emit padding (len {len})"
        );
        assert!(
            encoded
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
            "base64url must stay in the url-safe alphabet (len {len})"
        );
        assert_eq!(
            ml_dsa::base64url_decode(&encoded).expect("decodes"),
            bytes,
            "base64url must round trip (len {len})"
        );
    }
    assert_eq!(ml_dsa::base64url_encode(&[]), "");
    assert!(
        ml_dsa::base64url_decode("A+/B").is_none(),
        "standard-base64 characters must be rejected"
    );
    assert!(
        ml_dsa::base64url_decode("AAA=").is_none(),
        "padding must be rejected"
    );
    assert!(
        ml_dsa::base64url_decode("A").is_none(),
        "a lone character cannot encode a whole byte"
    );
}

#[test]
fn base64url_decode_rejects_non_canonical_trailing_slack_bits() {
    // "pQ" is the canonical (and only correctly-round-tripping) base64url
    // encoding of the single byte 0xA5. Its final character 'Q' carries the
    // one meaningful bit plus 4 slack bits, all zero. Swapping just the last
    // character for 'R' (which differs from 'Q' only in its low, supposedly
    // -unused slack bits) still decoded to the identical byte under the old
    // lenient logic, which silently discarded those bits instead of
    // requiring them to be zero — i.e. two different strings decoded to the
    // same bytes, exactly the interop landmine this fix closes.
    assert_eq!(
        ml_dsa::base64url_decode("pQ").as_deref(),
        Some([0xA5u8].as_slice()),
        "the canonical encoding must still decode"
    );
    assert!(
        ml_dsa::base64url_decode("pR").is_none(),
        "a non-canonical final group with non-zero slack bits must be rejected, \
         even though it decoded to the same bytes as \"pQ\" under the old logic"
    );
}

#[test]
fn signature_and_key_sizes_match_fips_204_ml_dsa_65() {
    let public_key = ml_dsa::public_key_from_seed(&TEST_SEED);
    let message = ml_dsa::signed_message("{\"a\":1}");
    let signature = ml_dsa::sign_deterministic_from_seed(&TEST_SEED, &message);
    assert_eq!(public_key.len(), ml_dsa::PUBLIC_KEY_BYTES);
    assert_eq!(signature.len(), ml_dsa::SIGNATURE_BYTES);
    assert_eq!(ml_dsa::base64url_encode(&public_key).len(), 2603);
    assert_eq!(ml_dsa::base64url_encode(&signature).len(), 4412);
}

#[test]
fn signing_from_a_seed_is_deterministic() {
    let message = ml_dsa::signed_message("{\"a\":1}");
    let first = ml_dsa::sign_deterministic_from_seed(&TEST_SEED, &message);
    let second = ml_dsa::sign_deterministic_from_seed(&TEST_SEED, &message);
    assert_eq!(
        first, second,
        "committed fixtures depend on byte-identical regeneration"
    );
}

#[test]
fn verification_accepts_the_signed_message_and_rejects_everything_else() {
    let public_key = ml_dsa::public_key_from_seed(&TEST_SEED);
    let message = ml_dsa::signed_message("{\"a\":1}");
    let signature = ml_dsa::sign_deterministic_from_seed(&TEST_SEED, &message);

    assert!(ml_dsa::verify(&public_key, &message, &signature));
    assert!(
        !ml_dsa::verify(
            &public_key,
            &ml_dsa::signed_message("{\"a\":2}"),
            &signature
        ),
        "a different message must not verify"
    );

    let other_key = ml_dsa::public_key_from_seed(&[9u8; 32]);
    assert!(
        !ml_dsa::verify(&other_key, &message, &signature),
        "a different key must not verify"
    );

    let mut tampered = signature;
    tampered[0] ^= 0x01;
    assert!(
        !ml_dsa::verify(&public_key, &message, &tampered),
        "a flipped signature bit must not verify"
    );

    assert!(
        !ml_dsa::verify(&public_key[..10], &message, &signature),
        "a wrong-length key must be rejected, not panic"
    );
    assert!(
        !ml_dsa::verify(&public_key, &message, &signature[..10]),
        "a wrong-length signature must be rejected, not panic"
    );
}

#[test]
fn signed_message_is_domain_separated() {
    let canonical = "{\"a\":1}";
    let message = ml_dsa::signed_message(canonical);
    assert_eq!(
        message,
        format!("{}\n{}", ml_dsa::SIGNED_MESSAGE_DOMAIN, canonical).into_bytes(),
        "the domain tag must prefix the canonical bytes so signatures cannot be replayed across schemes"
    );
}
