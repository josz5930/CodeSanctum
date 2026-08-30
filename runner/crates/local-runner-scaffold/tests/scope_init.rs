use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use onevps_local_runner_scaffold::{
    RUNNER_NAME, ScopeInitInput, format_scope_summary, initialize_review_scope, runner_version,
    sha256_id, validate_application_path, validate_commit_sha, validate_review_id,
    write_review_scope_metadata,
};

const VALID_COMMIT: &str = "0123456789abcdef0123456789abcdef01234567";
const OTHER_VALID_COMMIT: &str = "89abcdef012345670123456789abcdef01234567";

#[test]
fn validates_lowercase_git_commit_sha() {
    assert!(validate_commit_sha(VALID_COMMIT).is_ok());

    assert!(validate_commit_sha("0123456789abcdef0123456789abcdef0123456").is_err());
    assert!(validate_commit_sha("0123456789abcdef0123456789abcdef0123456Z").is_err());
    assert!(validate_commit_sha("0123456789ABCDEF0123456789abcdef01234567").is_err());
}

#[test]
fn validates_review_id_and_binds_it_into_scope_identity() {
    for valid in ["review:abc", "review:synthetic-demo-001", "review:a_b-c"] {
        assert!(validate_review_id(valid).is_ok(), "{valid} should be valid");
    }
    for invalid in [
        "review:ab",
        "review:Uppercase",
        "review:-leading",
        "review:contains.dot",
        "synthetic-demo-001",
    ] {
        assert!(
            validate_review_id(invalid).is_err(),
            "{invalid} should fail"
        );
    }

    let fixture = temp_fixture("review_id_scope_identity_binding");
    fs::create_dir_all(&fixture).expect("fixture directory should be created");
    let first = initialize_review_scope(ScopeInitInput {
        review_id: "review:first-authority".to_string(),
        application_path: fixture.clone(),
        selected_commit: VALID_COMMIT.to_string(),
        output_path: fixture.join("first.json"),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
    })
    .expect("first review scope should initialize");
    let second = initialize_review_scope(ScopeInitInput {
        review_id: "review:second-authority".to_string(),
        application_path: fixture,
        selected_commit: VALID_COMMIT.to_string(),
        output_path: PathBuf::from("second.json"),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
    })
    .expect("second review scope should initialize");

    assert_eq!(first.repository_identity, second.repository_identity);
    assert_ne!(first.review_scope_id, second.review_scope_id);
}

#[test]
fn validates_existing_application_path() {
    let fixture = temp_fixture("validates_existing_application_path");
    fs::create_dir_all(&fixture).expect("fixture directory should be created");

    assert!(validate_application_path(&fixture).is_ok());
    assert!(validate_application_path(&fixture.join("missing-app")).is_err());
}

#[test]
fn scope_initialization_records_one_application_and_commit() {
    let fixture = temp_fixture("scope_initialization_records_one_application_and_commit");
    fs::create_dir_all(&fixture).expect("fixture directory should be created");

    let output = fixture.join("review-scope.json");
    let scope = initialize_review_scope(ScopeInitInput {
        review_id: "review:synthetic-demo-001".to_string(),
        application_path: fixture.clone(),
        selected_commit: VALID_COMMIT.to_string(),
        output_path: output,
        generated_at: "2026-07-08T00:00:00Z".to_string(),
    })
    .expect("scope should initialize for valid inputs");

    assert_eq!(scope.protocol_version, "codeattest.v0");
    assert_eq!(
        scope.selected_application.display_name,
        fixture_name(&fixture)
    );
    assert_eq!(scope.selected_commit.commit_sha, VALID_COMMIT);
    assert_eq!(scope.selected_commit.source_control_system, "git");
    assert_eq!(scope.runner.name, RUNNER_NAME);
    assert_eq!(scope.runner.version, runner_version());
}

#[test]
fn repository_identity_is_scope_based_and_deterministic() {
    let fixture = temp_fixture("repository_identity_is_scope_based_and_deterministic");
    fs::create_dir_all(&fixture).expect("fixture directory should be created");
    fs::write(fixture.join("source.ts"), "first synthetic content")
        .expect("synthetic fixture source should be written");

    let first = initialize_review_scope(ScopeInitInput {
        review_id: "review:synthetic-demo-001".to_string(),
        application_path: fixture.clone(),
        selected_commit: VALID_COMMIT.to_string(),
        output_path: fixture.join("first.json"),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
    })
    .expect("first scope should initialize");

    fs::write(fixture.join("source.ts"), "changed synthetic content")
        .expect("synthetic fixture source should be changed");

    let second = initialize_review_scope(ScopeInitInput {
        review_id: "review:synthetic-demo-001".to_string(),
        application_path: fixture.clone(),
        selected_commit: VALID_COMMIT.to_string(),
        output_path: fixture.join("second.json"),
        generated_at: "2026-07-08T00:00:01Z".to_string(),
    })
    .expect("second scope should initialize");

    let different_commit = initialize_review_scope(ScopeInitInput {
        review_id: "review:synthetic-demo-001".to_string(),
        application_path: fixture,
        selected_commit: OTHER_VALID_COMMIT.to_string(),
        output_path: PathBuf::from("third.json"),
        generated_at: "2026-07-08T00:00:02Z".to_string(),
    })
    .expect("third scope should initialize");

    assert_sha256_id(&first.repository_identity);
    assert_eq!(first.repository_identity, second.repository_identity);
    assert_ne!(
        first.repository_identity,
        different_commit.repository_identity
    );
}

#[test]
fn detects_languages_frameworks_and_not_detected_context() {
    let fixture = temp_fixture("detects_languages_frameworks_and_not_detected_context");
    fs::create_dir_all(fixture.join("src")).expect("fixture source directory should be created");
    fs::write(
        fixture.join("package.json"),
        r#"{
          "_synthetic_marker": "SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE",
          "dependencies": {
            "next": "16.2.10",
            "react": "19.2.7"
          },
          "devDependencies": {
            "typescript": "6.0.3"
          }
        }"#,
    )
    .expect("synthetic package manifest should be written");
    fs::write(
        fixture.join("tsconfig.json"),
        "{\"_note\": \"SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\"}",
    )
    .expect("tsconfig should be written");
    fs::write(
        fixture.join("src/app.ts"),
        "// SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE",
    )
    .expect("synthetic TypeScript file should be written");
    fs::write(
        fixture.join("requirements.txt"),
        "# SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\nfastapi==0.1.0\n",
    )
    .expect("synthetic requirements should be written");
    fs::write(
        fixture.join("src/app.py"),
        "# SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE",
    )
    .expect("synthetic Python file should be written");

    let scope = initialize_review_scope(ScopeInitInput {
        review_id: "review:synthetic-demo-001".to_string(),
        application_path: fixture.clone(),
        selected_commit: VALID_COMMIT.to_string(),
        output_path: fixture.join("review-scope.json"),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
    })
    .expect("scope should initialize");

    assert!(has_context(&scope, "language", "detected", "typescript"));
    assert!(has_context(&scope, "language", "detected", "python"));
    assert!(has_context(&scope, "framework", "detected", "next"));
    assert!(has_context(&scope, "framework", "detected", "react"));
    assert!(has_context(&scope, "framework", "detected", "fastapi"));
    assert!(has_context(&scope, "framework", "not_detected", "django"));
    assert!(has_context(
        &scope,
        "scanner",
        "unsupported",
        "scanner behavior begins in Story 1.5"
    ));
}

#[test]
fn checked_in_synthetic_fixture_covers_typescript_and_python_scope() {
    let fixture = checked_in_synthetic_fixture_app();
    let output = temp_fixture("checked_in_synthetic_fixture_output").join("review-scope.json");

    let scope = initialize_review_scope(ScopeInitInput {
        review_id: "review:synthetic-demo-001".to_string(),
        application_path: fixture.clone(),
        selected_commit: VALID_COMMIT.to_string(),
        output_path: output,
        generated_at: "2026-07-08T00:00:00Z".to_string(),
    })
    .expect("checked-in synthetic fixture should initialize");

    assert!(has_context(&scope, "language", "detected", "typescript"));
    assert!(has_context(&scope, "language", "detected", "python"));
    assert!(has_context(&scope, "framework", "detected", "next"));
    assert!(has_context(&scope, "framework", "detected", "react"));
    assert!(has_context(&scope, "framework", "detected", "fastapi"));

    let package_json = manifest(&scope, "package_json");
    assert_eq!(package_json.status, "detected");
    assert_eq!(
        package_json.dependencies,
        vec!["next", "react", "typescript"]
    );

    let requirements = manifest(&scope, "requirements_txt");
    assert_eq!(requirements.status, "detected");
    assert_eq!(requirements.dependencies, vec!["fastapi"]);

    let source_marker = fs::read_to_string(fixture.join("src/app.ts"))
        .expect("synthetic TypeScript marker should be readable");
    assert!(source_marker.contains("SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE"));
}

#[test]
fn captures_dependency_manifest_statuses_and_dependency_names() {
    let fixture = temp_fixture("captures_dependency_manifest_statuses_and_dependency_names");
    fs::create_dir_all(&fixture).expect("fixture directory should be created");
    fs::write(
        fixture.join("package.json"),
        r#"{
          "_synthetic_marker": "SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE",
          "dependencies": {
            "react": "19.2.7",
            "next": "16.2.10"
          },
          "devDependencies": {
            "typescript": "6.0.3"
          }
        }"#,
    )
    .expect("synthetic package manifest should be written");
    fs::write(
        fixture.join("requirements.txt"),
        "# SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\nfastapi==0.1.0\n# comment\n",
    )
    .expect("synthetic requirements should be written");
    fs::write(
        fixture.join("pyproject.toml"),
        "# SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\n[project]\ndependencies = ['django==5.0']\n",
    )
    .expect("synthetic pyproject should be written");
    fs::write(
        fixture.join("package-lock.json"),
        "{\"_note\": \"SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\"}\n",
    )
    .expect("synthetic npm lockfile should be written");
    fs::write(
        fixture.join("pnpm-lock.yaml"),
        "# SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\nlockfileVersion: '9.0'\n",
    )
    .expect("synthetic pnpm lockfile should be written");
    fs::write(
        fixture.join("yarn.lock"),
        "# SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\n# yarn lockfile\n",
    )
    .expect("synthetic yarn lockfile should be written");
    fs::write(
        fixture.join("Pipfile.lock"),
        "{\"_note\": \"SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\"}\n",
    )
    .expect("synthetic Pipfile.lock should be written");

    let scope = initialize_review_scope(ScopeInitInput {
        review_id: "review:synthetic-demo-001".to_string(),
        application_path: fixture.clone(),
        selected_commit: VALID_COMMIT.to_string(),
        output_path: fixture.join("review-scope.json"),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
    })
    .expect("scope should initialize");

    let package_json = manifest(&scope, "package_json");
    assert_eq!(package_json.status, "detected");
    assert_eq!(package_json.path.as_deref(), Some("package.json"));
    assert_eq!(package_json.package_manager, "npm");
    assert_eq!(
        package_json.dependencies,
        vec!["next", "react", "typescript"]
    );
    assert_eq!(package_json.dependency_count, 3);

    let requirements = manifest(&scope, "requirements_txt");
    assert_eq!(requirements.status, "detected");
    assert_eq!(requirements.path.as_deref(), Some("requirements.txt"));
    assert_eq!(requirements.package_manager, "pip");
    assert_eq!(requirements.dependencies, vec!["fastapi"]);

    let pyproject = manifest(&scope, "pyproject_toml");
    assert_eq!(pyproject.status, "unsupported");
    assert_eq!(pyproject.path.as_deref(), Some("pyproject.toml"));
    // Parser is deferred; package_manager must be "unknown" (claim-safe), not "poetry".
    assert_eq!(pyproject.package_manager, "unknown");
    assert!(
        pyproject
            .limitation
            .as_deref()
            .unwrap_or_default()
            .contains("deferred")
    );

    let pipfile = manifest(&scope, "pipfile");
    assert_eq!(pipfile.status, "not_found");
    assert_eq!(pipfile.path, None);

    for (manifest_type, expected_path) in [
        ("package_lock", "package-lock.json"),
        ("pnpm_lock", "pnpm-lock.yaml"),
        ("yarn_lock", "yarn.lock"),
        ("pipfile_lock", "Pipfile.lock"),
    ] {
        let lockfile = manifest(&scope, manifest_type);
        assert_eq!(lockfile.status, "unsupported");
        assert_eq!(lockfile.path.as_deref(), Some(expected_path));
        assert_eq!(lockfile.dependency_count, 0);
        assert!(
            lockfile
                .limitation
                .as_deref()
                .unwrap_or_default()
                .contains("deferred")
        );
    }
}

#[test]
fn malformed_package_json_is_reported_without_claiming_dependencies() {
    let fixture = temp_fixture("malformed_package_json_is_reported_without_claiming_dependencies");
    fs::create_dir_all(&fixture).expect("fixture directory should be created");
    fs::write(
        fixture.join("package.json"),
        r#"{ "_synthetic_marker": "SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE", "dependencies": { "react": "#,
    )
    .expect("malformed package manifest should be written");

    let scope = initialize_review_scope(ScopeInitInput {
        review_id: "review:synthetic-demo-001".to_string(),
        application_path: fixture.clone(),
        selected_commit: VALID_COMMIT.to_string(),
        output_path: fixture.join("review-scope.json"),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
    })
    .expect("scope should initialize with malformed manifest limitation");

    let package_json = manifest(&scope, "package_json");
    assert_eq!(package_json.status, "malformed");
    assert_eq!(package_json.dependency_count, 0);
    assert!(package_json.dependencies.is_empty());
    assert!(
        package_json
            .limitation
            .as_deref()
            .unwrap_or_default()
            .contains("malformed package.json manifests skipped")
            || package_json
                .limitation
                .as_deref()
                .unwrap_or_default()
                .contains("Could not parse")
    );
}

#[test]
fn writes_review_scope_metadata_json_with_snake_case_fields() {
    let fixture = temp_fixture("writes_review_scope_metadata_json_with_snake_case_fields");
    fs::create_dir_all(&fixture).expect("fixture directory should be created");
    fs::write(
        fixture.join("package.json"),
        r#"{ "_synthetic_marker": "SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE", "dependencies": { "react": "19.2.7" } }"#,
    )
    .expect("synthetic package manifest should be written");

    let output = fixture.join(".codeattest/review-scope.json");
    let scope = initialize_review_scope(ScopeInitInput {
        review_id: "review:synthetic-demo-001".to_string(),
        application_path: fixture.clone(),
        selected_commit: VALID_COMMIT.to_string(),
        output_path: output.clone(),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
    })
    .expect("scope should initialize");

    write_review_scope_metadata(&scope, &output).expect("review-scope metadata should be written");
    let json = fs::read_to_string(&output).expect("metadata should be readable");

    assert!(json.contains(r#""protocol_version": "codeattest.v0""#));
    assert!(json.contains(r#""review_scope_id": "sha256:"#));
    assert!(json.contains(r#""selected_application""#));
    assert!(json.contains(r#""selected_commit""#));
    assert!(json.contains(r#""repository_identity": "sha256:"#));
    assert!(json.contains(r#""technical_context""#));
    assert!(json.contains(r#""dependency_manifests""#));
    assert!(json.contains(r#""manifest_type": "package_json""#));
    assert!(json.contains(r#""dependencies": ["react"]"#));
    assert!(!json.contains("selectedApplication"));
    assert!(!json.contains("selectedCommit"));
}

#[test]
fn scope_summary_is_monochrome_stable_and_claim_safe() {
    let fixture = temp_fixture("scope_summary_is_monochrome_stable_and_claim_safe");
    fs::create_dir_all(&fixture).expect("fixture directory should be created");
    // Use package.json with `typescript` in devDeps: validates the tighter
    // TypeScript detection rule (typescript dep / tsconfig / .ts files only).
    fs::write(
        fixture.join("package.json"),
        r#"{ "_synthetic_marker": "SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE", "dependencies": { "react": "19.2.7" }, "devDependencies": { "typescript": "6.0.3" } }"#,
    )
    .expect("synthetic package manifest should be written");
    fs::write(
        fixture.join("pyproject.toml"),
        "# SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\n[project]\n",
    )
    .expect("synthetic pyproject should be written");

    let output = fixture.join("review-scope.json");
    let scope = initialize_review_scope(ScopeInitInput {
        review_id: "review:synthetic-demo-001".to_string(),
        application_path: fixture.clone(),
        selected_commit: VALID_COMMIT.to_string(),
        output_path: output.clone(),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
    })
    .expect("scope should initialize");

    let summary = format_scope_summary(&scope, &output);

    assert!(summary.contains("Selected application:"));
    assert!(summary.contains("Selected commit: 0123456789abcdef0123456789abcdef01234567"));
    assert!(summary.contains("Repository identity hash: sha256:"));
    assert!(summary.contains("Runner version: 0.0.0"));
    assert!(summary.contains("language typescript: detected"));
    assert!(summary.contains("framework django: not_detected"));
    assert!(summary.contains("package_json: detected path=package.json dependencies=2"));
    assert!(summary.contains("pyproject_toml: unsupported path=pyproject.toml dependencies=0"));
    assert!(summary.contains("Limitations:"));
    assert!(summary.contains("Output path:"));
    assert!(summary.contains("Local-only boundary:"));
    assert!(!summary.contains("\u{1b}["));

    let lower = summary.to_ascii_lowercase();
    for forbidden_claim in [
        "scan complete",
        "disclosure policy",
        "approval",
        "signing",
        "submission",
        "receipt",
        "expert review",
    ] {
        assert!(
            !lower.contains(forbidden_claim),
            "summary should not imply future-step claim: {forbidden_claim}"
        );
    }
}

// ---------------------------------------------------------------------------
// Tests added by Story 1.4 code review (2026-07-08).
// ---------------------------------------------------------------------------

#[test]
fn sha256_matches_additional_fips_180_4_vectors() {
    // FIPS 180-4 §B.1: empty string.
    assert_sha256_vec(
        b"",
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    // FIPS 180-4 §B.2: 448-bit message (abc...nopq) — two compressed blocks.
    let msg = b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
    assert_sha256_vec(
        msg,
        "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    // "abc" already covered by the library-internal test; duplicate here to
    // keep the Rust-side test battery self-contained.
    assert_sha256_vec(
        b"abc",
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    for (length, expected_hex) in [
        (
            55,
            "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318",
        ),
        (
            56,
            "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a",
        ),
        (
            63,
            "7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34",
        ),
        (
            64,
            "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb",
        ),
    ] {
        assert_sha256_vec(&vec![b'a'; length], expected_hex);
    }
}

fn assert_sha256_vec(input: &[u8], expected_hex: &str) {
    assert_eq!(sha256_id(input), format!("sha256:{expected_hex}"));
}

#[test]
fn sorted_filesystem_traversal_produces_byte_identical_output() {
    // Create files in deliberately scrambled create-order. Then run the scope
    // initialiser three times and require the resulting JSON byte-for-byte
    // identical (modulo timestamps). Because identity hashes are independent
    // of file content, we exercise the sort indirectly by verifying that
    // detected dependency order is stable across runs — the returned
    // `Vec<String>` dependency lists consume the sorted traversal.
    let fixture = temp_fixture("sorted_traversal_determinism");
    let sub = fixture.join("packages");
    fs::create_dir_all(&sub).expect("packages dir");
    // Scrambled write-order.
    for name in ["BBB", "AAA", "CCC", "aAa"] {
        let path = sub.join(format!("{name}.txt"));
        fs::write(&path, "SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE").expect("write scratch");
    }
    // package.json written LAST — lexicographically earlier than packages/.
    let pkg_json = r#"{
        "_synthetic_marker": "SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE",
        "dependencies": { "beta": "1", "alpha": "2", "gamma": "3" }
    }"#;
    fs::write(fixture.join("package.json"), pkg_json).expect("write package.json");

    let make_scope = |tag: &str| {
        initialize_review_scope(ScopeInitInput {
            review_id: "review:synthetic-demo-001".to_string(),
            application_path: fixture.clone(),
            selected_commit: VALID_COMMIT.to_string(),
            output_path: fixture.join(format!("{tag}.json")),
            generated_at: "2026-07-08T00:00:00Z".to_string(),
        })
        .expect("scope should init")
    };
    let a = make_scope("a");
    let b = make_scope("b");
    let c = make_scope("c");

    let pja = manifest(&a, "package_json");
    let pjb = manifest(&b, "package_json");
    let pjc = manifest(&c, "package_json");
    // Dependency list order: alphabetically sorted via BTreeSet.
    assert_eq!(pja.dependencies, vec!["alpha", "beta", "gamma"]);
    assert_eq!(pja.dependencies, pjb.dependencies);
    assert_eq!(pja.dependencies, pjc.dependencies);
    assert_eq!(pja.dependency_count, pjb.dependency_count);
    assert_eq!(pja.dependency_count, pjc.dependency_count);
    // Identity bytes must match exactly.
    assert_eq!(a.repository_identity, b.repository_identity);
    assert_eq!(b.repository_identity, c.repository_identity);
    assert_eq!(a.review_scope_id, b.review_scope_id);
    assert_eq!(b.review_scope_id, c.review_scope_id);
}

#[test]
fn single_application_file_path_is_accepted_and_processed() {
    // Decision DN-2 (B): accept regular files as `--application-path`.
    let fixture = temp_fixture("single_application_file_path");
    fs::create_dir_all(&fixture).expect("fixture dir");
    let script = fixture.join("script.py");
    fs::write(
        &script,
        "# SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\nprint('hi')\n",
    )
    .expect("write script");
    validate_application_path(&script).expect("single file path should validate");
    let scope = initialize_review_scope(ScopeInitInput {
        review_id: "review:synthetic-demo-001".to_string(),
        application_path: script.clone(),
        selected_commit: VALID_COMMIT.to_string(),
        output_path: fixture.join("out.json"),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
    })
    .expect("scope should init with single file");
    // Only Python language fires; manifests are all not_found / unsupported as
    // appropriate (no package.json at the single-file "root").
    assert!(has_context(&scope, "language", "detected", "python"));
}

#[test]
fn requirements_subdirectory_txt_contributes_dependencies_and_signal() {
    let fixture = temp_fixture("requirements_subdir_txt");
    let reqs = fixture.join("requirements");
    fs::create_dir_all(&reqs).expect("reqs dir");
    fs::write(
        reqs.join("dev.txt"),
        "# SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\npytest==7.0.0\nDjango>=4.0\n",
    )
    .expect("dev requirements");
    fs::write(
        reqs.join("base.txt"),
        "# SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\nfastapi~=0.100.0\nFlask==2.0\n",
    )
    .expect("base requirements");

    let scope = initialize_review_scope(ScopeInitInput {
        review_id: "review:synthetic-demo-001".to_string(),
        application_path: fixture.clone(),
        selected_commit: VALID_COMMIT.to_string(),
        output_path: fixture.join("out.json"),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
    })
    .expect("scope should init");

    // Python signal fires because of `requirements/*.txt` presence.
    assert!(has_context(&scope, "language", "detected", "python"));
    let req = manifest(&scope, "requirements_txt");
    assert_eq!(req.status, "detected");
    // PEP 503 normalization: Django → django, Flask → flask.
    assert_eq!(
        req.dependencies,
        vec!["django", "fastapi", "flask", "pytest"]
    );
    // Lexicographically first requirements file is `requirements/base.txt`;
    // path should reflect that canonical file.
    assert!(
        req.path.as_deref().map(|p| p.replace('\\', "/")).as_deref()
            == Some("requirements/base.txt")
    );
    // Limitation field should mention the multi-file aggregation.
    assert!(
        req.limitation
            .as_deref()
            .unwrap_or_default()
            .contains("aggregated 2 requirements files")
    );
}

#[test]
fn pypi_name_pep_503_normalization_and_requirements_directives_and_urls() {
    let fixture = temp_fixture("pypi_pep_503_and_urls");
    fs::create_dir_all(&fixture).expect("fixture dir");
    let content = "\
# SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE
-r base.txt
-c constraints.txt
-e .
Zope.Interface==5.0
My_Project>=1.0
other-pkg[extra]==2.0
git+https://github.com/psf/requests.git#egg=requests
django@ git+https://github.com/django/django
flask==3.0 # vendored for demo
";
    fs::write(fixture.join("requirements.txt"), content).expect("write reqs");

    let scope = initialize_review_scope(ScopeInitInput {
        review_id: "review:synthetic-demo-001".to_string(),
        application_path: fixture.clone(),
        selected_commit: VALID_COMMIT.to_string(),
        output_path: fixture.join("out.json"),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
    })
    .expect("scope init");
    let req = manifest(&scope, "requirements_txt");
    assert_eq!(req.status, "detected");
    // PEP 503 normalization, extras stripped, include directives (-r/-c/-e .) skipped,
    // `#egg=requests` recovered from URL, `django@url` recovered as `django`,
    // trailing comment removed from `flask`.
    assert_eq!(
        req.dependencies,
        vec![
            "django",
            "flask",
            "my-project",
            "other-pkg",
            "requests",
            "zope-interface"
        ]
    );
}

#[test]
fn utf8_bom_package_json_still_parses_as_valid_object() {
    let fixture = temp_fixture("bom_package_json");
    fs::create_dir_all(&fixture).expect("fixture dir");
    // U+FEFF byte order mark prefix followed by valid JSON.
    let with_bom = "\u{FEFF}{\n  \"_synthetic_marker\": \"SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\",\n  \"dependencies\": { \"vue\": \"3.0.0\" }\n}\n";
    fs::write(fixture.join("package.json"), with_bom.as_bytes()).expect("bom json");
    let scope = initialize_review_scope(ScopeInitInput {
        review_id: "review:synthetic-demo-001".to_string(),
        application_path: fixture.clone(),
        selected_commit: VALID_COMMIT.to_string(),
        output_path: fixture.join("out.json"),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
    })
    .expect("scope should init with BOM-prefixed package.json");
    let pj = manifest(&scope, "package_json");
    assert_eq!(pj.status, "detected");
    assert!(has_context(&scope, "framework", "detected", "vue"));
}

#[test]
fn pyproject_toml_defaults_package_manager_to_unknown() {
    let fixture = temp_fixture("pyproject_unknown");
    fs::create_dir_all(&fixture).expect("fixture dir");
    fs::write(
        fixture.join("pyproject.toml"),
        "# SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\n[build-system]\nrequires = [\"setuptools\"]\n",
    )
    .expect("pyproject");
    let scope = initialize_review_scope(ScopeInitInput {
        review_id: "review:synthetic-demo-001".to_string(),
        application_path: fixture.clone(),
        selected_commit: VALID_COMMIT.to_string(),
        output_path: fixture.join("out.json"),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
    })
    .expect("scope");
    let pyproj = manifest(&scope, "pyproject_toml");
    assert_eq!(pyproj.status, "unsupported");
    assert_eq!(pyproj.package_manager, "unknown");
}

#[test]
fn symlinks_in_application_tree_are_skipped_to_prevent_escape_and_loops() {
    let fixture = temp_fixture("symlink_skip");
    let src = fixture.join("src");
    fs::create_dir_all(&src).expect("src dir");
    fs::write(
        src.join("app.ts"),
        "// SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\nexport const x = 1;\n",
    )
    .expect("app.ts");
    fs::write(
        fixture.join("package.json"),
        "{ \"_synthetic_marker\": \"SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\", \"dependencies\": { \"svelte\": \"4.0\" } }\n",
    )
    .expect("package.json");
    // (1) Symlink loop: `src/loop -> ..`
    let loop_link = src.join("loop");
    #[cfg(unix)]
    std::os::unix::fs::symlink("..", &loop_link).expect("create loop symlink");
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir("..", &loop_link).expect("create loop symlink");
    // (2) Symlink escape: `src/outside -> /tmp` (or /etc on Unix); a naive
    // walker would traverse into it and read arbitrary files.
    let outside_link = src.join("outside");
    #[cfg(unix)]
    std::os::unix::fs::symlink("/tmp", &outside_link).expect("create outside symlink");
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir("C:\\Windows\\Temp", &outside_link).expect("outside");

    let scope = initialize_review_scope(ScopeInitInput {
        review_id: "review:synthetic-demo-001".to_string(),
        application_path: fixture.clone(),
        selected_commit: VALID_COMMIT.to_string(),
        output_path: fixture.join("out.json"),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
    })
    .expect("scope should not stack-overflow / escape root");
    // Scope completes and detects svelte correctly.
    assert!(has_context(&scope, "framework", "detected", "svelte"));
    assert!(has_context(&scope, "language", "detected", "typescript"));
}

#[test]
fn monorepo_aggregates_dependencies_across_multiple_package_jsons() {
    let fixture = temp_fixture("monorepo_multiple_package_jsons");
    let pkg_a = fixture.join("packages/package-a");
    let pkg_b = fixture.join("apps/web");
    fs::create_dir_all(&pkg_a).expect("pkg_a");
    fs::create_dir_all(&pkg_b).expect("pkg_b");
    // Root package.json with react.
    fs::write(
        fixture.join("package.json"),
        "{ \"_synthetic_marker\": \"SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\", \"dependencies\": { \"react\": \"19.0\" } }\n",
    )
    .expect("root pj");
    // packages/package-a/package.json with vue.
    fs::write(
        pkg_a.join("package.json"),
        "{ \"_synthetic_marker\": \"SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\", \"dependencies\": { \"vue\": \"3.4\" } }\n",
    )
    .expect("pj a");
    // apps/web/package.json with svelte + typescript in devDeps.
    fs::write(
        pkg_b.join("package.json"),
        "{ \"_synthetic_marker\": \"SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\", \"dependencies\": { \"svelte\": \"4.0\" }, \"devDependencies\": { \"typescript\": \"6.0\" } }\n",
    )
    .expect("pj b");

    let scope = initialize_review_scope(ScopeInitInput {
        review_id: "review:synthetic-demo-001".to_string(),
        application_path: fixture.clone(),
        selected_commit: VALID_COMMIT.to_string(),
        output_path: fixture.join("out.json"),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
    })
    .expect("monorepo scope");
    let pj = manifest(&scope, "package_json");
    // Union across three package.jsons.
    assert_eq!(pj.status, "detected");
    assert_eq!(
        pj.dependencies,
        vec!["react", "svelte", "typescript", "vue"]
    );
    // Canonical path is the lexicographically first package.json across the tree.
    let primary_options = [
        "package.json",
        "apps/web/package.json",
        "packages/package-a/package.json",
    ];
    assert!(
        primary_options.contains(&pj.path.as_deref().unwrap_or("")),
        "unexpected canonical package.json path: {:?}",
        pj.path
    );
    assert!(
        pj.limitation
            .as_deref()
            .unwrap_or_default()
            .contains("aggregated 3 package.json manifests")
    );

    // Framework detection across union set.
    assert!(has_context(&scope, "framework", "detected", "react"));
    assert!(has_context(&scope, "framework", "detected", "vue"));
    assert!(has_context(&scope, "framework", "detected", "svelte"));
    assert!(has_context(&scope, "language", "detected", "typescript"));
}

fn temp_fixture(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("onevps-story-1-4-{name}-{nanos}"))
}

fn checked_in_synthetic_fixture_app() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/synthetic-scope-app")
}

fn fixture_name(path: &Path) -> String {
    path.file_name()
        .expect("fixture should have file name")
        .to_string_lossy()
        .into_owned()
}

fn assert_sha256_id(value: &str) {
    assert_eq!(value.len(), "sha256:".len() + 64);
    assert!(value.starts_with("sha256:"));
    assert!(
        value.as_bytes()["sha256:".len()..]
            .iter()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
    );
}

fn has_context(
    scope: &onevps_local_runner_scaffold::ReviewScope,
    context_type: &str,
    status: &str,
    value: &str,
) -> bool {
    scope.technical_context.iter().any(|entry| {
        entry.context_type == context_type
            && entry.status == status
            && entry.value.as_deref() == Some(value)
    })
}

fn manifest<'a>(
    scope: &'a onevps_local_runner_scaffold::ReviewScope,
    manifest_type: &str,
) -> &'a onevps_local_runner_scaffold::DependencyManifest {
    scope
        .dependency_manifests
        .iter()
        .find(|entry| entry.manifest_type == manifest_type)
        .unwrap_or_else(|| panic!("manifest {manifest_type} should be present"))
}
