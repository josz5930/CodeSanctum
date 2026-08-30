use onevps_local_runner_scaffold::{canonicalize_protocol_json_value, sha256_id};
use serde_json::json;

#[test]
fn rust_jcs_preserves_unicode_and_sorts_keys_by_utf16_code_units() {
    let decomposed = "e\u{0301}";
    let composed = "é";
    assert_ne!(
        decomposed, composed,
        "test setup requires distinct Unicode spellings"
    );
    assert_eq!(
        canonicalize_protocol_json_value(&json!(decomposed)),
        serde_json::to_string(decomposed).expect("string serializes")
    );
    assert_ne!(
        canonicalize_protocol_json_value(&json!(decomposed)),
        canonicalize_protocol_json_value(&json!(composed)),
        "JCS must not normalize Unicode strings"
    );

    let input = json!({
        "\u{E000}": 1,
        "😀": 2,
        "a": 3
    });
    assert_eq!(
        canonicalize_protocol_json_value(&input),
        "{\"a\":3,\"😀\":2,\"\":1}",
        "JCS object keys must sort by UTF-16 code units"
    );
}

#[test]
fn rust_jcs_sorts_nested_objects_inside_arrays() {
    let nested = json!([{ "z": 1, "a": { "y": 2, "x": [3, { "b": true, "a": false }] } }]);
    assert_eq!(
        canonicalize_protocol_json_value(&nested),
        "[{\"a\":{\"x\":[3,{\"a\":false,\"b\":true}],\"y\":2},\"z\":1}]"
    );
}

#[test]
#[ignore]
fn emit_canonical_identity_for_env_fixture() {
    let fixture_path = std::env::var("ONEVPS_JCS_FIXTURE_PATH")
        .expect("ONEVPS_JCS_FIXTURE_PATH must point at a JSON fixture");
    let fixture = std::fs::read_to_string(fixture_path).expect("fixture should be readable");
    let value: serde_json::Value = serde_json::from_str(&fixture).expect("fixture should parse");
    let canonical = canonicalize_protocol_json_value(&value);
    let payload = json!({
        "canonical": canonical,
        "sha256_id": sha256_id(canonical.as_bytes())
    });
    println!("ONEVPS_JCS_PARITY {}", payload);
}
