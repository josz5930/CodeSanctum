// Generated from protocol/schemas/*.schema.json. Do not edit by hand.
// Regenerate with: npm run generate --workspace @onevps/protocol-ts

export const protocolV0Schemas = {
  "urn:codeattest:protocol:v0:accepted-risk-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:accepted-risk-record",
    "title": "Accepted Risk Record",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "review_id",
      "accepted_risk_record_id",
      "review_finding_draft_ref",
      "classification_record_ref",
      "recorded_at",
      "actor",
      "limitations",
      "source_reference_state",
      "source_derived_class",
      "visibility",
      "review_finding_draft_evidence_refs",
      "evidence_basis"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "accepted_risk_record_id": {
        "type": "string",
        "pattern": "^accepted_risk:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "review_finding_draft_ref": {
        "type": "string",
        "pattern": "^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "classification_record_ref": {
        "type": "string",
        "pattern": "^classification_record:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "review_finding_draft_evidence_refs": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "artifact_ref",
            "availability_state",
            "available_for_review",
            "display_state",
            "source_derived_class"
          ],
          "properties": {
            "artifact_ref": {
              "type": "string",
              "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "availability_state": {
              "type": "string",
              "enum": [
                "retained_review_artifact",
                "deleted_under_policy",
                "never_collected",
                "not_submitted_by_policy",
                "unresolved_reference"
              ]
            },
            "available_for_review": {
              "type": "boolean"
            },
            "display_state": {
              "type": "string",
              "enum": [
                "available_reference",
                "deleted",
                "not_collected",
                "not_submitted",
                "unresolved_reference"
              ]
            },
            "deletion_evidence_ref": {
              "type": "string",
              "pattern": "^deletion_evidence:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "source_derived_class": {
              "$ref": "urn:codeattest:protocol:v0:retention-source-derived-class"
            }
          }
        }
      },
      "evidence_basis": {
        "type": "array",
        "minItems": 1,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "enum": [
            "scanner_output",
            "metadata_only",
            "finding_context_snippet",
            "extended_approved_source_context",
            "retained_review_artifact",
            "deleted_under_policy_reference",
            "not_submitted_by_policy_reference",
            "never_collected_reference",
            "unresolved_reference"
          ]
        }
      },
      "customer_rationale": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "customer_signoff_ref": {
        "type": "string",
        "pattern": "^customer_signoff:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "customer_signoff_summary": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "customer_actor_ref": {
        "type": "string",
        "pattern": "^customer:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "risk_owner": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "scope_of_acceptance": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "review_by_date": {
        "type": "string",
        "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
      },
      "remediation_context_ref": {
        "type": "string",
        "pattern": "^remediation_guidance:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "validation_path_ref": {
        "type": "string",
        "pattern": "^validation_path:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "recorded_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "actor": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/actor_reference"
      },
      "limitations": {
        "type": "array",
        "maxItems": 100,
        "minItems": 1,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "source_reference_state": {
        "type": "string",
        "enum": [
          "retained_review_artifact",
          "deleted_under_policy",
          "never_collected",
          "not_submitted_by_policy",
          "unresolved_reference"
        ]
      },
      "source_derived_class": {
        "type": "string",
        "const": "retained_review_artifact"
      },
      "visibility": {
        "type": "string",
        "enum": [
          "customer_facing",
          "internal_only"
        ]
      },
      "field_export_policy": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "customer_rationale",
          "customer_signoff_summary",
          "risk_owner",
          "scope_of_acceptance",
          "limitations",
          "evidence_consumer_export",
          "evidence_basis"
        ],
        "properties": {
          "customer_rationale": {
            "type": "string",
            "enum": [
              "include",
              "exclude"
            ]
          },
          "customer_signoff_summary": {
            "type": "string",
            "enum": [
              "include",
              "exclude"
            ]
          },
          "risk_owner": {
            "type": "string",
            "enum": [
              "include",
              "exclude"
            ]
          },
          "scope_of_acceptance": {
            "type": "string",
            "enum": [
              "include",
              "exclude"
            ]
          },
          "limitations": {
            "type": "string",
            "enum": [
              "include",
              "exclude"
            ]
          },
          "evidence_consumer_export": {
            "type": "string",
            "enum": [
              "include",
              "exclude"
            ]
          },
          "evidence_basis": {
            "type": "string",
            "enum": [
              "include",
              "exclude"
            ]
          }
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:artifact-reference": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:artifact-reference",
    "title": "Artifact Reference",
    "type": "object",
    "additionalProperties": false,
    "dependentRequired": {
      "content_path": [
        "content_path_anchor"
      ]
    },
    "required": [
      "protocol_version",
      "artifact_ref",
      "artifact_type",
      "digest",
      "size_bytes",
      "source_derived_class",
      "manifest_entry_ref"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "artifact_ref": {
        "type": "string",
        "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "artifact_type": {
        "type": "string",
        "enum": [
          "review_scope",
          "disclosure_policy",
          "dependency_manifest",
          "scanner_finding_set",
          "scanner_raw_output",
          "raw_snippet",
          "targeted_file",
          "outbound_manifest",
          "customer_approval",
          "bundle_manifest",
          "signature_envelope"
        ]
      },
      "digest": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/artifact_digest"
      },
      "size_bytes": {
        "type": "integer",
        "minimum": 0,
        "maximum": 9007199254740991
      },
      "source_derived_class": {
        "$ref": "urn:codeattest:protocol:v0:retention-source-derived-class"
      },
      "manifest_entry_ref": {
        "type": "string",
        "pattern": "^manifest_entry:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "media_type": {
        "type": "string",
        "minLength": 1
      },
      "content_path": {
        "type": "string",
        "minLength": 1,
        "pattern": "^(?!/)(?![A-Za-z]:)(?!.*\\\\)(?!.*//)(?!.*(?:^|/)\\.\\.?(?:/|$))[a-zA-Z0-9._/-]+$"
      },
      "content_path_anchor": {
        "type": "string",
        "enum": [
          "manifest_artifacts",
          "bundle_artifacts",
          "bundle_source_derived_artifacts",
          "fixture_root"
        ]
      },
      "synthetic_markers": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "items": {
          "type": "string",
          "enum": [
            "SYNTHETIC_DEMO_DATA",
            "NOT_CUSTOMER_SOURCE"
          ]
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:attestation-package-finalization": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:attestation-package-finalization",
    "title": "Attestation Package Finalization",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "attestation_package_finalization_id",
      "finalization_version",
      "review_id",
      "static_bundle_id",
      "generated_manifest_ref",
      "finalized_manifest_ref",
      "finalized_manifest_version",
      "customer_actor",
      "visible_context",
      "receipt_verification_state",
      "signature_verification_state",
      "deletion_evidence_state",
      "portal_verification_state",
      "finalized_at",
      "customer_control_after_export",
      "export_state",
      "visibility",
      "source_derived_class",
      "canonicalization",
      "identity_hash_algorithm",
      "identity_input_excludes"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "attestation_package_finalization_id": {
        "type": "string",
        "pattern": "^attestation_finalization:[a-f0-9]{64}$"
      },
      "finalization_version": {
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "static_bundle_id": {
        "type": "string",
        "pattern": "^static_bundle:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "generated_manifest_ref": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "finalized_manifest_ref": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "finalized_manifest_version": {
        "type": "integer",
        "minimum": 2,
        "maximum": 9007199254740991
      },
      "customer_actor": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "actor_type",
          "actor_id"
        ],
        "properties": {
          "actor_type": {
            "type": "string",
            "const": "customer_user"
          },
          "actor_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "visible_context": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "attestation_id",
          "static_bundle_id",
          "generated_manifest_id",
          "limitations_visible",
          "receipt_context_visible",
          "export_consequence_visible"
        ],
        "properties": {
          "attestation_id": {
            "type": "string",
            "pattern": "^attestation:[a-f0-9]{64}$"
          },
          "static_bundle_id": {
            "type": "string",
            "pattern": "^static_bundle:[a-z0-9][a-z0-9_-]{2,63}$"
          },
          "generated_manifest_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
          },
          "limitations_visible": {
            "type": "boolean",
            "const": true
          },
          "receipt_context_visible": {
            "type": "boolean",
            "const": true
          },
          "export_consequence_visible": {
            "type": "boolean",
            "const": true
          }
        }
      },
      "receipt_verification_state": {
        "type": "string",
        "const": "verified"
      },
      "signature_verification_state": {
        "type": "string",
        "const": "verified"
      },
      "deletion_evidence_state": {
        "type": "string",
        "const": "resolved"
      },
      "portal_verification_state": {
        "type": "string",
        "const": "verified_offline"
      },
      "finalized_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "customer_control_after_export": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "export_state": {
        "type": "string",
        "enum": [
          "not_exported",
          "exported"
        ]
      },
      "exported_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "visibility": {
        "type": "string",
        "const": "customer_facing"
      },
      "source_derived_class": {
        "type": "string",
        "const": "retained_review_artifact"
      },
      "canonicalization": {
        "type": "string",
        "const": "rfc8785"
      },
      "identity_hash_algorithm": {
        "type": "string",
        "const": "sha256"
      },
      "identity_input_excludes": {
        "type": "array",
        "minItems": 3,
        "maxItems": 3,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "enum": [
            "attestation_package_finalization_id",
            "export_state",
            "exported_at"
          ]
        }
      }
    },
    "allOf": [
      {
        "if": {
          "properties": {
            "export_state": {
              "const": "exported"
            }
          }
        },
        "then": {
          "required": [
            "exported_at"
          ]
        },
        "else": {
          "not": {
            "required": [
              "exported_at"
            ]
          }
        }
      }
    ]
  },
  "urn:codeattest:protocol:v0:bundle-manifest": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:bundle-manifest",
    "title": "Evidence Bundle Manifest",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "evidence_bundle_id",
      "manifest_id",
      "customer_approval_ref",
      "customer_approval_decision",
      "bundle_state",
      "review_scope_ref",
      "disclosure_policy_ref",
      "coverage_mode",
      "bundle_instance_id",
      "submission_attempt_id",
      "created_at",
      "runner",
      "tool_versions",
      "artifact_references",
      "verification_metadata",
      "local_cleanup_intent"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "evidence_bundle_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "manifest_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "customer_approval_ref": {
        "type": "string",
        "pattern": "^approval:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "customer_approval_decision": {
        "type": "string",
        "const": "approved"
      },
      "bundle_state": {
        "type": "string",
        "const": "not_submitted"
      },
      "review_scope_ref": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "disclosure_policy_ref": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "scanner_finding_set_ref": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "coverage_mode": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/coverage_mode"
      },
      "bundle_instance_id": {
        "type": "string",
        "pattern": "^bundle_instance:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "submission_attempt_id": {
        "type": "string",
        "pattern": "^submission_attempt:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "created_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "runner": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "name",
          "version"
        ],
        "properties": {
          "name": {
            "type": "string",
            "const": "codeattest-local-runner"
          },
          "version": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "tool_versions": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "tool_name",
            "tool_version"
          ],
          "properties": {
            "tool_name": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "tool_version": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            }
          }
        }
      },
      "artifact_references": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 4,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:artifact-reference"
        }
      },
      "verification_metadata": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "identity_canonicalization",
          "identity_hash_algorithm",
          "identity_input_excludes",
          "signed_identity_type",
          "approved_manifest_id",
          "signature_envelope_path",
          "bundle_signing_mode"
        ],
        "properties": {
          "identity_canonicalization": {
            "type": "string",
            "const": "rfc8785"
          },
          "identity_hash_algorithm": {
            "type": "string",
            "const": "sha256"
          },
          "identity_input_excludes": {
            "type": "array",
            "maxItems": 10000,
            "minItems": 1,
            "items": {
              "type": "string",
              "enum": [
                "evidence_bundle_id"
              ]
            }
          },
          "signed_identity_type": {
            "type": "string",
            "const": "evidence_bundle"
          },
          "approved_manifest_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
          },
          "signature_envelope_path": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "bundle_signing_mode": {
            "type": "string",
            "enum": [
              "managed_key",
              "enrolled_runner_key"
            ]
          }
        }
      },
      "local_cleanup_intent": {
        "type": "array",
        "maxItems": 10000,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "artifact_ref",
            "source_derived_class",
            "cleanup_state",
            "cleanup_required",
            "deletion_evidence_state"
          ],
          "properties": {
            "artifact_ref": {
              "type": "string",
              "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "source_derived_class": {
              "$ref": "urn:codeattest:protocol:v0:retention-source-derived-class"
            },
            "cleanup_state": {
              "type": "string",
              "enum": [
                "pending_local_cleanup",
                "not_applicable"
              ]
            },
            "cleanup_required": {
              "type": "boolean"
            },
            "deletion_evidence_state": {
              "type": "string",
              "enum": [
                "pending",
                "not_applicable"
              ]
            }
          }
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:customer-approval": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:customer-approval",
    "title": "Customer Approval Decision",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "approval_id",
      "manifest_id",
      "decision",
      "decided_at",
      "displayed_context",
      "warnings_acknowledged"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "approval_id": {
        "type": "string",
        "pattern": "^approval:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "manifest_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "decision": {
        "type": "string",
        "enum": [
          "approved",
          "declined"
        ]
      },
      "decided_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "approving_actor": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/actor_reference"
      },
      "displayed_context": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "manifest_id",
          "selected_application",
          "selected_commit",
          "repository_identity",
          "coverage_mode",
          "disclosure_policy_ref",
          "disclosure_warnings",
          "bundle_preview_summary"
        ],
        "properties": {
          "manifest_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
          },
          "selected_application": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "application_id",
              "display_name"
            ],
            "properties": {
              "application_id": {
                "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
              },
              "display_name": {
                "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
              }
            }
          },
          "selected_commit": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "commit_sha",
              "source_control_system"
            ],
            "properties": {
              "commit_sha": {
                "type": "string",
                "pattern": "^[a-f0-9]{40}$"
              },
              "source_control_system": {
                "type": "string",
                "enum": [
                  "git"
                ]
              }
            }
          },
          "repository_identity": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
          },
          "coverage_mode": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/coverage_mode"
          },
          "disclosure_policy_ref": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
          },
          "scanner_finding_set_ref": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
          },
          "disclosure_warnings": {
            "type": "array",
            "maxItems": 100,
            "minItems": 1,
            "items": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
            }
          },
          "bundle_preview_summary": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "warnings_acknowledged": {
        "type": "array",
        "maxItems": 100,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "not_submitted_state": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "state",
          "evidence_bundle_created",
          "evidence_sent",
          "next_actions"
        ],
        "properties": {
          "state": {
            "type": "string",
            "const": "not_submitted"
          },
          "evidence_bundle_created": {
            "type": "boolean",
            "const": false
          },
          "evidence_sent": {
            "type": "boolean",
            "const": false
          },
          "next_actions": {
            "type": "array",
            "maxItems": 10000,
            "minItems": 4,
            "items": {
              "type": "string",
              "enum": [
                "revise policy",
                "rerun scan",
                "export manifest",
                "exit"
              ]
            }
          }
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:customer-facing-finding-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:customer-facing-finding-record",
    "title": "Customer-Facing Finding Record",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "review_id",
      "customer_facing_finding_record_id",
      "review_finding_draft_ref",
      "expert_classification",
      "evidence_basis",
      "reviewer_remediation_guidance",
      "customer_remediation_status",
      "verification_state",
      "future_outcome_visibility",
      "evidence_consumer_export",
      "visibility",
      "source_derived_class"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "customer_facing_finding_record_id": {
        "type": "string",
        "pattern": "^customer_facing_finding:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "review_finding_draft_ref": {
        "type": "string",
        "pattern": "^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "classification_record_ref": {
        "type": "string",
        "pattern": "^classification_record:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "remediation_guidance_ref": {
        "type": "string",
        "pattern": "^remediation_guidance:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "customer_status_record_refs": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 0,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "pattern": "^customer_status:[a-z0-9][a-z0-9_-]{2,63}$"
        }
      },
      "verification_record_ref": {
        "type": "string",
        "pattern": "^verification_record:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "accepted_risk_record_ref": {
        "type": "string",
        "pattern": "^accepted_risk:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "false_positive_record_ref": {
        "type": "string",
        "pattern": "^false_positive:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "expert_classification": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "classification",
          "classification_record_ref",
          "rationale_summary",
          "criteria_summary",
          "limitations"
        ],
        "properties": {
          "classification": {
            "type": "string",
            "enum": [
              "likely",
              "confirmed",
              "inconclusive",
              "requires_customer_side_validation"
            ]
          },
          "classification_record_ref": {
            "type": "string",
            "pattern": "^classification_record:[a-z0-9][a-z0-9_-]{2,63}$"
          },
          "rationale_summary": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "criteria_summary": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "limitations": {
            "type": "array",
            "maxItems": 100,
            "minItems": 1,
            "items": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
            }
          }
        }
      },
      "evidence_basis": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "evidence_refs",
          "source_reference_state",
          "limitations"
        ],
        "properties": {
          "evidence_refs": {
            "type": "array",
            "maxItems": 10000,
            "minItems": 1,
            "uniqueItems": true,
            "items": {
              "type": "string",
              "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
            }
          },
          "source_reference_state": {
            "type": "string",
            "enum": [
              "retained_review_artifact",
              "deleted_under_policy",
              "never_collected",
              "not_submitted_by_policy",
              "unresolved_reference"
            ]
          },
          "limitations": {
            "type": "array",
            "maxItems": 100,
            "minItems": 1,
            "items": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
            }
          }
        }
      },
      "reviewer_remediation_guidance": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "guidance_status",
          "limitations"
        ],
        "properties": {
          "guidance_status": {
            "type": "string",
            "enum": [
              "actionable_guidance_provided",
              "limited_guidance_requires_validation",
              "guidance_unavailable_from_submitted_evidence"
            ]
          },
          "remediation_guidance_ref": {
            "type": "string",
            "pattern": "^remediation_guidance:[a-z0-9][a-z0-9_-]{2,63}$"
          },
          "exploitability_rationale_summary": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "suggested_remediation_summary": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "validation_step_summary": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "next_step_summary": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "validation_path_summary": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "validation_path_ref": {
            "type": "string",
            "pattern": "^validation_path:[a-z0-9][a-z0-9_-]{2,63}$"
          },
          "insufficient_evidence_reason": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "limitations": {
            "type": "array",
            "maxItems": 100,
            "minItems": 1,
            "items": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
            }
          }
        }
      },
      "customer_remediation_status": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "latest_status",
          "customer_notes_visible"
        ],
        "properties": {
          "latest_status": {
            "type": "string",
            "enum": [
              "not_started",
              "planned",
              "in_progress",
              "remediated_by_customer",
              "validation_pending",
              "deferred",
              "not_applicable"
            ]
          },
          "latest_status_record_ref": {
            "type": "string",
            "pattern": "^customer_status:[a-z0-9][a-z0-9_-]{2,63}$"
          },
          "owner": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "due_date": {
            "type": "string",
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "target_state": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "customer_notes_summary": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "customer_notes_visible": {
            "type": "boolean"
          }
        }
      },
      "verification_state": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "status",
          "summary"
        ],
        "properties": {
          "status": {
            "type": "string",
            "enum": [
              "not_verified",
              "verification_pending",
              "verification_complete",
              "requires_customer_side_validation"
            ]
          },
          "verification_record_ref": {
            "type": "string",
            "pattern": "^verification_record:[a-z0-9][a-z0-9_-]{2,63}$"
          },
          "summary": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "future_outcome_visibility": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "accepted_risk_visible",
          "false_positive_visible"
        ],
        "properties": {
          "accepted_risk_visible": {
            "type": "boolean"
          },
          "accepted_risk_record_ref": {
            "type": "string",
            "pattern": "^accepted_risk:[a-z0-9][a-z0-9_-]{2,63}$"
          },
          "false_positive_visible": {
            "type": "boolean"
          },
          "false_positive_record_ref": {
            "type": "string",
            "pattern": "^false_positive:[a-z0-9][a-z0-9_-]{2,63}$"
          }
        }
      },
      "validation_paths": {
        "type": "array",
        "maxItems": 10000,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "validation_path_ref",
            "path_type",
            "required_evidence",
            "steps",
            "expected_result",
            "limitations",
            "included_pass_verifiability"
          ],
          "properties": {
            "validation_path_ref": {
              "type": "string",
              "pattern": "^validation_path:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "path_type": {
              "type": "string",
              "enum": [
                "remote_dynamic_testing",
                "customer_run_script",
                "manual_steps"
              ]
            },
            "required_evidence": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "steps": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "expected_result": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "limitations": {
              "type": "array",
              "maxItems": 100,
              "minItems": 1,
              "items": {
                "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
              }
            },
            "included_pass_verifiability": {
              "type": "string",
              "enum": [
                "verifiable_within_included_pass",
                "customer_provided_evidence_required",
                "additional_agreement_required"
              ]
            },
            "reviewer_validation_script_refs": {
              "type": "array",
              "maxItems": 10000,
              "minItems": 1,
              "uniqueItems": true,
              "items": {
                "type": "string",
                "pattern": "^validation_script:[a-z0-9][a-z0-9_-]{2,63}$"
              }
            },
            "output_attachment_instructions": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "target": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "authorization_assumption": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "method": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "safety_constraints": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "evidence_artifacts_to_collect": {
              "type": "array",
              "maxItems": 10000,
              "minItems": 1,
              "uniqueItems": true,
              "items": {
                "type": "string",
                "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
              }
            }
          }
        }
      },
      "reviewer_validation_scripts": {
        "type": "array",
        "maxItems": 10000,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "validation_script_ref",
            "validation_path_ref",
            "script_package_status",
            "purpose",
            "prerequisites",
            "execution_steps",
            "expected_output",
            "safety_notes",
            "output_attachment_instructions",
            "script_content"
          ],
          "properties": {
            "validation_script_ref": {
              "type": "string",
              "pattern": "^validation_script:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "validation_path_ref": {
              "type": "string",
              "pattern": "^validation_path:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "script_package_status": {
              "type": "string",
              "enum": [
                "included_base_package",
                "additional_script_candidate_pricing_tbd"
              ]
            },
            "included_script_slot": {
              "type": "integer",
              "minimum": 1,
              "maximum": 3
            },
            "pricing_note": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "purpose": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "prerequisites": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "execution_steps": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "expected_output": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "safety_notes": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "output_attachment_instructions": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "script_content": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            }
          }
        }
      },
      "evidence_consumer_export": {
        "type": "string",
        "enum": [
          "include",
          "exclude"
        ]
      },
      "visibility": {
        "type": "string",
        "enum": [
          "customer_facing",
          "internal_only"
        ]
      },
      "source_derived_class": {
        "type": "string",
        "const": "retained_review_artifact"
      },
      "accepted_risk_outcome": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "accepted_risk_record_ref",
          "actor_category",
          "evidence_basis_summary",
          "evidence_refs",
          "customer_acceptance_summary",
          "limitations",
          "source_reference_state",
          "evidence_consumer_export"
        ],
        "properties": {
          "accepted_risk_record_ref": {
            "type": "string",
            "pattern": "^accepted_risk:[a-z0-9][a-z0-9_-]{2,63}$"
          },
          "actor_category": {
            "type": "string",
            "enum": [
              "customer_user",
              "reviewer",
              "vendor_service"
            ]
          },
          "evidence_basis_summary": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "evidence_refs": {
            "type": "array",
            "maxItems": 10000,
            "minItems": 0,
            "uniqueItems": true,
            "items": {
              "type": "string",
              "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
            }
          },
          "customer_acceptance_summary": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "risk_owner": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "scope_of_acceptance": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "review_by_date": {
            "type": "string",
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "remediation_context_ref": {
            "type": "string",
            "pattern": "^remediation_guidance:[a-z0-9][a-z0-9_-]{2,63}$"
          },
          "validation_path_ref": {
            "type": "string",
            "pattern": "^validation_path:[a-z0-9][a-z0-9_-]{2,63}$"
          },
          "limitations": {
            "type": "array",
            "maxItems": 100,
            "minItems": 1,
            "items": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
            }
          },
          "source_reference_state": {
            "type": "string",
            "enum": [
              "retained_review_artifact",
              "deleted_under_policy",
              "never_collected",
              "not_submitted_by_policy",
              "unresolved_reference"
            ]
          },
          "evidence_consumer_export": {
            "type": "string",
            "enum": [
              "include",
              "exclude"
            ]
          }
        }
      },
      "false_positive_outcome": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "false_positive_record_ref",
          "actor_category",
          "evidence_basis_summary",
          "evidence_refs",
          "rationale_summary",
          "limitations",
          "source_reference_state",
          "evidence_consumer_export"
        ],
        "properties": {
          "false_positive_record_ref": {
            "type": "string",
            "pattern": "^false_positive:[a-z0-9][a-z0-9_-]{2,63}$"
          },
          "actor_category": {
            "type": "string",
            "const": "reviewer"
          },
          "evidence_basis_summary": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "evidence_refs": {
            "type": "array",
            "maxItems": 10000,
            "minItems": 0,
            "uniqueItems": true,
            "items": {
              "type": "string",
              "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
            }
          },
          "rationale_summary": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "candidate_finding_refs": {
            "type": "array",
            "maxItems": 10000,
            "minItems": 1,
            "uniqueItems": true,
            "items": {
              "type": "string",
              "pattern": "^candidate_finding:[a-z0-9][a-z0-9_-]{2,63}$"
            }
          },
          "limitations": {
            "type": "array",
            "maxItems": 100,
            "minItems": 1,
            "items": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
            }
          },
          "source_reference_state": {
            "type": "string",
            "enum": [
              "retained_review_artifact",
              "deleted_under_policy",
              "never_collected",
              "not_submitted_by_policy",
              "unresolved_reference"
            ]
          },
          "evidence_consumer_export": {
            "type": "string",
            "enum": [
              "include",
              "exclude"
            ]
          }
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:customer-remediation-status-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:customer-remediation-status-record",
    "title": "Customer Remediation Status Record",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "review_id",
      "customer_status_record_id",
      "customer_remediation_status",
      "recorded_at",
      "actor",
      "visibility",
      "source_derived_class"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "customer_status_record_id": {
        "type": "string",
        "pattern": "^customer_status:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "finding_ref": {
        "type": "string",
        "pattern": "^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "classification_record_ref": {
        "type": "string",
        "pattern": "^classification_record:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "remediation_guidance_ref": {
        "type": "string",
        "pattern": "^remediation_guidance:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "customer_remediation_status": {
        "type": "string",
        "enum": [
          "not_started",
          "planned",
          "in_progress",
          "remediated_by_customer",
          "validation_pending",
          "deferred",
          "not_applicable"
        ]
      },
      "owner": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "due_date": {
        "type": "string",
        "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
      },
      "target_state": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "customer_notes": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "recorded_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "actor": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "actor_type",
          "actor_id"
        ],
        "properties": {
          "actor_type": {
            "type": "string",
            "const": "customer_user"
          },
          "actor_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "field_export_policy": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "owner",
          "due_date",
          "target_state",
          "customer_notes"
        ],
        "properties": {
          "owner": {
            "type": "string",
            "enum": [
              "include",
              "exclude"
            ]
          },
          "due_date": {
            "type": "string",
            "enum": [
              "include",
              "exclude"
            ]
          },
          "target_state": {
            "type": "string",
            "enum": [
              "include",
              "exclude"
            ]
          },
          "customer_notes": {
            "type": "string",
            "enum": [
              "include",
              "exclude"
            ]
          }
        }
      },
      "visibility": {
        "type": "string",
        "enum": [
          "customer_facing",
          "internal_only"
        ]
      },
      "source_derived_class": {
        "type": "string",
        "const": "retained_review_artifact"
      }
    }
  },
  "urn:codeattest:protocol:v0:deletion-evidence": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:deletion-evidence",
    "title": "Deletion Evidence",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "deletion_evidence_id",
      "deleted_artifact_digests",
      "deletion_method",
      "deletion_timestamp",
      "actor",
      "verification_status"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "deletion_evidence_id": {
        "type": "string",
        "pattern": "^deletion_evidence:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "deleted_artifact_digests": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "uniqueItems": true,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/artifact_digest"
        }
      },
      "deletion_method": {
        "type": "string",
        "enum": [
          "crypto_erase",
          "secure_delete",
          "key_destruction",
          "expiry_purge"
        ]
      },
      "deletion_timestamp": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "actor": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/actor_reference"
      },
      "verification_status": {
        "type": "string",
        "enum": [
          "verified",
          "unverified"
        ]
      },
      "supersedes_deletion_evidence_ref": {
        "type": "string",
        "pattern": "^deletion_evidence:[a-z0-9][a-z0-9_-]{2,63}$"
      }
    }
  },
  "urn:codeattest:protocol:v0:disclosure-policy": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:disclosure-policy",
    "title": "Disclosure Policy",
    "type": "object",
    "additionalProperties": false,
    "allOf": [
      {
        "if": {
          "properties": {
            "include_scanner_findings": {
              "const": true
            }
          },
          "required": [
            "include_scanner_findings"
          ]
        },
        "then": {
          "required": [
            "scanner_finding_set_ref"
          ]
        }
      },
      {
        "if": {
          "properties": {
            "coverage_mode": {
              "const": "metadata_only"
            }
          },
          "required": [
            "coverage_mode"
          ]
        },
        "then": {
          "properties": {
            "snippet_policy": {
              "properties": {
                "allow_raw_snippets": {
                  "const": false
                },
                "max_snippet_chars": {
                  "const": 0
                },
                "context_lines": {
                  "const": 0
                },
                "selection_behavior": {
                  "const": "none"
                },
                "selected_files_or_areas": {
                  "maxItems": 0
                }
              }
            },
            "evidence_categories": {
              "not": {
                "contains": {
                  "type": "object",
                  "properties": {
                    "category": {
                      "enum": [
                        "raw_snippets",
                        "targeted_files"
                      ]
                    },
                    "included": {
                      "const": true
                    }
                  },
                  "required": [
                    "category",
                    "included"
                  ]
                }
              }
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "coverage_mode": {
              "const": "finding_context_snippets"
            }
          },
          "required": [
            "coverage_mode"
          ]
        },
        "then": {
          "properties": {
            "snippet_policy": {
              "properties": {
                "allow_raw_snippets": {
                  "const": true
                },
                "max_snippet_chars": {
                  "minimum": 1
                },
                "selection_behavior": {
                  "const": "finding_context"
                },
                "selected_files_or_areas": {
                  "maxItems": 0
                }
              }
            },
            "evidence_categories": {
              "allOf": [
                {
                  "contains": {
                    "type": "object",
                    "properties": {
                      "category": {
                        "const": "raw_snippets"
                      },
                      "included": {
                        "const": true
                      }
                    },
                    "required": [
                      "category",
                      "included"
                    ]
                  },
                  "minContains": 1,
                  "maxContains": 1
                },
                {
                  "contains": {
                    "type": "object",
                    "properties": {
                      "category": {
                        "const": "targeted_files"
                      },
                      "included": {
                        "const": false
                      }
                    },
                    "required": [
                      "category",
                      "included"
                    ]
                  },
                  "minContains": 1,
                  "maxContains": 1
                }
              ]
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "coverage_mode": {
              "const": "extended_approved_snippets_or_targeted_files"
            }
          },
          "required": [
            "coverage_mode"
          ]
        },
        "then": {
          "properties": {
            "snippet_policy": {
              "properties": {
                "allow_raw_snippets": {
                  "const": true
                },
                "selection_behavior": {
                  "const": "extended_selected_files_or_areas"
                },
                "selected_files_or_areas": {
                  "minItems": 1
                }
              }
            },
            "evidence_categories": {
              "allOf": [
                {
                  "contains": {
                    "type": "object",
                    "properties": {
                      "category": {
                        "const": "raw_snippets"
                      },
                      "included": {
                        "const": true
                      }
                    },
                    "required": [
                      "category",
                      "included"
                    ]
                  },
                  "minContains": 1,
                  "maxContains": 1
                },
                {
                  "contains": {
                    "type": "object",
                    "properties": {
                      "category": {
                        "const": "targeted_files"
                      },
                      "included": {
                        "const": true
                      }
                    },
                    "required": [
                      "category",
                      "included"
                    ]
                  },
                  "minContains": 1,
                  "maxContains": 1
                }
              ]
            }
          }
        }
      }
    ],
    "required": [
      "protocol_version",
      "disclosure_policy_id",
      "created_at",
      "review_scope_ref",
      "coverage_mode",
      "include_metadata",
      "include_dependency_information",
      "include_scanner_findings",
      "evidence_categories",
      "snippet_policy",
      "redaction_policy",
      "retention_policy",
      "warnings",
      "limitations"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "disclosure_policy_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "created_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "review_scope_ref": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "scanner_finding_set_ref": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "coverage_mode": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/coverage_mode"
      },
      "include_metadata": {
        "type": "boolean"
      },
      "include_dependency_information": {
        "type": "boolean"
      },
      "include_scanner_findings": {
        "type": "boolean"
      },
      "evidence_categories": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 7,
        "uniqueItems": true,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "category",
            "included",
            "source_derived_class",
            "retention_handling"
          ],
          "properties": {
            "category": {
              "type": "string",
              "enum": [
                "metadata",
                "dependencies",
                "scanner_findings",
                "raw_snippets",
                "targeted_files",
                "derived_artifacts",
                "never_collected_items"
              ]
            },
            "included": {
              "type": "boolean"
            },
            "source_derived_class": {
              "$ref": "urn:codeattest:protocol:v0:retention-source-derived-class"
            },
            "retention_handling": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "limitation": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            }
          }
        }
      },
      "snippet_policy": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "allow_raw_snippets",
          "max_snippet_chars",
          "context_lines",
          "redaction_profile",
          "raw_snippet_default_class",
          "selection_behavior",
          "selected_files_or_areas"
        ],
        "properties": {
          "allow_raw_snippets": {
            "type": "boolean"
          },
          "max_snippet_chars": {
            "type": "integer",
            "minimum": 0,
            "maximum": 2000
          },
          "context_lines": {
            "type": "integer",
            "minimum": 0,
            "maximum": 10
          },
          "redaction_profile": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "raw_snippet_default_class": {
            "type": "string",
            "const": "transient_source_derived"
          },
          "selection_behavior": {
            "type": "string",
            "enum": [
              "none",
              "finding_context",
              "extended_selected_files_or_areas"
            ]
          },
          "selected_files_or_areas": {
            "type": "array",
            "maxItems": 10000,
            "items": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            }
          }
        }
      },
      "redaction_policy": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "enabled",
          "profile",
          "configuration_version",
          "limitation"
        ],
        "properties": {
          "enabled": {
            "type": "boolean"
          },
          "profile": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "configuration_version": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "limitation": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "retention_policy": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "raw_snippet_class",
          "targeted_file_class",
          "retain_source_opt_in",
          "retention_period"
        ],
        "properties": {
          "raw_snippet_class": {
            "$ref": "urn:codeattest:protocol:v0:retention-source-derived-class"
          },
          "targeted_file_class": {
            "$ref": "urn:codeattest:protocol:v0:retention-source-derived-class"
          },
          "retain_source_opt_in": {
            "type": "boolean"
          },
          "retention_period": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "warnings": {
        "type": "array",
        "maxItems": 100,
        "minItems": 1,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "limitations": {
        "type": "array",
        "maxItems": 100,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "synthetic_fixture_markers": {
        "type": "array",
        "maxItems": 10000,
        "items": {
          "type": "string",
          "enum": [
            "SYNTHETIC_DEMO_DATA",
            "NOT_CUSTOMER_SOURCE"
          ]
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:environment-evidence-gate": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:environment-evidence-gate",
    "title": "Environment Evidence Gate",
    "type": "object",
    "additionalProperties": false,
    "allOf": [
      {
        "if": {
          "properties": {
            "environment_profile": {
              "const": "partner_pilot_real_snippet_ready"
            }
          },
          "required": [
            "environment_profile"
          ]
        },
        "then": {
          "required": [
            "readiness_decision_ref"
          ]
        },
        "else": {
          "not": {
            "required": [
              "readiness_decision_ref"
            ]
          }
        }
      },
      {
        "if": {
          "properties": {
            "environment_profile": {
              "const": "synthetic_demo"
            }
          },
          "required": [
            "environment_profile"
          ]
        },
        "then": {
          "properties": {
            "real_raw_snippet_acceptance": {
              "const": false
            },
            "real_targeted_file_acceptance": {
              "const": false
            },
            "evidence_boundary": {
              "const": "synthetic-demo-only"
            },
            "allowed_source_derived_classes": {
              "not": {
                "contains": {
                  "const": "customer_opt_in_retained_source"
                }
              }
            }
          }
        }
      },
      {
        "if": {
          "anyOf": [
            {
              "properties": {
                "real_raw_snippet_acceptance": {
                  "const": true
                }
              },
              "required": [
                "real_raw_snippet_acceptance"
              ]
            },
            {
              "properties": {
                "real_targeted_file_acceptance": {
                  "const": true
                }
              },
              "required": [
                "real_targeted_file_acceptance"
              ]
            },
            {
              "properties": {
                "allowed_source_derived_classes": {
                  "contains": {
                    "const": "customer_opt_in_retained_source"
                  }
                }
              }
            }
          ]
        },
        "then": {
          "properties": {
            "environment_profile": {
              "const": "partner_pilot_real_snippet_ready"
            },
            "access_control_ready": {
              "const": true
            },
            "access_logging_ready": {
              "const": true
            },
            "encryption_at_rest_ready": {
              "const": true
            },
            "retention_defaults_ready": {
              "const": true
            },
            "deletion_controls_ready": {
              "const": true
            },
            "demo_budget_gate_ready": {
              "const": true
            },
            "signing_release_trust_ready": {
              "const": true
            },
            "retention_period_required": {
              "const": true
            },
            "allowed_source_derived_classes": {
              "contains": {
                "const": "customer_opt_in_retained_source"
              }
            }
          }
        }
      }
    ],
    "required": [
      "protocol_version",
      "environment_profile",
      "allowed_source_derived_classes",
      "real_raw_snippet_acceptance",
      "real_targeted_file_acceptance",
      "access_control_ready",
      "access_logging_ready",
      "encryption_at_rest_ready",
      "retention_defaults_ready",
      "deletion_controls_ready",
      "demo_budget_gate_ready",
      "signing_release_trust_ready",
      "retention_period_required",
      "evidence_boundary"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "environment_profile": {
        "type": "string",
        "enum": [
          "synthetic_demo",
          "partner_pilot_candidate",
          "partner_pilot_real_snippet_ready"
        ]
      },
      "allowed_source_derived_classes": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "uniqueItems": true,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:retention-source-derived-class"
        }
      },
      "real_raw_snippet_acceptance": {
        "type": "boolean"
      },
      "real_targeted_file_acceptance": {
        "type": "boolean"
      },
      "access_control_ready": {
        "type": "boolean"
      },
      "access_logging_ready": {
        "type": "boolean"
      },
      "encryption_at_rest_ready": {
        "type": "boolean"
      },
      "retention_defaults_ready": {
        "type": "boolean"
      },
      "deletion_controls_ready": {
        "type": "boolean"
      },
      "demo_budget_gate_ready": {
        "type": "boolean"
      },
      "signing_release_trust_ready": {
        "type": "boolean"
      },
      "retention_period_required": {
        "type": "boolean"
      },
      "evidence_boundary": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "readiness_decision_ref": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "notes": {
        "type": "array",
        "maxItems": 100,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:environment-readiness-decision": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:environment-readiness-decision",
    "title": "Environment Readiness Decision",
    "type": "object",
    "additionalProperties": false,
    "allOf": [
      {
        "if": {
          "properties": {
            "decision": {
              "const": "approved"
            }
          },
          "required": [
            "decision"
          ]
        },
        "then": {
          "required": [
            "decision_signature"
          ]
        },
        "else": {
          "not": {
            "required": [
              "decision_signature"
            ]
          }
        }
      }
    ],
    "required": [
      "protocol_version",
      "readiness_decision_id",
      "previous_gate_version",
      "proposed_gate_version",
      "proposed_gate_approval_input_digest",
      "deployment_identity",
      "release_digest",
      "deployment_digest",
      "evidence_bindings",
      "approvers",
      "decided_at",
      "decision",
      "limitations",
      "canonicalization",
      "identity_hash_algorithm",
      "identity_input_excludes"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "readiness_decision_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "previous_gate_version": {
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740990
      },
      "proposed_gate_version": {
        "type": "integer",
        "minimum": 2,
        "maximum": 9007199254740991
      },
      "proposed_gate_approval_input_digest": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "deployment_identity": {
        "type": "string",
        "const": "pilot"
      },
      "release_digest": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "deployment_digest": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "evidence_bindings": {
        "type": "array",
        "minItems": 7,
        "maxItems": 7,
        "allOf": [
          {
            "contains": {
              "properties": {
                "control": {
                  "const": "access_control_ready"
                }
              },
              "required": [
                "control"
              ]
            },
            "minContains": 1,
            "maxContains": 1
          },
          {
            "contains": {
              "properties": {
                "control": {
                  "const": "access_logging_ready"
                }
              },
              "required": [
                "control"
              ]
            },
            "minContains": 1,
            "maxContains": 1
          },
          {
            "contains": {
              "properties": {
                "control": {
                  "const": "encryption_at_rest_ready"
                }
              },
              "required": [
                "control"
              ]
            },
            "minContains": 1,
            "maxContains": 1
          },
          {
            "contains": {
              "properties": {
                "control": {
                  "const": "retention_defaults_ready"
                }
              },
              "required": [
                "control"
              ]
            },
            "minContains": 1,
            "maxContains": 1
          },
          {
            "contains": {
              "properties": {
                "control": {
                  "const": "deletion_controls_ready"
                }
              },
              "required": [
                "control"
              ]
            },
            "minContains": 1,
            "maxContains": 1
          },
          {
            "contains": {
              "properties": {
                "control": {
                  "const": "demo_budget_gate_ready"
                }
              },
              "required": [
                "control"
              ]
            },
            "minContains": 1,
            "maxContains": 1
          },
          {
            "contains": {
              "properties": {
                "control": {
                  "const": "signing_release_trust_ready"
                }
              },
              "required": [
                "control"
              ]
            },
            "minContains": 1,
            "maxContains": 1
          }
        ],
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "control",
            "readiness_evidence_ref"
          ],
          "properties": {
            "control": {
              "type": "string",
              "enum": [
                "access_control_ready",
                "access_logging_ready",
                "encryption_at_rest_ready",
                "retention_defaults_ready",
                "deletion_controls_ready",
                "demo_budget_gate_ready",
                "signing_release_trust_ready"
              ]
            },
            "readiness_evidence_ref": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
            }
          }
        }
      },
      "approvers": {
        "type": "array",
        "minItems": 2,
        "maxItems": 2,
        "allOf": [
          {
            "contains": {
              "properties": {
                "approval_role": {
                  "const": "pilot_security_owner"
                }
              },
              "required": [
                "approval_role"
              ]
            },
            "minContains": 1,
            "maxContains": 1
          },
          {
            "contains": {
              "properties": {
                "approval_role": {
                  "const": "pilot_operations_owner"
                }
              },
              "required": [
                "approval_role"
              ]
            },
            "minContains": 1,
            "maxContains": 1
          }
        ],
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "approval_role",
            "actor"
          ],
          "properties": {
            "approval_role": {
              "type": "string",
              "enum": [
                "pilot_security_owner",
                "pilot_operations_owner"
              ]
            },
            "actor": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "actor_type",
                "actor_id"
              ],
              "properties": {
                "actor_type": {
                  "type": "string",
                  "const": "reviewer"
                },
                "actor_id": {
                  "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
                }
              }
            }
          }
        }
      },
      "decided_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "decision": {
        "type": "string",
        "enum": [
          "approved",
          "declined"
        ]
      },
      "limitations": {
        "type": "array",
        "minItems": 1,
        "maxItems": 100,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "decision_signature": {
        "$ref": "urn:codeattest:protocol:v0:signature-envelope"
      },
      "canonicalization": {
        "type": "string",
        "const": "rfc8785"
      },
      "identity_hash_algorithm": {
        "type": "string",
        "const": "sha256"
      },
      "identity_input_excludes": {
        "type": "array",
        "minItems": 2,
        "maxItems": 2,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "enum": [
            "readiness_decision_id",
            "decision_signature"
          ]
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:environment-readiness-evidence": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:environment-readiness-evidence",
    "title": "Environment Readiness Evidence",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "readiness_evidence_id",
      "control",
      "deployment_identity",
      "release_digest",
      "deployment_digest",
      "observed_at",
      "evidence_attachments",
      "result",
      "evidence_producer",
      "independent_reviewer",
      "reviewed_at",
      "limitations",
      "canonicalization",
      "identity_hash_algorithm",
      "identity_input_excludes"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "readiness_evidence_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "control": {
        "type": "string",
        "enum": [
          "access_control_ready",
          "access_logging_ready",
          "encryption_at_rest_ready",
          "retention_defaults_ready",
          "deletion_controls_ready",
          "demo_budget_gate_ready",
          "signing_release_trust_ready"
        ]
      },
      "deployment_identity": {
        "type": "string",
        "const": "pilot"
      },
      "release_digest": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "deployment_digest": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "observed_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "evidence_attachments": {
        "type": "array",
        "minItems": 1,
        "maxItems": 1000,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "check_id",
            "attachment_digest",
            "collected_at"
          ],
          "properties": {
            "check_id": {
              "type": "string",
              "pattern": "^[a-z0-9][a-z0-9._:-]{2,127}$"
            },
            "attachment_digest": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
            },
            "collected_at": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
            }
          }
        }
      },
      "result": {
        "type": "string",
        "enum": [
          "passed",
          "failed"
        ]
      },
      "evidence_producer": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/actor_reference"
      },
      "independent_reviewer": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "actor_type",
          "actor_id"
        ],
        "properties": {
          "actor_type": {
            "type": "string",
            "const": "reviewer"
          },
          "actor_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "reviewed_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "limitations": {
        "type": "array",
        "minItems": 1,
        "maxItems": 100,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "canonicalization": {
        "type": "string",
        "const": "rfc8785"
      },
      "identity_hash_algorithm": {
        "type": "string",
        "const": "sha256"
      },
      "identity_input_excludes": {
        "type": "array",
        "minItems": 1,
        "maxItems": 1,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "const": "readiness_evidence_id"
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:evidence-lifecycle-event": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:evidence-lifecycle-event",
    "title": "Evidence Lifecycle Event",
    "type": "object",
    "additionalProperties": false,
    "allOf": [
      {
        "if": {
          "properties": {
            "event_type": {
              "const": "evidence_deleted"
            }
          },
          "required": [
            "event_type"
          ]
        },
        "then": {
          "required": [
            "deletion_evidence_ref",
            "source_derived_class"
          ]
        }
      },
      {
        "if": {
          "properties": {
            "event_type": {
              "const": "evidence_accessed"
            }
          },
          "required": [
            "event_type"
          ]
        },
        "then": {
          "required": [
            "access_scope",
            "source_derived_class"
          ]
        }
      },
      {
        "if": {
          "properties": {
            "event_type": {
              "const": "retention_status_changed"
            }
          },
          "required": [
            "event_type"
          ]
        },
        "then": {
          "required": [
            "source_derived_class"
          ]
        }
      }
    ],
    "required": [
      "protocol_version",
      "event_id",
      "review_id",
      "sequence_number",
      "idempotency_key",
      "event_type",
      "actor",
      "event_timestamp",
      "artifact_refs"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "event_id": {
        "type": "string",
        "pattern": "^evidence_event:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "sequence_number": {
        "type": "integer",
        "minimum": 0
      },
      "idempotency_key": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "event_type": {
        "type": "string",
        "enum": [
          "evidence_accessed",
          "evidence_deleted",
          "retention_status_changed"
        ]
      },
      "actor": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/actor_reference"
      },
      "event_timestamp": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "artifact_refs": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
        }
      },
      "source_derived_class": {
        "$ref": "urn:codeattest:protocol:v0:retention-source-derived-class"
      },
      "purpose": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "access_scope": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "tenant_id",
          "review_scope"
        ],
        "properties": {
          "tenant_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "review_scope": {
            "type": "string",
            "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
          }
        }
      },
      "deletion_evidence_ref": {
        "type": "string",
        "pattern": "^deletion_evidence:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "retention_record_ref": {
        "type": "string",
        "pattern": "^retention_record:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "supersedes_event_id": {
        "type": "string",
        "pattern": "^evidence_event:[a-z0-9][a-z0-9_-]{2,63}$"
      }
    }
  },
  "urn:codeattest:protocol:v0:evidence-minimization-projection": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:evidence-minimization-projection",
    "title": "Evidence Minimization Projection",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "review_id",
      "entries"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "entries": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "allOf": [
            {
              "if": {
                "properties": {
                  "minimization_category": {
                    "const": "deleted_transient"
                  }
                },
                "required": [
                  "minimization_category"
                ]
              },
              "then": {
                "required": [
                  "deletion_evidence_ref"
                ],
                "properties": {
                  "source_derived_class": {
                    "const": "transient_source_derived"
                  }
                }
              }
            },
            {
              "if": {
                "properties": {
                  "minimization_category": {
                    "const": "retained_customer_opt_in_snippet"
                  }
                },
                "required": [
                  "minimization_category"
                ]
              },
              "then": {
                "properties": {
                  "source_derived_class": {
                    "const": "customer_opt_in_retained_source"
                  }
                }
              }
            },
            {
              "if": {
                "properties": {
                  "minimization_category": {
                    "const": "never_collected"
                  }
                },
                "required": [
                  "minimization_category"
                ]
              },
              "then": {
                "properties": {
                  "source_derived_class": {
                    "const": "never_collected"
                  }
                }
              }
            },
            {
              "if": {
                "properties": {
                  "minimization_category": {
                    "enum": [
                      "retained_finding",
                      "retained_metadata",
                      "retained_attestation"
                    ]
                  }
                },
                "required": [
                  "minimization_category"
                ]
              },
              "then": {
                "properties": {
                  "source_derived_class": {
                    "const": "retained_review_artifact"
                  }
                }
              }
            }
          ],
          "required": [
            "artifact_ref",
            "minimization_category",
            "source_derived_class"
          ],
          "properties": {
            "artifact_ref": {
              "type": "string",
              "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "minimization_category": {
              "type": "string",
              "enum": [
                "retained_finding",
                "retained_metadata",
                "retained_attestation",
                "retained_customer_opt_in_snippet",
                "deleted_transient",
                "never_collected"
              ]
            },
            "source_derived_class": {
              "$ref": "urn:codeattest:protocol:v0:retention-source-derived-class"
            },
            "deletion_evidence_ref": {
              "type": "string",
              "pattern": "^deletion_evidence:[a-z0-9][a-z0-9_-]{2,63}$"
            }
          }
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:false-positive-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:false-positive-record",
    "title": "False Positive Record",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "review_id",
      "false_positive_record_id",
      "review_finding_draft_ref",
      "classification_record_ref",
      "review_finding_draft_evidence_refs",
      "evidence_basis",
      "rationale",
      "limitations",
      "recorded_at",
      "actor",
      "source_reference_state",
      "source_derived_class",
      "visibility"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "false_positive_record_id": {
        "type": "string",
        "pattern": "^false_positive:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "review_finding_draft_ref": {
        "type": "string",
        "pattern": "^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "classification_record_ref": {
        "type": "string",
        "pattern": "^classification_record:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "candidate_finding_refs": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "pattern": "^candidate_finding:[a-z0-9][a-z0-9_-]{2,63}$"
        }
      },
      "review_finding_draft_evidence_refs": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "artifact_ref",
            "availability_state",
            "available_for_review",
            "display_state",
            "source_derived_class"
          ],
          "properties": {
            "artifact_ref": {
              "type": "string",
              "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "availability_state": {
              "type": "string",
              "enum": [
                "retained_review_artifact",
                "deleted_under_policy",
                "never_collected",
                "not_submitted_by_policy",
                "unresolved_reference"
              ]
            },
            "available_for_review": {
              "type": "boolean"
            },
            "display_state": {
              "type": "string",
              "enum": [
                "available_reference",
                "deleted",
                "not_collected",
                "not_submitted",
                "unresolved_reference"
              ]
            },
            "deletion_evidence_ref": {
              "type": "string",
              "pattern": "^deletion_evidence:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "source_derived_class": {
              "$ref": "urn:codeattest:protocol:v0:retention-source-derived-class"
            }
          }
        }
      },
      "evidence_basis": {
        "type": "array",
        "minItems": 1,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "enum": [
            "scanner_output",
            "metadata_only",
            "finding_context_snippet",
            "extended_approved_source_context",
            "retained_review_artifact",
            "deleted_under_policy_reference",
            "not_submitted_by_policy_reference",
            "never_collected_reference",
            "unresolved_reference"
          ]
        }
      },
      "rationale": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "limitations": {
        "type": "array",
        "maxItems": 100,
        "minItems": 1,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "recorded_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "actor": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "actor_type",
          "actor_id"
        ],
        "properties": {
          "actor_type": {
            "type": "string",
            "const": "reviewer"
          },
          "actor_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "source_reference_state": {
        "type": "string",
        "enum": [
          "retained_review_artifact",
          "deleted_under_policy",
          "never_collected",
          "not_submitted_by_policy",
          "unresolved_reference"
        ]
      },
      "source_derived_class": {
        "type": "string",
        "const": "retained_review_artifact"
      },
      "visibility": {
        "type": "string",
        "enum": [
          "customer_facing",
          "internal_only"
        ]
      },
      "field_export_policy": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "rationale",
          "limitations",
          "evidence_basis",
          "candidate_finding_refs",
          "evidence_consumer_export"
        ],
        "properties": {
          "rationale": {
            "type": "string",
            "enum": [
              "include",
              "exclude"
            ]
          },
          "limitations": {
            "type": "string",
            "enum": [
              "include",
              "exclude"
            ]
          },
          "evidence_basis": {
            "type": "string",
            "enum": [
              "include",
              "exclude"
            ]
          },
          "candidate_finding_refs": {
            "type": "string",
            "enum": [
              "include",
              "exclude"
            ]
          },
          "evidence_consumer_export": {
            "type": "string",
            "enum": [
              "include",
              "exclude"
            ]
          }
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:finding-classification-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:finding-classification-record",
    "title": "Finding Classification Record",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "review_id",
      "classification_record_id",
      "review_finding_draft_ref",
      "review_finding_draft_evidence_refs",
      "classification",
      "classified_at",
      "actor",
      "evidence_basis",
      "confirmation_criteria",
      "threshold_gaps",
      "limitations",
      "rationale",
      "source_reference_state",
      "source_derived_class",
      "visibility"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "classification_record_id": {
        "type": "string",
        "pattern": "^classification_record:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "review_finding_draft_ref": {
        "type": "string",
        "pattern": "^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "review_finding_draft_evidence_refs": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "artifact_ref",
            "availability_state",
            "available_for_review",
            "display_state",
            "source_derived_class"
          ],
          "properties": {
            "artifact_ref": {
              "type": "string",
              "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "availability_state": {
              "type": "string",
              "enum": [
                "retained_review_artifact",
                "deleted_under_policy",
                "never_collected",
                "not_submitted_by_policy",
                "unresolved_reference"
              ]
            },
            "available_for_review": {
              "type": "boolean"
            },
            "display_state": {
              "type": "string",
              "enum": [
                "available_reference",
                "deleted",
                "not_collected",
                "not_submitted",
                "unresolved_reference"
              ]
            },
            "deletion_evidence_ref": {
              "type": "string",
              "pattern": "^deletion_evidence:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "source_derived_class": {
              "$ref": "urn:codeattest:protocol:v0:retention-source-derived-class"
            }
          }
        }
      },
      "classification": {
        "type": "string",
        "enum": [
          "likely",
          "confirmed",
          "inconclusive",
          "requires_customer_side_validation"
        ]
      },
      "classified_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "actor": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "actor_type",
          "actor_id"
        ],
        "properties": {
          "actor_type": {
            "type": "string",
            "const": "reviewer"
          },
          "actor_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "evidence_basis": {
        "type": "array",
        "minItems": 1,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "enum": [
            "scanner_output",
            "metadata_only",
            "finding_context_snippet",
            "extended_approved_source_context",
            "retained_review_artifact",
            "deleted_under_policy_reference",
            "not_submitted_by_policy_reference",
            "never_collected_reference",
            "unresolved_reference"
          ]
        }
      },
      "confirmation_criteria": {
        "type": "array",
        "maxItems": 100,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "defensible_confirmation_criteria": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "threshold_gaps": {
        "type": "array",
        "maxItems": 100,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "limitations": {
        "type": "array",
        "maxItems": 100,
        "minItems": 1,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "rationale": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "validation_path_summary": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "validation_path_ref": {
        "type": "string",
        "pattern": "^validation_path:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "supersedes_classification_record_ref": {
        "type": "string",
        "pattern": "^classification_record:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "supersedes_event_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "source_reference_state": {
        "type": "string",
        "enum": [
          "retained_review_artifact",
          "deleted_under_policy",
          "never_collected",
          "not_submitted_by_policy",
          "unresolved_reference"
        ]
      },
      "source_derived_class": {
        "type": "string",
        "const": "retained_review_artifact"
      },
      "visibility": {
        "type": "string",
        "enum": [
          "customer_facing",
          "internal_only"
        ]
      }
    },
    "allOf": [
      {
        "if": {
          "required": [
            "classification"
          ],
          "properties": {
            "classification": {
              "const": "confirmed"
            }
          }
        },
        "then": {
          "properties": {
            "confirmation_criteria": {
              "type": "array",
              "maxItems": 10000,
              "minItems": 1
            }
          }
        }
      }
    ]
  },
  "urn:codeattest:protocol:v0:finding-remediation-guidance": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:finding-remediation-guidance",
    "title": "Finding Remediation Guidance",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "review_id",
      "remediation_guidance_id",
      "classification_record_ref",
      "review_finding_draft_ref",
      "review_finding_draft_evidence_refs",
      "guidance_status",
      "authored_at",
      "actor",
      "classification_context",
      "limitations",
      "evidence_refs",
      "source_reference_state",
      "source_derived_class",
      "visibility"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "remediation_guidance_id": {
        "type": "string",
        "pattern": "^remediation_guidance:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "classification_record_ref": {
        "type": "string",
        "pattern": "^classification_record:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "review_finding_draft_ref": {
        "type": "string",
        "pattern": "^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "review_finding_draft_evidence_refs": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "artifact_ref",
            "availability_state",
            "available_for_review",
            "display_state",
            "source_derived_class"
          ],
          "properties": {
            "artifact_ref": {
              "type": "string",
              "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "availability_state": {
              "type": "string",
              "enum": [
                "retained_review_artifact",
                "deleted_under_policy",
                "never_collected",
                "not_submitted_by_policy",
                "unresolved_reference"
              ]
            },
            "available_for_review": {
              "type": "boolean"
            },
            "display_state": {
              "type": "string",
              "enum": [
                "available_reference",
                "deleted",
                "not_collected",
                "not_submitted",
                "unresolved_reference"
              ]
            },
            "deletion_evidence_ref": {
              "type": "string",
              "pattern": "^deletion_evidence:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "source_derived_class": {
              "$ref": "urn:codeattest:protocol:v0:retention-source-derived-class"
            }
          }
        }
      },
      "guidance_status": {
        "type": "string",
        "enum": [
          "actionable_guidance_provided",
          "limited_guidance_requires_validation",
          "guidance_unavailable_from_submitted_evidence"
        ]
      },
      "authored_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "actor": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "actor_type",
          "actor_id"
        ],
        "properties": {
          "actor_type": {
            "type": "string",
            "const": "reviewer"
          },
          "actor_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "classification_context": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "classification",
          "confirmation_criteria",
          "evidence_basis",
          "source_reference_state"
        ],
        "properties": {
          "classification": {
            "type": "string",
            "enum": [
              "likely",
              "confirmed",
              "inconclusive",
              "requires_customer_side_validation"
            ]
          },
          "confirmation_criteria": {
            "type": "array",
            "maxItems": 100,
            "items": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
            }
          },
          "evidence_basis": {
            "type": "array",
            "minItems": 1,
            "uniqueItems": true,
            "items": {
              "type": "string",
              "enum": [
                "scanner_output",
                "metadata_only",
                "finding_context_snippet",
                "extended_approved_source_context",
                "retained_review_artifact",
                "deleted_under_policy_reference",
                "not_submitted_by_policy_reference",
                "never_collected_reference",
                "unresolved_reference"
              ]
            }
          },
          "source_reference_state": {
            "type": "string",
            "enum": [
              "retained_review_artifact",
              "deleted_under_policy",
              "never_collected",
              "not_submitted_by_policy",
              "unresolved_reference"
            ]
          }
        }
      },
      "exploitability_rationale": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "suggested_remediation": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "validation_steps": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "insufficient_evidence_reason": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "next_step_summary": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "validation_path_summary": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "validation_path_ref": {
        "type": "string",
        "pattern": "^validation_path:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "limitations": {
        "type": "array",
        "maxItems": 100,
        "minItems": 1,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "evidence_refs": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
        }
      },
      "source_reference_state": {
        "type": "string",
        "enum": [
          "retained_review_artifact",
          "deleted_under_policy",
          "never_collected",
          "not_submitted_by_policy",
          "unresolved_reference"
        ]
      },
      "source_derived_class": {
        "type": "string",
        "const": "retained_review_artifact"
      },
      "visibility": {
        "type": "string",
        "enum": [
          "customer_facing",
          "internal_only"
        ]
      }
    }
  },
  "urn:codeattest:protocol:v0:finding-validation-path": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:finding-validation-path",
    "title": "Finding Validation Path",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "review_id",
      "validation_path_id",
      "classification_record_ref",
      "review_finding_draft_ref",
      "review_finding_draft_evidence_refs",
      "path_type",
      "required_evidence",
      "steps",
      "expected_result",
      "limitations",
      "included_pass_verifiability",
      "authored_at",
      "actor",
      "source_reference_state",
      "source_derived_class",
      "visibility"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "validation_path_id": {
        "type": "string",
        "pattern": "^validation_path:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "classification_record_ref": {
        "type": "string",
        "pattern": "^classification_record:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "review_finding_draft_ref": {
        "type": "string",
        "pattern": "^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "review_finding_draft_evidence_refs": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "artifact_ref",
            "availability_state",
            "available_for_review",
            "display_state",
            "source_derived_class"
          ],
          "properties": {
            "artifact_ref": {
              "type": "string",
              "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "availability_state": {
              "type": "string",
              "enum": [
                "retained_review_artifact",
                "deleted_under_policy",
                "never_collected",
                "not_submitted_by_policy",
                "unresolved_reference"
              ]
            },
            "available_for_review": {
              "type": "boolean"
            },
            "display_state": {
              "type": "string",
              "enum": [
                "available_reference",
                "deleted",
                "not_collected",
                "not_submitted",
                "unresolved_reference"
              ]
            },
            "deletion_evidence_ref": {
              "type": "string",
              "pattern": "^deletion_evidence:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "source_derived_class": {
              "$ref": "urn:codeattest:protocol:v0:retention-source-derived-class"
            }
          }
        }
      },
      "remediation_guidance_ref": {
        "type": "string",
        "pattern": "^remediation_guidance:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "path_type": {
        "type": "string",
        "enum": [
          "remote_dynamic_testing",
          "customer_run_script",
          "manual_steps"
        ]
      },
      "required_evidence": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "steps": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "expected_result": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "limitations": {
        "type": "array",
        "maxItems": 100,
        "minItems": 1,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "included_pass_verifiability": {
        "type": "string",
        "enum": [
          "verifiable_within_included_pass",
          "customer_provided_evidence_required",
          "additional_agreement_required"
        ]
      },
      "reviewer_validation_script_refs": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "pattern": "^validation_script:[a-z0-9][a-z0-9_-]{2,63}$"
        }
      },
      "output_attachment_instructions": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "target": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "authorization_assumption": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "method": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "safety_constraints": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "evidence_artifacts_to_collect": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
        }
      },
      "authored_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "actor": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "actor_type",
          "actor_id"
        ],
        "properties": {
          "actor_type": {
            "type": "string",
            "const": "reviewer"
          },
          "actor_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "source_reference_state": {
        "type": "string",
        "enum": [
          "retained_review_artifact",
          "deleted_under_policy",
          "never_collected",
          "not_submitted_by_policy",
          "unresolved_reference"
        ]
      },
      "source_derived_class": {
        "type": "string",
        "const": "retained_review_artifact"
      },
      "visibility": {
        "type": "string",
        "enum": [
          "customer_facing",
          "internal_only"
        ]
      }
    }
  },
  "urn:codeattest:protocol:v0:identity-signing-input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:identity-signing-input",
    "title": "Identity Signing Input",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "signing_input_type",
      "algorithm_profile",
      "signed_identity_type",
      "signed_identity",
      "canonicalization",
      "identity_input_path"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "signing_input_type": {
        "type": "string",
        "enum": [
          "outbound_manifest_identity",
          "bundle_manifest_identity",
          "vendor_receipt_identity",
          "static_bundle_manifest_identity",
          "attestation_package_finalization_identity",
          "disclosure_policy_identity",
          "review_event_identity",
          "security_review_attestation_identity",
          "signing_key_directory_identity",
          "evidence_bundle_identity",
          "runner_release_identity",
          "environment_readiness_decision_identity"
        ]
      },
      "algorithm_profile": {
        "type": "string",
        "const": "ml_dsa_65"
      },
      "signed_identity_type": {
        "type": "string",
        "enum": [
          "outbound_manifest",
          "evidence_bundle",
          "vendor_receipt",
          "static_bundle_manifest",
          "attestation_package_finalization",
          "disclosure_policy",
          "review_event",
          "security_review_attestation",
          "signing_key_directory",
          "runner_release",
          "environment_readiness_decision"
        ]
      },
      "signed_identity": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "canonicalization": {
        "type": "string",
        "const": "rfc8785"
      },
      "identity_input_path": {
        "type": "string",
        "pattern": "^v0/valid/[a-z0-9][a-z0-9._-]*\\.json$"
      }
    }
  },
  "urn:codeattest:protocol:v0:local-runner-attempt": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:local-runner-attempt",
    "title": "Local Runner Attempt or Status Record",
    "type": "object",
    "additionalProperties": false,
    "allOf": [
      {
        "if": {
          "properties": {
            "bundle_state": {
              "const": "ready_not_submitted"
            }
          },
          "required": [
            "bundle_state"
          ]
        },
        "then": {
          "properties": {
            "identities": {
              "required": [
                "evidence_bundle_id",
                "bundle_instance_id",
                "submission_attempt_id"
              ]
            }
          }
        },
        "else": {
          "properties": {
            "identities": {
              "not": {
                "anyOf": [
                  {
                    "required": [
                      "evidence_bundle_id"
                    ]
                  },
                  {
                    "required": [
                      "bundle_instance_id"
                    ]
                  },
                  {
                    "required": [
                      "submission_attempt_id"
                    ]
                  }
                ]
              }
            }
          }
        }
      },
      {
        "if": {
          "anyOf": [
            {
              "properties": {
                "approval_state": {
                  "const": "approved"
                }
              },
              "required": [
                "approval_state"
              ]
            },
            {
              "properties": {
                "review_state": {
                  "const": "approved_no_signed_bundle"
                }
              },
              "required": [
                "review_state"
              ]
            }
          ]
        },
        "then": {
          "required": [
            "approval_metadata"
          ],
          "properties": {
            "identities": {
              "required": [
                "manifest_id",
                "approval_id"
              ]
            },
            "approval_metadata": {
              "properties": {
                "decision": {
                  "const": "approved"
                }
              }
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "runner_trust": {
              "properties": {
                "trust_label": {
                  "const": "trusted_release"
                }
              },
              "required": [
                "trust_label"
              ]
            }
          },
          "required": [
            "runner_trust"
          ]
        },
        "then": {
          "properties": {
            "runner_trust": {
              "required": [
                "release_verification_artifact"
              ],
              "properties": {
                "release_signature_status": {
                  "const": "verified_release_signature"
                }
              }
            }
          }
        }
      },
      {
        "if": {
          "not": {
            "properties": {
              "remote_state": {
                "const": "not_submitted"
              }
            },
            "required": [
              "remote_state"
            ]
          }
        },
        "then": {
          "properties": {
            "stage": {
              "const": "submit"
            }
          },
          "required": [
            "stage"
          ]
        }
      },
      {
        "if": {
          "not": {
            "properties": {
              "remote_state": {
                "const": "received_with_receipt"
              }
            },
            "required": [
              "remote_state"
            ]
          }
        },
        "then": {
          "properties": {
            "identities": {
              "not": {
                "required": [
                  "vendor_receipt_id"
                ]
              }
            }
          }
        }
      }
    ],
    "required": [
      "protocol_version",
      "attempt_id",
      "stage",
      "outcome",
      "review_state",
      "approval_state",
      "bundle_state",
      "remote_state",
      "occurred_at",
      "runner",
      "runner_trust",
      "identities",
      "diagnostics",
      "next_actions"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "attempt_id": {
        "type": "string",
        "pattern": "^runner_attempt:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "stage": {
        "type": "string",
        "enum": [
          "scope_init",
          "scan_run",
          "disclosure_configure",
          "manifest_preview",
          "approval",
          "bundle_packaging",
          "bundle_signing",
          "bundle_prepare",
          "status_inspect",
          "runner_trust",
          "submit"
        ]
      },
      "outcome": {
        "type": "string",
        "enum": [
          "succeeded",
          "failed",
          "declined",
          "blocked"
        ]
      },
      "review_state": {
        "type": "string",
        "enum": [
          "unapproved_not_submitted",
          "approved_no_signed_bundle",
          "signed_bundle_not_submitted"
        ]
      },
      "approval_state": {
        "type": "string",
        "enum": [
          "not_requested",
          "approved",
          "declined",
          "not_applicable"
        ]
      },
      "bundle_state": {
        "type": "string",
        "enum": [
          "not_created",
          "failed_before_ready",
          "ready_not_submitted"
        ]
      },
      "remote_state": {
        "type": "string",
        "enum": [
          "not_submitted",
          "submit_attempted",
          "received_with_receipt",
          "rejected_no_receipt",
          "quarantined_no_receipt"
        ]
      },
      "occurred_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "runner": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "name",
          "version"
        ],
        "properties": {
          "name": {
            "type": "string",
            "const": "codeattest-local-runner"
          },
          "version": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "runner_trust": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "runner_name",
          "runner_version",
          "build_identifier",
          "release_identifier",
          "release_signature_status",
          "bundle_signing_mode",
          "trust_label",
          "evidence_boundary",
          "limitations"
        ],
        "properties": {
          "runner_name": {
            "type": "string",
            "const": "codeattest-local-runner"
          },
          "runner_version": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "build_identifier": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "release_identifier": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "release_signature_status": {
            "type": "string",
            "enum": [
              "unsigned_local_build",
              "untrusted_local_build",
              "verified_release_signature"
            ]
          },
          "bundle_signing_mode": {
            "type": "string",
            "enum": [
              "managed_key",
              "enrolled_runner_key"
            ]
          },
          "trust_label": {
            "type": "string",
            "enum": [
              "demo_only_unsigned",
              "untrusted_local_dev",
              "trusted_release"
            ]
          },
          "evidence_boundary": {
            "type": "string",
            "const": "synthetic-demo-only"
          },
          "release_verification_artifact": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "limitations": {
            "type": "array",
            "maxItems": 100,
            "minItems": 1,
            "items": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
            }
          }
        }
      },
      "identities": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "selected_commit": {
            "type": "string",
            "pattern": "^[a-f0-9]{40}$"
          },
          "repository_identity": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
          },
          "manifest_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
          },
          "approval_id": {
            "type": "string",
            "pattern": "^approval:[a-z0-9][a-z0-9_-]{2,63}$"
          },
          "evidence_bundle_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
          },
          "bundle_instance_id": {
            "type": "string",
            "pattern": "^bundle_instance:[a-z0-9][a-z0-9_-]{2,63}$"
          },
          "submission_attempt_id": {
            "type": "string",
            "pattern": "^submission_attempt:[a-z0-9][a-z0-9_-]{2,63}$"
          },
          "vendor_receipt_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
          },
          "submission_outcome_id": {
            "type": "string",
            "pattern": "^submission_outcome:[a-z0-9][a-z0-9_-]{2,63}$"
          }
        }
      },
      "approval_metadata": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "decision",
          "decided_at"
        ],
        "properties": {
          "decision": {
            "type": "string",
            "enum": [
              "approved",
              "declined"
            ]
          },
          "decided_at": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
          },
          "approving_actor": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/actor_reference"
          }
        }
      },
      "diagnostics": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "message",
          "retryable",
          "sensitive_detail_omitted",
          "raw_snippets_printed",
          "support_summary"
        ],
        "properties": {
          "stage_failed": {
            "type": "string",
            "enum": [
              "scope_init",
              "scan_run",
              "disclosure_configure",
              "manifest_preview",
              "approval",
              "bundle_packaging",
              "bundle_signing",
              "bundle_prepare",
              "status_inspect",
              "runner_trust",
              "submit"
            ]
          },
          "failure_code": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9_]{2,63}$"
          },
          "message": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "retryable": {
            "type": "boolean"
          },
          "sensitive_detail_omitted": {
            "type": "boolean"
          },
          "raw_snippets_printed": {
            "type": "boolean",
            "const": false
          },
          "support_summary": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "local_artifact_paths": {
            "type": "array",
            "maxItems": 10000,
            "items": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            }
          }
        }
      },
      "next_actions": {
        "type": "array",
        "maxItems": 100,
        "minItems": 1,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:log-checkpoint": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:log-checkpoint",
    "title": "Log Checkpoint",
    "type": "object",
    "additionalProperties": false,
    "allOf": [
      {
        "if": {
          "properties": {
            "tree_size": {
              "const": 0
            }
          },
          "required": [
            "tree_size"
          ]
        },
        "then": {
          "properties": {
            "merkle_root": {
              "const": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "merkle_root": {
              "const": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            }
          },
          "required": [
            "merkle_root"
          ]
        },
        "then": {
          "properties": {
            "tree_size": {
              "const": 0
            }
          }
        }
      }
    ],
    "required": [
      "protocol_version",
      "checkpoint_id",
      "deployment_identity",
      "checkpoint_timestamp",
      "merkle_root",
      "tree_size",
      "canonicalization",
      "identity_hash_algorithm",
      "identity_input_excludes"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "checkpoint_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "deployment_identity": {
        "type": "string",
        "enum": [
          "demo",
          "pilot"
        ]
      },
      "checkpoint_timestamp": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "merkle_root": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/sha256_hex"
      },
      "tree_size": {
        "type": "integer",
        "minimum": 0
      },
      "canonicalization": {
        "type": "string",
        "const": "rfc8785"
      },
      "identity_hash_algorithm": {
        "type": "string",
        "const": "sha256"
      },
      "identity_input_excludes": {
        "type": "array",
        "minItems": 1,
        "maxItems": 1,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "const": "checkpoint_id"
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:outbound-manifest": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:outbound-manifest",
    "title": "Outbound Manifest",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "manifest_id",
      "generated_at",
      "review_scope_ref",
      "disclosure_policy_ref",
      "selected_scope_summary",
      "runner",
      "coverage_mode",
      "disclosure_policy_summary",
      "evidence_categories",
      "artifact_references",
      "package_preview_state",
      "approval",
      "warnings",
      "limitations"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "manifest_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "generated_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "review_scope_ref": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "disclosure_policy_ref": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "scanner_finding_set_ref": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "selected_scope_summary": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "selected_application",
          "selected_commit",
          "repository_identity",
          "dependency_manifest_total_count",
          "dependency_manifest_detected_count"
        ],
        "properties": {
          "selected_application": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "application_id",
              "display_name"
            ],
            "properties": {
              "application_id": {
                "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
              },
              "display_name": {
                "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
              }
            }
          },
          "selected_commit": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "commit_sha",
              "source_control_system"
            ],
            "properties": {
              "commit_sha": {
                "type": "string",
                "pattern": "^[a-f0-9]{40}$"
              },
              "source_control_system": {
                "type": "string",
                "enum": [
                  "git"
                ]
              }
            }
          },
          "repository_identity": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
          },
          "dependency_manifest_total_count": {
            "type": "integer",
            "minimum": 0
          },
          "dependency_manifest_detected_count": {
            "type": "integer",
            "minimum": 0
          }
        }
      },
      "runner": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "name",
          "version"
        ],
        "properties": {
          "name": {
            "type": "string",
            "const": "codeattest-local-runner"
          },
          "version": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "coverage_mode": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/coverage_mode"
      },
      "disclosure_policy_summary": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "disclosure_policy_ref",
          "coverage_mode",
          "redaction_profile",
          "redaction_configuration_version",
          "retention_period"
        ],
        "properties": {
          "disclosure_policy_ref": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
          },
          "coverage_mode": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/coverage_mode"
          },
          "redaction_profile": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "redaction_configuration_version": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "retention_period": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "evidence_categories": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 7,
        "uniqueItems": true,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "category",
            "included",
            "inclusion_state",
            "count",
            "reference",
            "source_derived_class",
            "source_code_disclosure",
            "redaction_state",
            "redaction_configuration_version",
            "retention_handling",
            "limitation",
            "details"
          ],
          "properties": {
            "category": {
              "type": "string",
              "enum": [
                "metadata",
                "dependencies",
                "scanner_findings",
                "raw_snippets",
                "targeted_files",
                "derived_artifacts",
                "never_collected_items"
              ]
            },
            "included": {
              "type": "boolean"
            },
            "inclusion_state": {
              "type": "string",
              "enum": [
                "included",
                "excluded_by_policy",
                "never_collected"
              ]
            },
            "count": {
              "type": "integer",
              "minimum": 0
            },
            "reference": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "source_derived_class": {
              "$ref": "urn:codeattest:protocol:v0:retention-source-derived-class"
            },
            "source_code_disclosure": {
              "type": "boolean"
            },
            "redaction_state": {
              "type": "string",
              "enum": [
                "not_applicable",
                "redaction_not_configured",
                "redaction_configured"
              ]
            },
            "redaction_configuration_version": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "retention_handling": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "limitation": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "details": {
              "type": "array",
              "maxItems": 100,
              "minItems": 1,
              "items": {
                "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
              }
            },
            "snippet_controls": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "max_snippet_chars",
                "context_lines",
                "redaction_profile",
                "redaction_configuration_version",
                "retention_class",
                "selected_files_or_areas"
              ],
              "properties": {
                "max_snippet_chars": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 2000
                },
                "context_lines": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 10
                },
                "redaction_profile": {
                  "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
                },
                "redaction_configuration_version": {
                  "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
                },
                "retention_class": {
                  "$ref": "urn:codeattest:protocol:v0:retention-source-derived-class"
                },
                "selected_files_or_areas": {
                  "type": "array",
                  "maxItems": 10000,
                  "items": {
                    "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
                  }
                }
              }
            }
          }
        }
      },
      "artifact_references": {
        "type": "array",
        "maxItems": 10000,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:artifact-reference"
        }
      },
      "package_preview_state": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "state",
          "send_ready",
          "local_only"
        ],
        "properties": {
          "state": {
            "type": "string",
            "enum": [
              "preview_generated"
            ]
          },
          "send_ready": {
            "type": "boolean",
            "const": false
          },
          "local_only": {
            "type": "boolean",
            "const": true
          }
        }
      },
      "approval": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "approval_state"
        ],
        "properties": {
          "approval_state": {
            "type": "string",
            "enum": [
              "not_requested"
            ]
          }
        }
      },
      "warnings": {
        "type": "array",
        "maxItems": 100,
        "minItems": 1,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "limitations": {
        "type": "array",
        "maxItems": 100,
        "minItems": 1,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:pilot-feedback-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:pilot-feedback-record",
    "title": "Pilot Feedback Record",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "pilot_feedback_record_id",
      "record_version",
      "review_id",
      "recorded_at",
      "recorded_by",
      "feedback_source",
      "usefulness_rating",
      "repeat_intent",
      "pay_intent",
      "mapping_feedback",
      "objection_codes",
      "caveats",
      "content_free",
      "pii_free",
      "visibility",
      "source_derived_class"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "pilot_feedback_record_id": {
        "type": "string",
        "pattern": "^pilot_feedback:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "record_version": {
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "recorded_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "recorded_by": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "actor_type",
          "actor_id"
        ],
        "properties": {
          "actor_type": {
            "type": "string",
            "enum": [
              "reviewer",
              "vendor_service"
            ]
          },
          "actor_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "feedback_source": {
        "type": "string",
        "enum": [
          "customer_admin_aggregate",
          "evidence_consumer_aggregate",
          "reviewer_observation"
        ]
      },
      "usefulness_rating": {
        "type": "integer",
        "minimum": 1,
        "maximum": 5
      },
      "repeat_intent": {
        "type": "string",
        "enum": [
          "yes",
          "no",
          "unsure",
          "not_asked"
        ]
      },
      "pay_intent": {
        "type": "string",
        "enum": [
          "yes",
          "no",
          "unsure",
          "not_asked"
        ]
      },
      "mapping_feedback": {
        "type": "array",
        "maxItems": 4,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "mapping_profile",
            "usefulness_rating"
          ],
          "properties": {
            "mapping_profile": {
              "type": "string",
              "enum": [
                "soc_2_supporting_evidence",
                "generic_technology_risk",
                "customer_security_review",
                "not_used"
              ]
            },
            "usefulness_rating": {
              "type": "integer",
              "minimum": 1,
              "maximum": 5
            }
          }
        }
      },
      "objection_codes": {
        "type": "array",
        "uniqueItems": true,
        "items": {
          "type": "string",
          "enum": [
            "scope_too_narrow",
            "evidence_too_limited",
            "mapping_not_applicable",
            "signature_profile_demo_only",
            "offline_package_usability",
            "pricing_uncertain",
            "turnaround",
            "other_content_free"
          ]
        }
      },
      "caveats": {
        "type": "array",
        "maxItems": 100,
        "minItems": 1,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "content_free": {
        "type": "boolean",
        "const": true
      },
      "pii_free": {
        "type": "boolean",
        "const": true
      },
      "visibility": {
        "type": "string",
        "const": "internal_only"
      },
      "source_derived_class": {
        "type": "string",
        "const": "retained_review_artifact"
      }
    }
  },
  "urn:codeattest:protocol:v0:pilot-metric-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:pilot-metric-record",
    "title": "Pilot Metric Record",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "pilot_metric_record_id",
      "record_version",
      "review_id",
      "recorded_at",
      "recorded_by",
      "measurement_window",
      "metrics",
      "caveats",
      "content_free",
      "pii_free",
      "visibility",
      "source_derived_class"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "pilot_metric_record_id": {
        "type": "string",
        "pattern": "^pilot_metric:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "record_version": {
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "recorded_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "recorded_by": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "actor_type",
          "actor_id"
        ],
        "properties": {
          "actor_type": {
            "type": "string",
            "enum": [
              "reviewer",
              "vendor_service"
            ]
          },
          "actor_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "measurement_window": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "start_timestamp",
          "end_timestamp"
        ],
        "properties": {
          "start_timestamp": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
          },
          "end_timestamp": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
          }
        }
      },
      "metrics": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "candidate_finding_count",
          "classified_finding_count",
          "actionable_classification_count",
          "review_hours",
          "validation_hours",
          "turnaround_hours",
          "disclosure_mode",
          "submission_rejection_count",
          "repeat_intent_signal",
          "pay_intent_signal"
        ],
        "properties": {
          "candidate_finding_count": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "classified_finding_count": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "actionable_classification_count": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "review_hours": {
            "type": "number",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "validation_hours": {
            "type": "number",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "turnaround_hours": {
            "type": "number",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "disclosure_mode": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/coverage_mode"
          },
          "submission_rejection_count": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "repeat_intent_signal": {
            "type": "string",
            "enum": [
              "yes",
              "no",
              "unsure",
              "not_asked"
            ]
          },
          "pay_intent_signal": {
            "type": "string",
            "enum": [
              "yes",
              "no",
              "unsure",
              "not_asked"
            ]
          }
        }
      },
      "caveats": {
        "type": "array",
        "maxItems": 100,
        "minItems": 1,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "content_free": {
        "type": "boolean",
        "const": true
      },
      "pii_free": {
        "type": "boolean",
        "const": true
      },
      "visibility": {
        "type": "string",
        "const": "internal_only"
      },
      "source_derived_class": {
        "type": "string",
        "const": "retained_review_artifact"
      }
    }
  },
  "urn:codeattest:protocol:v0:retention-opt-in-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:retention-opt-in-record",
    "title": "Retention Opt-In Record",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "retention_record_id",
      "source_derived_class",
      "customer_approval_ref",
      "retention_period",
      "retained_artifact_refs"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "retention_record_id": {
        "type": "string",
        "pattern": "^retention_record:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "source_derived_class": {
        "type": "string",
        "const": "customer_opt_in_retained_source"
      },
      "customer_approval_ref": {
        "type": "string",
        "pattern": "^approval:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "retention_period": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "start_timestamp",
          "end_timestamp"
        ],
        "properties": {
          "start_timestamp": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
          },
          "end_timestamp": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
          }
        }
      },
      "retained_artifact_refs": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
        }
      },
      "retention_status_event_ids": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "pattern": "^evidence_event:[a-z0-9][a-z0-9_-]{2,63}$"
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:retention-source-derived-class": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:retention-source-derived-class",
    "title": "Retention and Source-Derived Class",
    "type": "string",
    "enum": [
      "never_collected",
      "transient_source_derived",
      "retained_review_artifact",
      "customer_opt_in_retained_source"
    ]
  },
  "urn:codeattest:protocol:v0:review-event-customer-projection": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:review-event-customer-projection",
    "title": "Review Event Customer Projection",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "review_id",
      "entries"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "entries": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 0,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "event_id",
            "event_type",
            "event_timestamp",
            "actor_category",
            "artifact_refs",
            "visibility"
          ],
          "properties": {
            "event_id": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
            },
            "event_type": {
              "type": "string",
              "enum": [
                "receipt_issued",
                "submission_rejected",
                "submission_quarantined",
                "classification_recorded",
                "remediation_guidance_recorded",
                "validation_recorded",
                "verification_scope_recorded",
                "verification_evidence_recorded",
                "verification_recorded",
                "customer_remediation_recorded",
                "false_positive_recorded",
                "customer_accepted_risk_recorded",
                "attestation_generated",
                "static_bundle_generated",
                "attestation_package_finalized",
                "attestation_package_exported",
                "evidence_deleted",
                "retention_status_changed",
                "evidence_accessed",
                "key_rotation_recorded"
              ]
            },
            "event_timestamp": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
            },
            "actor_category": {
              "type": "string",
              "enum": [
                "local_runner",
                "customer_user",
                "vendor_service",
                "reviewer"
              ]
            },
            "artifact_refs": {
              "type": "array",
              "maxItems": 10000,
              "minItems": 1,
              "uniqueItems": true,
              "items": {
                "type": "string",
                "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
              }
            },
            "visibility": {
              "type": "string",
              "const": "customer_facing"
            },
            "reason": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            }
          }
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:review-event-log": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:review-event-log",
    "title": "Review Event Log",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "review_id",
      "events"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "events": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 0,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:review-event"
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:review-event": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:review-event",
    "title": "Review Event",
    "type": "object",
    "additionalProperties": false,
    "allOf": [
      {
        "if": {
          "required": [
            "internal_note"
          ]
        },
        "then": {
          "properties": {
            "visibility": {
              "const": "internal_only"
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "event_type": {
              "enum": [
                "classification_recorded",
                "remediation_guidance_recorded",
                "validation_recorded",
                "false_positive_recorded",
                "verification_recorded"
              ]
            }
          },
          "required": [
            "event_type"
          ]
        },
        "then": {
          "properties": {
            "actor": {
              "properties": {
                "actor_type": {
                  "const": "reviewer"
                }
              }
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "event_type": {
              "const": "customer_remediation_recorded"
            }
          },
          "required": [
            "event_type"
          ]
        },
        "then": {
          "properties": {
            "actor": {
              "properties": {
                "actor_type": {
                  "const": "customer_user"
                }
              }
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "event_type": {
              "const": "verification_evidence_recorded"
            }
          },
          "required": [
            "event_type"
          ]
        },
        "then": {
          "properties": {
            "actor": {
              "properties": {
                "actor_type": {
                  "enum": [
                    "customer_user",
                    "vendor_service"
                  ]
                }
              }
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "event_type": {
              "const": "verification_evidence_recorded"
            },
            "actor": {
              "properties": {
                "actor_type": {
                  "const": "vendor_service"
                }
              },
              "required": [
                "actor_type"
              ]
            }
          },
          "required": [
            "event_type",
            "actor"
          ]
        },
        "then": {
          "required": [
            "customer_actor_ref"
          ]
        }
      },
      {
        "if": {
          "properties": {
            "event_type": {
              "const": "attestation_generated"
            }
          },
          "required": [
            "event_type"
          ]
        },
        "then": {
          "properties": {
            "actor": {
              "properties": {
                "actor_type": {
                  "enum": [
                    "reviewer",
                    "vendor_service"
                  ]
                }
              }
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "event_type": {
              "const": "static_bundle_generated"
            }
          },
          "required": [
            "event_type"
          ]
        },
        "then": {
          "properties": {
            "actor": {
              "properties": {
                "actor_type": {
                  "const": "vendor_service"
                }
              }
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "event_type": {
              "enum": [
                "attestation_package_finalized",
                "attestation_package_exported"
              ]
            }
          },
          "required": [
            "event_type"
          ]
        },
        "then": {
          "properties": {
            "actor": {
              "properties": {
                "actor_type": {
                  "const": "customer_user"
                }
              }
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "event_type": {
              "enum": [
                "pilot_metric_recorded",
                "pilot_feedback_recorded"
              ]
            }
          },
          "required": [
            "event_type"
          ]
        },
        "then": {
          "properties": {
            "visibility": {
              "const": "internal_only"
            },
            "actor": {
              "properties": {
                "actor_type": {
                  "enum": [
                    "reviewer",
                    "vendor_service"
                  ]
                }
              }
            }
          },
          "not": {
            "required": [
              "reason"
            ]
          }
        }
      },
      {
        "if": {
          "properties": {
            "event_type": {
              "enum": [
                "evidence_deleted",
                "retention_status_changed"
              ]
            }
          },
          "required": [
            "event_type"
          ]
        },
        "then": {
          "required": [
            "source_derived_class"
          ]
        }
      },
      {
        "if": {
          "properties": {
            "event_type": {
              "enum": [
                "false_positive_recorded",
                "customer_accepted_risk_recorded"
              ]
            }
          },
          "required": [
            "event_type"
          ]
        },
        "then": {
          "not": {
            "required": [
              "supersedes_classification_record_ref"
            ]
          }
        }
      }
    ],
    "required": [
      "protocol_version",
      "event_id",
      "review_id",
      "sequence_number",
      "idempotency_key",
      "event_type",
      "actor",
      "event_timestamp",
      "artifact_refs",
      "visibility",
      "canonicalization",
      "identity_hash_algorithm",
      "identity_input_excludes"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "event_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "sequence_number": {
        "type": "integer",
        "minimum": 0
      },
      "idempotency_key": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "event_type": {
        "type": "string",
        "enum": [
          "receipt_issued",
          "submission_rejected",
          "submission_quarantined",
          "classification_recorded",
          "remediation_guidance_recorded",
          "validation_recorded",
          "verification_scope_recorded",
          "verification_evidence_recorded",
          "verification_recorded",
          "customer_remediation_recorded",
          "false_positive_recorded",
          "customer_accepted_risk_recorded",
          "attestation_generated",
          "static_bundle_generated",
          "attestation_package_finalized",
          "attestation_package_exported",
          "pilot_metric_recorded",
          "pilot_feedback_recorded",
          "evidence_deleted",
          "retention_status_changed",
          "evidence_accessed",
          "key_rotation_recorded"
        ]
      },
      "actor": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/actor_reference"
      },
      "event_timestamp": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "artifact_refs": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "pattern": "^(?:artifact_ref:[a-z0-9][a-z0-9_-]{2,63}|sha256:[a-f0-9]{64})$"
        }
      },
      "visibility": {
        "type": "string",
        "enum": [
          "customer_facing",
          "internal_only"
        ]
      },
      "canonicalization": {
        "type": "string",
        "const": "rfc8785"
      },
      "identity_hash_algorithm": {
        "type": "string",
        "const": "sha256"
      },
      "identity_input_excludes": {
        "type": "array",
        "minItems": 1,
        "maxItems": 1,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "enum": [
            "event_id"
          ]
        }
      },
      "source_derived_class": {
        "$ref": "urn:codeattest:protocol:v0:retention-source-derived-class"
      },
      "reason": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "customer_actor_ref": {
        "type": "string",
        "pattern": "^customer:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "customer_selection_evidence_ref": {
        "type": "string",
        "pattern": "^customer_selection:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "internal_note": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "supersedes_event_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "supersedes_classification_record_ref": {
        "type": "string",
        "pattern": "^classification_record:[a-z0-9][a-z0-9_-]{2,63}$"
      }
    }
  },
  "urn:codeattest:protocol:v0:review-finding-draft-set": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:review-finding-draft-set",
    "title": "Review Finding Draft Set",
    "type": "object",
    "additionalProperties": false,
    "oneOf": [
      {
        "required": [
          "normalization_status",
          "no_findings_statement"
        ],
        "properties": {
          "normalization_status": {
            "const": "no_findings_produced"
          },
          "review_finding_drafts": {
            "maxItems": 0
          },
          "no_findings_statement": {
            "const": "No findings were produced by the configured inputs"
          }
        }
      },
      {
        "required": [
          "normalization_status"
        ],
        "properties": {
          "normalization_status": {
            "const": "drafts_created"
          },
          "review_finding_drafts": {
            "minItems": 1
          }
        },
        "not": {
          "required": [
            "no_findings_statement"
          ]
        }
      }
    ],
    "required": [
      "protocol_version",
      "review_id",
      "normalization_run_id",
      "normalization_status",
      "created_at",
      "vendor_receipt_ref",
      "evidence_bundle_id",
      "manifest_id",
      "source_scanner_finding_set_ref",
      "coverage_mode",
      "review_finding_drafts",
      "normalization_limitations",
      "source_derived_class"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "normalization_run_id": {
        "type": "string",
        "pattern": "^normalization_run:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "normalization_status": {
        "type": "string",
        "enum": [
          "drafts_created",
          "no_findings_produced"
        ]
      },
      "created_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "vendor_receipt_ref": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "evidence_bundle_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "manifest_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "source_scanner_finding_set_ref": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "coverage_mode": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/coverage_mode"
      },
      "review_finding_drafts": {
        "type": "array",
        "maxItems": 10000,
        "uniqueItems": true,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "review_finding_draft_id",
            "candidate_finding_refs",
            "group_key",
            "sources",
            "affected_area",
            "evidence_refs",
            "scanner_rule_ids",
            "status",
            "review_lifecycle_state",
            "coverage_mode",
            "evidence_basis",
            "threshold_gaps",
            "source_reference_state",
            "source_derived_class"
          ],
          "properties": {
            "review_finding_draft_id": {
              "type": "string",
              "pattern": "^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "candidate_finding_refs": {
              "type": "array",
              "maxItems": 10000,
              "minItems": 1,
              "uniqueItems": true,
              "items": {
                "type": "string",
                "pattern": "^candidate_finding:[a-z0-9][a-z0-9_-]{2,63}$"
              }
            },
            "group_key": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "sources": {
              "type": "array",
              "minItems": 1,
              "uniqueItems": true,
              "items": {
                "type": "string",
                "enum": [
                  "regex",
                  "semgrep"
                ]
              }
            },
            "affected_area": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "evidence_refs": {
              "type": "array",
              "maxItems": 10000,
              "items": {
                "type": "object",
                "additionalProperties": false,
                "allOf": [
                  {
                    "if": {
                      "properties": {
                        "availability_state": {
                          "const": "retained_review_artifact"
                        }
                      },
                      "required": [
                        "availability_state"
                      ]
                    },
                    "then": {
                      "properties": {
                        "available_for_review": {
                          "const": true
                        },
                        "display_state": {
                          "const": "available_reference"
                        }
                      },
                      "not": {
                        "required": [
                          "deletion_evidence_ref"
                        ]
                      }
                    }
                  },
                  {
                    "if": {
                      "properties": {
                        "availability_state": {
                          "const": "deleted_under_policy"
                        }
                      },
                      "required": [
                        "availability_state"
                      ]
                    },
                    "then": {
                      "required": [
                        "deletion_evidence_ref"
                      ],
                      "properties": {
                        "available_for_review": {
                          "const": false
                        },
                        "display_state": {
                          "const": "deleted"
                        }
                      }
                    }
                  },
                  {
                    "if": {
                      "properties": {
                        "availability_state": {
                          "const": "never_collected"
                        }
                      },
                      "required": [
                        "availability_state"
                      ]
                    },
                    "then": {
                      "properties": {
                        "available_for_review": {
                          "const": false
                        },
                        "display_state": {
                          "const": "not_collected"
                        }
                      },
                      "not": {
                        "required": [
                          "deletion_evidence_ref"
                        ]
                      }
                    }
                  },
                  {
                    "if": {
                      "properties": {
                        "availability_state": {
                          "const": "not_submitted_by_policy"
                        }
                      },
                      "required": [
                        "availability_state"
                      ]
                    },
                    "then": {
                      "properties": {
                        "available_for_review": {
                          "const": false
                        },
                        "display_state": {
                          "const": "not_submitted"
                        }
                      },
                      "not": {
                        "required": [
                          "deletion_evidence_ref"
                        ]
                      }
                    }
                  },
                  {
                    "if": {
                      "properties": {
                        "availability_state": {
                          "const": "unresolved_reference"
                        }
                      },
                      "required": [
                        "availability_state"
                      ]
                    },
                    "then": {
                      "properties": {
                        "available_for_review": {
                          "const": false
                        },
                        "display_state": {
                          "const": "unresolved_reference"
                        }
                      },
                      "not": {
                        "required": [
                          "deletion_evidence_ref"
                        ]
                      }
                    }
                  }
                ],
                "required": [
                  "artifact_ref",
                  "availability_state",
                  "available_for_review",
                  "display_state",
                  "source_derived_class"
                ],
                "properties": {
                  "artifact_ref": {
                    "type": "string",
                    "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
                  },
                  "availability_state": {
                    "type": "string",
                    "enum": [
                      "retained_review_artifact",
                      "deleted_under_policy",
                      "never_collected",
                      "not_submitted_by_policy",
                      "unresolved_reference"
                    ]
                  },
                  "available_for_review": {
                    "type": "boolean"
                  },
                  "display_state": {
                    "type": "string",
                    "enum": [
                      "available_reference",
                      "deleted",
                      "not_collected",
                      "not_submitted",
                      "unresolved_reference"
                    ]
                  },
                  "deletion_evidence_ref": {
                    "type": "string",
                    "pattern": "^deletion_evidence:[a-z0-9][a-z0-9_-]{2,63}$"
                  },
                  "source_derived_class": {
                    "$ref": "urn:codeattest:protocol:v0:retention-source-derived-class"
                  }
                }
              }
            },
            "severity": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "confidence": {
              "type": "string",
              "enum": [
                "low",
                "medium",
                "high",
                "unknown"
              ]
            },
            "scanner_rule_ids": {
              "type": "array",
              "maxItems": 10000,
              "minItems": 1,
              "uniqueItems": true,
              "items": {
                "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
              }
            },
            "status": {
              "type": "string",
              "const": "draft"
            },
            "review_lifecycle_state": {
              "type": "string",
              "const": "under_review"
            },
            "coverage_mode": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/coverage_mode"
            },
            "evidence_basis": {
              "type": "array",
              "minItems": 1,
              "uniqueItems": true,
              "items": {
                "type": "string",
                "enum": [
                  "scanner_output",
                  "metadata_only",
                  "finding_context_snippet",
                  "extended_approved_source_context",
                  "retained_review_artifact",
                  "deleted_under_policy_reference",
                  "not_submitted_by_policy_reference",
                  "never_collected_reference",
                  "unresolved_reference"
                ]
              }
            },
            "threshold_gaps": {
              "type": "array",
              "maxItems": 100,
              "items": {
                "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
              }
            },
            "source_reference_state": {
              "type": "string",
              "enum": [
                "retained_review_artifact",
                "deleted_under_policy",
                "never_collected",
                "not_submitted_by_policy",
                "unresolved_reference"
              ]
            },
            "source_derived_class": {
              "type": "string",
              "const": "retained_review_artifact"
            }
          }
        }
      },
      "normalization_limitations": {
        "type": "array",
        "maxItems": 100,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "no_findings_statement": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "source_derived_class": {
        "type": "string",
        "const": "retained_review_artifact"
      }
    }
  },
  "urn:codeattest:protocol:v0:review-scope": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:review-scope",
    "title": "Review Scope",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "review_scope_id",
      "review_id",
      "generated_at",
      "selected_application",
      "selected_commit",
      "repository_identity",
      "runner",
      "technical_context",
      "dependency_manifests"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "review_scope_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "generated_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "selected_application": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "application_id",
          "display_name"
        ],
        "properties": {
          "application_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "display_name": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "selected_commit": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "commit_sha",
          "source_control_system"
        ],
        "properties": {
          "commit_sha": {
            "type": "string",
            "pattern": "^[a-f0-9]{40}$"
          },
          "source_control_system": {
            "type": "string",
            "enum": [
              "git"
            ]
          }
        }
      },
      "repository_identity": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "runner": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "name",
          "version"
        ],
        "properties": {
          "name": {
            "type": "string",
            "const": "codeattest-local-runner"
          },
          "version": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "technical_context": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "context_type",
            "status"
          ],
          "properties": {
            "context_type": {
              "type": "string",
              "enum": [
                "language",
                "framework",
                "package_manager",
                "scanner",
                "ci_provider"
              ]
            },
            "status": {
              "type": "string",
              "enum": [
                "detected",
                "not_detected",
                "unsupported",
                "not_collected"
              ]
            },
            "value": {
              "type": "string",
              "minLength": 1
            }
          }
        }
      },
      "dependency_manifests": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "manifest_type",
            "status",
            "package_manager",
            "dependency_count",
            "dependencies"
          ],
          "properties": {
            "manifest_type": {
              "type": "string",
              "enum": [
                "package_json",
                "package_lock",
                "requirements_txt",
                "pyproject_toml",
                "pipfile",
                "pipfile_lock",
                "pnpm_lock",
                "yarn_lock"
              ]
            },
            "status": {
              "type": "string",
              "enum": [
                "detected",
                "not_found",
                "unsupported",
                "malformed"
              ]
            },
            "path": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "package_manager": {
              "type": "string",
              "enum": [
                "npm",
                "pnpm",
                "yarn",
                "pip",
                "poetry",
                "pipenv",
                "unknown"
              ]
            },
            "dependency_count": {
              "type": "integer",
              "minimum": 0
            },
            "dependencies": {
              "type": "array",
              "maxItems": 10000,
              "items": {
                "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
              }
            },
            "limitation": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            }
          }
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:reviewer-validation-script": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:reviewer-validation-script",
    "title": "Reviewer Validation Script",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "review_id",
      "validation_script_id",
      "validation_path_ref",
      "classification_record_ref",
      "script_package_status",
      "purpose",
      "prerequisites",
      "execution_steps",
      "expected_output",
      "safety_notes",
      "output_attachment_instructions",
      "script_content",
      "authored_at",
      "actor",
      "source_derived_class",
      "visibility"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "validation_script_id": {
        "type": "string",
        "pattern": "^validation_script:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "validation_path_ref": {
        "type": "string",
        "pattern": "^validation_path:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "classification_record_ref": {
        "type": "string",
        "pattern": "^classification_record:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "remediation_guidance_ref": {
        "type": "string",
        "pattern": "^remediation_guidance:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "script_package_status": {
        "type": "string",
        "enum": [
          "included_base_package",
          "additional_script_candidate_pricing_tbd"
        ]
      },
      "included_script_slot": {
        "type": "integer",
        "minimum": 1,
        "maximum": 3
      },
      "purpose": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "prerequisites": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "execution_steps": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "expected_output": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "safety_notes": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "output_attachment_instructions": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "script_content": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "authored_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "actor": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "actor_type",
          "actor_id"
        ],
        "properties": {
          "actor_type": {
            "type": "string",
            "const": "reviewer"
          },
          "actor_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "source_derived_class": {
        "type": "string",
        "const": "retained_review_artifact"
      },
      "visibility": {
        "type": "string",
        "enum": [
          "customer_facing",
          "internal_only"
        ]
      }
    }
  },
  "urn:codeattest:protocol:v0:runner-key-enrollment-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:runner-key-enrollment-record",
    "title": "Runner Key Enrollment Record",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "enrollment_id",
      "review_id",
      "runner_key_id",
      "runner_key_version",
      "algorithm_profile",
      "public_key",
      "enrollment_method",
      "enrolled_at",
      "limitations"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "enrollment_id": {
        "type": "string",
        "pattern": "^runner_enrollment:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "runner_key_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "runner_key_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "algorithm_profile": {
        "type": "string",
        "const": "ml_dsa_65"
      },
      "public_key": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/ml_dsa_65_public_key"
      },
      "enrollment_method": {
        "type": "string",
        "enum": [
          "operator_verified",
          "trust_on_first_use"
        ]
      },
      "enrolled_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "limitations": {
        "type": "array",
        "maxItems": 100,
        "minItems": 1,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:runner-release-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:runner-release-record",
    "title": "Runner Release Record",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "release_identifier",
      "build_identifier",
      "artifact_digest",
      "released_at",
      "limitations"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "release_identifier": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "build_identifier": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "artifact_digest": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "released_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "limitations": {
        "type": "array",
        "maxItems": 100,
        "minItems": 1,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:scanner-finding-set": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:scanner-finding-set",
    "title": "Scanner Finding Set",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "scanner_finding_set_id",
      "generated_at",
      "review_scope_ref",
      "runner",
      "source_derived_class",
      "scanner_runs",
      "candidate_findings",
      "coverage_limitations",
      "artifact_references"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "scanner_finding_set_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "generated_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "review_scope_ref": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "runner": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "name",
          "version"
        ],
        "properties": {
          "name": {
            "type": "string",
            "const": "codeattest-local-runner"
          },
          "version": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "source_derived_class": {
        "type": "string",
        "const": "retained_review_artifact"
      },
      "scanner_runs": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "dependentSchemas": {
            "failure_reason": {
              "properties": {
                "status": {
                  "enum": [
                    "unavailable",
                    "failed",
                    "invalid_output",
                    "skipped"
                  ]
                }
              },
              "required": [
                "status"
              ]
            }
          },
          "allOf": [
            {
              "if": {
                "properties": {
                  "status": {
                    "enum": [
                      "unavailable",
                      "failed",
                      "invalid_output",
                      "skipped"
                    ]
                  }
                },
                "required": [
                  "status"
                ]
              },
              "then": {
                "required": [
                  "failure_reason"
                ]
              },
              "else": {
                "not": {
                  "required": [
                    "failure_reason"
                  ]
                }
              }
            }
          ],
          "required": [
            "scanner_name",
            "scanner_version",
            "ruleset_identifier",
            "executed_at",
            "status",
            "covered_file_group",
            "scanned_files",
            "rerun_possible",
            "source_derived_class"
          ],
          "properties": {
            "scanner_name": {
              "type": "string",
              "enum": [
                "regex",
                "semgrep"
              ]
            },
            "scanner_version": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "ruleset_identifier": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "executed_at": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
            },
            "status": {
              "type": "string",
              "enum": [
                "succeeded",
                "no_findings",
                "unavailable",
                "failed",
                "invalid_output",
                "skipped"
              ]
            },
            "covered_file_group": {
              "type": "string",
              "enum": [
                "typescript_javascript",
                "python",
                "mixed",
                "unsupported"
              ]
            },
            "scanned_files": {
              "type": "array",
              "maxItems": 10000,
              "items": {
                "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
              }
            },
            "failure_reason": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "rerun_possible": {
              "type": "boolean"
            },
            "source_derived_class": {
              "type": "string",
              "const": "retained_review_artifact"
            }
          }
        }
      },
      "candidate_findings": {
        "type": "array",
        "maxItems": 10000,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "candidate_finding_id",
            "source",
            "affected_area",
            "scanner_rule_id",
            "original_reference",
            "source_artifact_refs",
            "status",
            "source_derived_class"
          ],
          "properties": {
            "candidate_finding_id": {
              "type": "string",
              "pattern": "^candidate_finding:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "source": {
              "type": "string",
              "enum": [
                "regex",
                "semgrep"
              ]
            },
            "affected_area": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "severity": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "confidence": {
              "type": "string",
              "enum": [
                "low",
                "medium",
                "high",
                "unknown"
              ]
            },
            "scanner_rule_id": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "original_reference": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "source_artifact_refs": {
              "type": "array",
              "maxItems": 10000,
              "uniqueItems": true,
              "items": {
                "type": "string",
                "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
              }
            },
            "status": {
              "type": "string",
              "enum": [
                "candidate"
              ]
            },
            "source_derived_class": {
              "type": "string",
              "const": "retained_review_artifact"
            }
          }
        }
      },
      "coverage_limitations": {
        "type": "array",
        "maxItems": 100,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "artifact_references": {
        "type": "array",
        "maxItems": 10000,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:artifact-reference"
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:security-review-attestation": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:security-review-attestation",
    "title": "Security Review Attestation",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "attestation_id",
      "attestation_version",
      "review_id",
      "generated_at",
      "generated_by",
      "review_scope_ref",
      "selected_commit",
      "repository_identity",
      "method",
      "receipt_chain",
      "sections",
      "verification_addendum_refs",
      "evidence_minimization_ref",
      "deletion_evidence_refs",
      "limitations",
      "supporting_artifact_refs",
      "customer_safe_projection",
      "source_derived_class",
      "visibility",
      "canonicalization",
      "identity_hash_algorithm",
      "identity_input_excludes"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "attestation_id": {
        "type": "string",
        "pattern": "^attestation:[a-f0-9]{64}$"
      },
      "attestation_version": {
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "generated_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "generated_by": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "actor_type",
          "actor_id"
        ],
        "properties": {
          "actor_type": {
            "type": "string",
            "enum": [
              "reviewer",
              "vendor_service"
            ]
          },
          "actor_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "review_scope_ref": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "selected_commit": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "commit_sha",
          "source_control_system"
        ],
        "properties": {
          "commit_sha": {
            "type": "string",
            "pattern": "^[a-f0-9]{40}$"
          },
          "source_control_system": {
            "type": "string",
            "const": "git"
          }
        }
      },
      "repository_identity": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "method": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "coverage_mode",
          "scanner_versions",
          "tooling_summary",
          "disclosure_summary",
          "method_limitations"
        ],
        "properties": {
          "coverage_mode": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/coverage_mode"
          },
          "scanner_versions": {
            "type": "array",
            "maxItems": 10000,
            "minItems": 1,
            "uniqueItems": true,
            "items": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            }
          },
          "tooling_summary": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "disclosure_summary": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "method_limitations": {
            "type": "array",
            "maxItems": 100,
            "minItems": 1,
            "items": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
            }
          }
        }
      },
      "receipt_chain": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "manifest_id",
          "evidence_bundle_id",
          "vendor_receipt_id",
          "receipt_timestamp",
          "verification_state"
        ],
        "properties": {
          "manifest_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
          },
          "evidence_bundle_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
          },
          "vendor_receipt_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
          },
          "receipt_timestamp": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
          },
          "verification_state": {
            "type": "string",
            "const": "received_with_receipt"
          }
        }
      },
      "sections": {
        "type": "array",
        "minItems": 8,
        "maxItems": 8,
        "allOf": [
          {
            "contains": {
              "properties": {
                "section_type": {
                  "const": "scope"
                }
              },
              "required": [
                "section_type"
              ]
            },
            "minContains": 1,
            "maxContains": 1
          },
          {
            "contains": {
              "properties": {
                "section_type": {
                  "const": "method"
                }
              },
              "required": [
                "section_type"
              ]
            },
            "minContains": 1,
            "maxContains": 1
          },
          {
            "contains": {
              "properties": {
                "section_type": {
                  "const": "receipt_chain"
                }
              },
              "required": [
                "section_type"
              ]
            },
            "minContains": 1,
            "maxContains": 1
          },
          {
            "contains": {
              "properties": {
                "section_type": {
                  "const": "findings_and_classification"
                }
              },
              "required": [
                "section_type"
              ]
            },
            "minContains": 1,
            "maxContains": 1
          },
          {
            "contains": {
              "properties": {
                "section_type": {
                  "const": "remediation_and_validation"
                }
              },
              "required": [
                "section_type"
              ]
            },
            "minContains": 1,
            "maxContains": 1
          },
          {
            "contains": {
              "properties": {
                "section_type": {
                  "const": "verification_outcomes"
                }
              },
              "required": [
                "section_type"
              ]
            },
            "minContains": 1,
            "maxContains": 1
          },
          {
            "contains": {
              "properties": {
                "section_type": {
                  "const": "evidence_lifecycle"
                }
              },
              "required": [
                "section_type"
              ]
            },
            "minContains": 1,
            "maxContains": 1
          },
          {
            "contains": {
              "properties": {
                "section_type": {
                  "const": "limitations"
                }
              },
              "required": [
                "section_type"
              ]
            },
            "minContains": 1,
            "maxContains": 1
          }
        ],
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "section_id",
            "section_type",
            "title",
            "summary",
            "scope",
            "evidence_basis",
            "limitations",
            "supporting_artifact_refs"
          ],
          "properties": {
            "section_id": {
              "type": "string",
              "pattern": "^attestation_section:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "section_type": {
              "type": "string",
              "enum": [
                "scope",
                "method",
                "receipt_chain",
                "findings_and_classification",
                "remediation_and_validation",
                "verification_outcomes",
                "evidence_lifecycle",
                "limitations"
              ]
            },
            "title": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "summary": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "scope": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "evidence_basis": {
              "type": "array",
              "maxItems": 100,
              "minItems": 1,
              "items": {
                "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
              }
            },
            "limitations": {
              "type": "array",
              "maxItems": 100,
              "minItems": 1,
              "items": {
                "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
              }
            },
            "supporting_artifact_refs": {
              "type": "array",
              "maxItems": 10000,
              "minItems": 1,
              "uniqueItems": true,
              "items": {
                "type": "string",
                "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
              }
            }
          }
        }
      },
      "verification_addendum_refs": {
        "type": "array",
        "maxItems": 10000,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "pattern": "^verification_addendum:[a-z0-9][a-z0-9_-]{2,63}$"
        }
      },
      "evidence_minimization_ref": {
        "type": "string",
        "pattern": "^evidence_minimization:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "deletion_evidence_refs": {
        "type": "array",
        "maxItems": 10000,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "pattern": "^deletion_evidence:[a-z0-9][a-z0-9_-]{2,63}$"
        }
      },
      "supporting_evidence_mapping_ref": {
        "type": "string",
        "pattern": "^supporting_evidence_mapping:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "limitations": {
        "type": "array",
        "maxItems": 100,
        "minItems": 1,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "supporting_artifact_refs": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
        }
      },
      "customer_safe_projection": {
        "type": "boolean",
        "const": true
      },
      "source_derived_class": {
        "type": "string",
        "const": "retained_review_artifact"
      },
      "visibility": {
        "type": "string",
        "const": "customer_facing"
      },
      "canonicalization": {
        "type": "string",
        "const": "rfc8785"
      },
      "identity_hash_algorithm": {
        "type": "string",
        "const": "sha256"
      },
      "identity_input_excludes": {
        "type": "array",
        "minItems": 1,
        "maxItems": 1,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "const": "attestation_id"
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:shared-definitions": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:shared-definitions",
    "title": "CodeAttest Protocol v0 Shared Definitions",
    "$defs": {
      "actor_reference": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "actor_type",
          "actor_id"
        ],
        "properties": {
          "actor_type": {
            "type": "string",
            "enum": [
              "local_runner",
              "customer_user",
              "vendor_service",
              "reviewer"
            ]
          },
          "actor_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "algorithm_prefixed_sha256_id": {
        "type": "string",
        "pattern": "^sha256:[a-f0-9]{64}$"
      },
      "artifact_digest": {
        "type": "string",
        "pattern": "^sha256:[a-f0-9]{64}$"
      },
      "coverage_mode": {
        "type": "string",
        "enum": [
          "metadata_only",
          "finding_context_snippets",
          "extended_approved_snippets_or_targeted_files"
        ]
      },
      "ml_dsa_65_signature": {
        "type": "string",
        "pattern": "^ml_dsa_65:[A-Za-z0-9_-]{4412}$"
      },
      "ml_dsa_65_public_key": {
        "type": "string",
        "pattern": "^[A-Za-z0-9_-]{2603}$"
      },
      "narrative_string": {
        "type": "string",
        "minLength": 1,
        "maxLength": 4096
      },
      "non_empty_string": {
        "type": "string",
        "minLength": 1,
        "maxLength": 65536
      },
      "protocol_version": {
        "type": "string",
        "const": "codeattest.v0"
      },
      "sha256_hex": {
        "type": "string",
        "pattern": "^[a-f0-9]{64}$"
      },
      "snake_case_field_name": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9_]*$"
      },
      "utc_rfc3339_timestamp": {
        "type": "string",
        "pattern": "^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:(?:[0-5][0-9]|60)(?:\\.[0-9]{1,9})?(?:Z|\\+00:00)$"
      }
    }
  },
  "urn:codeattest:protocol:v0:signature-envelope": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:signature-envelope",
    "title": "Signature Envelope",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "algorithm_profile",
      "key_id",
      "key_version",
      "signing_time",
      "signed_identity_type",
      "signed_identity",
      "canonicalization",
      "signing_mode",
      "signing_limitations",
      "signature_bytes"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "algorithm_profile": {
        "type": "string",
        "const": "ml_dsa_65"
      },
      "key_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "key_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "signing_time": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "signed_identity_type": {
        "type": "string",
        "enum": [
          "outbound_manifest",
          "evidence_bundle",
          "vendor_receipt",
          "static_bundle_manifest",
          "attestation_package_finalization",
          "disclosure_policy",
          "review_event",
          "security_review_attestation",
          "signing_key_directory",
          "runner_release",
          "environment_readiness_decision"
        ]
      },
      "signed_identity": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "canonicalization": {
        "type": "string",
        "const": "rfc8785"
      },
      "signing_mode": {
        "type": "string",
        "enum": [
          "managed_key",
          "enrolled_runner_key"
        ]
      },
      "signing_limitations": {
        "type": "array",
        "maxItems": 100,
        "minItems": 1,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "signature_bytes": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/ml_dsa_65_signature"
      }
    }
  },
  "urn:codeattest:protocol:v0:signature-verification-outcome": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:signature-verification-outcome",
    "title": "Signature Verification Outcome",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "signed_identity_type",
      "signed_identity",
      "algorithm_profile",
      "key_id",
      "key_version",
      "key_directory_version",
      "verified_at",
      "result"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "signed_identity_type": {
        "type": "string",
        "enum": [
          "outbound_manifest",
          "evidence_bundle",
          "vendor_receipt",
          "static_bundle_manifest",
          "attestation_package_finalization",
          "disclosure_policy",
          "review_event",
          "security_review_attestation",
          "signing_key_directory",
          "environment_readiness_decision"
        ]
      },
      "signed_identity": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "algorithm_profile": {
        "type": "string",
        "const": "ml_dsa_65"
      },
      "key_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "key_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "key_directory_version": {
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991
      },
      "verified_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "result": {
        "type": "string",
        "enum": [
          "verified",
          "signature_bytes_untrusted",
          "signature_key_unknown",
          "signature_key_revoked",
          "signature_key_outside_validity_window",
          "signature_key_algorithm_mismatch",
          "signature_key_directory_untrusted",
          "signature_signing_input_mismatch"
        ]
      }
    }
  },
  "urn:codeattest:protocol:v0:signing-key-directory": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:signing-key-directory",
    "title": "Signing Key Directory",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "directory_version",
      "trust_anchor_key_id",
      "published_at",
      "keys",
      "directory_signature"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "directory_version": {
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991
      },
      "trust_anchor_key_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "published_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "keys": {
        "type": "array",
        "minItems": 1,
        "maxItems": 1000,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:signing-key-record"
        }
      },
      "directory_signature": {
        "$ref": "urn:codeattest:protocol:v0:signature-envelope"
      }
    }
  },
  "urn:codeattest:protocol:v0:signing-key-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:signing-key-record",
    "title": "Signing Key Record",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "key_id",
      "key_version",
      "algorithm_profile",
      "public_key",
      "custody_mode",
      "valid_from",
      "status",
      "limitations"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "key_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "key_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "algorithm_profile": {
        "type": "string",
        "const": "ml_dsa_65"
      },
      "public_key": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/ml_dsa_65_public_key"
      },
      "custody_mode": {
        "type": "string",
        "enum": [
          "offline_trust_anchor",
          "self_hosted_software",
          "customer_held_runner"
        ]
      },
      "valid_from": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "valid_until": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "status": {
        "type": "string",
        "enum": [
          "active",
          "retired",
          "revoked"
        ]
      },
      "limitations": {
        "type": "array",
        "maxItems": 100,
        "minItems": 1,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:static-bundle-manifest": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:static-bundle-manifest",
    "title": "Static Bundle Manifest",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "static_bundle_id",
      "static_bundle_manifest_id",
      "manifest_version",
      "package_state",
      "review_id",
      "created_at",
      "attestation_ref",
      "vendor_receipt_ref",
      "evidence_bundle_representation",
      "portal_projection_ref",
      "files",
      "minimization_disposition",
      "verification_metadata",
      "canonicalization",
      "identity_hash_algorithm",
      "identity_input_excludes"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "static_bundle_id": {
        "type": "string",
        "pattern": "^static_bundle:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "static_bundle_manifest_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "manifest_version": {
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991
      },
      "package_state": {
        "type": "string",
        "enum": [
          "generated",
          "finalized"
        ]
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "created_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "supersedes_static_bundle_manifest_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "attestation_ref": {
        "type": "string",
        "pattern": "^attestation:[a-f0-9]{64}$"
      },
      "vendor_receipt_ref": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "evidence_bundle_representation": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "evidence_bundle_id",
          "bundle_manifest_ref",
          "signature_ref",
          "identity_ref",
          "retained_export_approved_payload_refs"
        ],
        "properties": {
          "evidence_bundle_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
          },
          "bundle_manifest_ref": {
            "type": "string",
            "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
          },
          "signature_ref": {
            "type": "string",
            "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
          },
          "identity_ref": {
            "type": "string",
            "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
          },
          "retained_export_approved_payload_refs": {
            "type": "array",
            "maxItems": 10000,
            "uniqueItems": true,
            "items": {
              "type": "string",
              "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
            }
          }
        }
      },
      "portal_projection_ref": {
        "type": "string",
        "pattern": "^static_portal_projection:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "files": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 6,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "relative_path",
            "artifact_ref",
            "media_type",
            "digest",
            "size_bytes",
            "artifact_role",
            "source_derived_class",
            "inclusion_reason"
          ],
          "properties": {
            "relative_path": {
              "type": "string",
              "pattern": "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*\\\\)[a-zA-Z0-9._/-]+$"
            },
            "artifact_ref": {
              "type": "string",
              "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "media_type": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "digest": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/artifact_digest"
            },
            "size_bytes": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "artifact_role": {
              "type": "string",
              "enum": [
                "attestation",
                "vendor_receipt",
                "evidence_bundle_representation",
                "supporting_evidence",
                "portal",
                "portal_asset",
                "verification_metadata"
              ]
            },
            "source_derived_class": {
              "type": "string",
              "enum": [
                "never_collected",
                "retained_review_artifact",
                "customer_opt_in_retained_source"
              ]
            },
            "inclusion_reason": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            }
          }
        }
      },
      "minimization_disposition": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "included_retained_refs",
          "excluded_refs",
          "deleted_refs",
          "never_collected_refs"
        ],
        "properties": {
          "included_retained_refs": {
            "type": "array",
            "maxItems": 10000,
            "uniqueItems": true,
            "items": {
              "type": "string",
              "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
            }
          },
          "excluded_refs": {
            "type": "array",
            "maxItems": 10000,
            "uniqueItems": true,
            "items": {
              "type": "string",
              "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
            }
          },
          "deleted_refs": {
            "type": "array",
            "maxItems": 10000,
            "uniqueItems": true,
            "items": {
              "type": "string",
              "pattern": "^deletion_evidence:[a-z0-9][a-z0-9_-]{2,63}$"
            }
          },
          "never_collected_refs": {
            "type": "array",
            "maxItems": 10000,
            "uniqueItems": true,
            "items": {
              "type": "string",
              "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
            }
          }
        }
      },
      "verification_metadata": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "manifest_signature_ref",
          "signing_input_ref",
          "verification_instructions_path",
          "offline_verification_supported",
          "all_file_digests_verified"
        ],
        "properties": {
          "manifest_signature_ref": {
            "type": "string",
            "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
          },
          "signing_input_ref": {
            "type": "string",
            "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
          },
          "verification_instructions_path": {
            "type": "string",
            "pattern": "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*\\\\)[a-zA-Z0-9._/-]+$"
          },
          "offline_verification_supported": {
            "type": "boolean",
            "const": true
          },
          "all_file_digests_verified": {
            "type": "boolean",
            "const": true
          }
        }
      },
      "canonicalization": {
        "type": "string",
        "const": "rfc8785"
      },
      "identity_hash_algorithm": {
        "type": "string",
        "const": "sha256"
      },
      "identity_input_excludes": {
        "type": "array",
        "minItems": 1,
        "maxItems": 1,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "const": "static_bundle_manifest_id"
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:static-bundle-verification-package": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:static-bundle-verification-package",
    "title": "Static Bundle Verification Package",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "attachment_index_id",
      "signed_payload_manifest_id",
      "signing_input_attachment",
      "signature_attachment",
      "canonicalization",
      "identity_hash_algorithm",
      "identity_input_excludes"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "attachment_index_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "signed_payload_manifest_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "signing_input_attachment": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "relative_path",
          "artifact_ref",
          "media_type",
          "digest",
          "size_bytes",
          "signing_input"
        ],
        "properties": {
          "relative_path": {
            "type": "string",
            "const": "verification/static-bundle-signing-input.json"
          },
          "artifact_ref": {
            "type": "string",
            "const": "artifact_ref:static_bundle_signing_input"
          },
          "media_type": {
            "type": "string",
            "const": "application/json"
          },
          "digest": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/artifact_digest"
          },
          "size_bytes": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "signing_input": {
            "$ref": "urn:codeattest:protocol:v0:identity-signing-input"
          }
        }
      },
      "signature_attachment": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "relative_path",
          "artifact_ref",
          "media_type",
          "digest",
          "size_bytes",
          "signature_envelope"
        ],
        "properties": {
          "relative_path": {
            "type": "string",
            "const": "verification/static-bundle-signature.json"
          },
          "artifact_ref": {
            "type": "string",
            "const": "artifact_ref:static_bundle_signature"
          },
          "media_type": {
            "type": "string",
            "const": "application/json"
          },
          "digest": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/artifact_digest"
          },
          "size_bytes": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "signature_envelope": {
            "$ref": "urn:codeattest:protocol:v0:signature-envelope"
          }
        }
      },
      "canonicalization": {
        "type": "string",
        "const": "rfc8785"
      },
      "identity_hash_algorithm": {
        "type": "string",
        "const": "sha256"
      },
      "identity_input_excludes": {
        "type": "array",
        "minItems": 1,
        "maxItems": 1,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "const": "attachment_index_id"
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:static-portal-projection": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:static-portal-projection",
    "title": "Static Portal Projection",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "static_portal_projection_id",
      "review_id",
      "static_bundle_id",
      "static_bundle_manifest_ref",
      "generated_at",
      "navigation",
      "documents",
      "capabilities",
      "asset_policy",
      "customer_safe_projection",
      "visibility"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "static_portal_projection_id": {
        "type": "string",
        "pattern": "^static_portal_projection:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "static_bundle_id": {
        "type": "string",
        "pattern": "^static_bundle:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "static_bundle_manifest_ref": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "generated_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "navigation": {
        "type": "array",
        "minItems": 8,
        "maxItems": 8,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "section_id",
            "label",
            "relative_path",
            "order"
          ],
          "properties": {
            "section_id": {
              "type": "string",
              "enum": [
                "overview",
                "scope",
                "receipt_chain",
                "methods",
                "findings",
                "validation_remediation",
                "limitations",
                "appendices"
              ]
            },
            "label": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "relative_path": {
              "type": "string",
              "pattern": "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*\\\\)[a-zA-Z0-9._/-]+$"
            },
            "order": {
              "type": "integer",
              "minimum": 1,
              "maximum": 8
            }
          }
        }
      },
      "documents": {
        "type": "array",
        "minItems": 8,
        "maxItems": 8,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "document_id",
            "section_id",
            "title",
            "summary",
            "relative_path",
            "source_artifact_refs",
            "copyable_identity_values",
            "phone_summary",
            "print_included",
            "search_included"
          ],
          "properties": {
            "document_id": {
              "type": "string",
              "pattern": "^portal_document:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "section_id": {
              "type": "string",
              "enum": [
                "overview",
                "scope",
                "receipt_chain",
                "methods",
                "findings",
                "validation_remediation",
                "limitations",
                "appendices"
              ]
            },
            "title": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "summary": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "relative_path": {
              "type": "string",
              "pattern": "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*\\\\)[a-zA-Z0-9._/-]+$"
            },
            "source_artifact_refs": {
              "type": "array",
              "maxItems": 10000,
              "minItems": 1,
              "uniqueItems": true,
              "items": {
                "type": "string",
                "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
              }
            },
            "copyable_identity_values": {
              "type": "array",
              "maxItems": 10000,
              "uniqueItems": true,
              "items": {
                "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
              }
            },
            "phone_summary": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "print_included": {
              "type": "boolean",
              "const": true
            },
            "search_included": {
              "type": "boolean",
              "const": true
            }
          }
        }
      },
      "capabilities": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "offline_navigation",
          "offline_search",
          "print_export",
          "copy_controls",
          "phone_readable_summaries"
        ],
        "properties": {
          "offline_navigation": {
            "type": "boolean",
            "const": true
          },
          "offline_search": {
            "type": "boolean",
            "const": true
          },
          "print_export": {
            "type": "boolean",
            "const": true
          },
          "copy_controls": {
            "type": "boolean",
            "const": true
          },
          "phone_readable_summaries": {
            "type": "boolean",
            "const": true
          }
        }
      },
      "asset_policy": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "remote_assets_allowed",
          "analytics_allowed",
          "live_api_calls_allowed",
          "runtime_authorization_required",
          "relative_links_only"
        ],
        "properties": {
          "remote_assets_allowed": {
            "type": "boolean",
            "const": false
          },
          "analytics_allowed": {
            "type": "boolean",
            "const": false
          },
          "live_api_calls_allowed": {
            "type": "boolean",
            "const": false
          },
          "runtime_authorization_required": {
            "type": "boolean",
            "const": false
          },
          "relative_links_only": {
            "type": "boolean",
            "const": true
          }
        }
      },
      "customer_safe_projection": {
        "type": "boolean",
        "const": true
      },
      "visibility": {
        "type": "string",
        "const": "customer_facing"
      }
    }
  },
  "urn:codeattest:protocol:v0:stored-object-classification": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:stored-object-classification",
    "title": "Stored Object Classification",
    "type": "object",
    "additionalProperties": false,
    "allOf": [
      {
        "if": {
          "properties": {
            "object_kind": {
              "enum": [
                "support_attachment",
                "log_or_trace",
                "analytics_record",
                "crash_report"
              ]
            }
          },
          "required": [
            "object_kind"
          ]
        },
        "then": {
          "properties": {
            "source_derived_class": {
              "enum": [
                "never_collected",
                "retained_review_artifact"
              ]
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "source_derived_class": {
              "const": "customer_opt_in_retained_source"
            }
          },
          "required": [
            "source_derived_class"
          ]
        },
        "then": {
          "properties": {
            "environment_profile": {
              "const": "partner_pilot_real_snippet_ready"
            }
          }
        }
      }
    ],
    "required": [
      "protocol_version",
      "stored_object_ref",
      "object_kind",
      "source_derived_class",
      "environment_profile"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "stored_object_ref": {
        "type": "string",
        "pattern": "^stored_object:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "object_kind": {
        "type": "string",
        "enum": [
          "evidence_artifact",
          "queue_payload",
          "worker_scratch",
          "generated_export",
          "support_attachment",
          "log_or_trace",
          "analytics_record",
          "crash_report"
        ]
      },
      "source_derived_class": {
        "$ref": "urn:codeattest:protocol:v0:retention-source-derived-class"
      },
      "environment_profile": {
        "type": "string",
        "enum": [
          "synthetic_demo",
          "partner_pilot_candidate",
          "partner_pilot_real_snippet_ready"
        ]
      },
      "artifact_ref": {
        "type": "string",
        "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
      }
    }
  },
  "urn:codeattest:protocol:v0:submission-outcome": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:submission-outcome",
    "title": "Submission Outcome",
    "type": "object",
    "additionalProperties": false,
    "allOf": [
      {
        "if": {
          "properties": {
            "outcome_state": {
              "const": "received_with_receipt"
            }
          },
          "required": [
            "outcome_state"
          ]
        },
        "then": {
          "required": [
            "vendor_receipt_ref"
          ],
          "properties": {
            "next_path": {
              "const": "verify_receipt"
            }
          },
          "not": {
            "required": [
              "failure_reason_codes"
            ]
          }
        }
      },
      {
        "if": {
          "properties": {
            "outcome_state": {
              "const": "rejected_no_receipt"
            }
          },
          "required": [
            "outcome_state"
          ]
        },
        "then": {
          "required": [
            "failure_reason_codes"
          ],
          "properties": {
            "failure_reason_codes": {
              "minItems": 1
            },
            "next_path": {
              "enum": [
                "retry",
                "contact_support"
              ]
            }
          },
          "not": {
            "required": [
              "vendor_receipt_ref"
            ]
          }
        }
      },
      {
        "if": {
          "properties": {
            "outcome_state": {
              "const": "quarantined_no_receipt"
            }
          },
          "required": [
            "outcome_state"
          ]
        },
        "then": {
          "required": [
            "failure_reason_codes"
          ],
          "properties": {
            "failure_reason_codes": {
              "minItems": 1
            },
            "next_path": {
              "enum": [
                "quarantine_support",
                "contact_support"
              ]
            }
          },
          "not": {
            "required": [
              "vendor_receipt_ref"
            ]
          }
        }
      }
    ],
    "required": [
      "protocol_version",
      "submission_outcome_id",
      "review_id",
      "outcome_state",
      "bundle_instance_id",
      "submission_attempt_id",
      "occurred_at",
      "submission_identities",
      "next_path",
      "customer_facing_summary"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "submission_outcome_id": {
        "type": "string",
        "pattern": "^submission_outcome:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "outcome_state": {
        "type": "string",
        "enum": [
          "received_with_receipt",
          "rejected_no_receipt",
          "quarantined_no_receipt"
        ]
      },
      "bundle_instance_id": {
        "type": "string",
        "pattern": "^bundle_instance:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "submission_attempt_id": {
        "type": "string",
        "pattern": "^submission_attempt:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "occurred_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "submission_identities": {
        "type": "array",
        "minItems": 1,
        "maxItems": 16,
        "uniqueItems": true,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "identity_type",
            "identity_value"
          ],
          "properties": {
            "identity_type": {
              "type": "string",
              "enum": [
                "manifest_id",
                "evidence_bundle_id",
                "review_request_id",
                "bundle_instance_id",
                "submission_attempt_id"
              ]
            },
            "identity_value": {
              "type": "string",
              "minLength": 1,
              "maxLength": 512
            }
          }
        }
      },
      "failure_reason_codes": {
        "type": "array",
        "maxItems": 64,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9_]{2,63}$"
        }
      },
      "vendor_receipt_ref": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "next_path": {
        "type": "string",
        "enum": [
          "retry",
          "quarantine_support",
          "contact_support",
          "verify_receipt"
        ]
      },
      "customer_facing_summary": {
        "type": "string",
        "minLength": 1,
        "maxLength": 512
      }
    }
  },
  "urn:codeattest:protocol:v0:supporting-evidence-mapping": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:supporting-evidence-mapping",
    "title": "Supporting Evidence Mapping",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "supporting_evidence_mapping_id",
      "mapping_version",
      "review_id",
      "attestation_ref",
      "mapping_profile",
      "approval_state",
      "approved_at",
      "approved_by",
      "decision_authority",
      "acceptance_disclaimer",
      "entries",
      "limitations",
      "visibility",
      "source_derived_class"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "supporting_evidence_mapping_id": {
        "type": "string",
        "pattern": "^supporting_evidence_mapping:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "mapping_version": {
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "attestation_ref": {
        "type": "string",
        "pattern": "^attestation:[a-f0-9]{64}$"
      },
      "mapping_profile": {
        "type": "string",
        "enum": [
          "soc_2_supporting_evidence",
          "generic_technology_risk",
          "customer_security_review"
        ]
      },
      "approval_state": {
        "type": "string",
        "const": "approved"
      },
      "approved_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "approved_by": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "actor_type",
          "actor_id"
        ],
        "properties": {
          "actor_type": {
            "type": "string",
            "const": "reviewer"
          },
          "actor_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "decision_authority": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "acceptance_disclaimer": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "entries": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "mapping_entry_id",
            "topic",
            "supporting_evidence_role",
            "scope_summary",
            "method_summary",
            "receipt_context",
            "evidence_refs",
            "limitations"
          ],
          "properties": {
            "mapping_entry_id": {
              "type": "string",
              "pattern": "^mapping_entry:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "topic": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "supporting_evidence_role": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "scope_summary": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "method_summary": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "receipt_context": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "evidence_refs": {
              "type": "array",
              "maxItems": 10000,
              "minItems": 1,
              "uniqueItems": true,
              "items": {
                "type": "string",
                "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
              }
            },
            "limitations": {
              "type": "array",
              "maxItems": 100,
              "minItems": 1,
              "items": {
                "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
              }
            }
          }
        }
      },
      "limitations": {
        "type": "array",
        "maxItems": 100,
        "minItems": 1,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "visibility": {
        "type": "string",
        "const": "customer_facing"
      },
      "source_derived_class": {
        "type": "string",
        "const": "retained_review_artifact"
      }
    }
  },
  "urn:codeattest:protocol:v0:vendor-receipt": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:vendor-receipt",
    "title": "Vendor Receipt",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "vendor_receipt_id",
      "evidence_bundle_id",
      "manifest_id",
      "receipt_timestamp",
      "receiving_environment",
      "verification_state",
      "canonicalization",
      "identity_hash_algorithm",
      "identity_input_excludes",
      "source_derived_class",
      "approved_outbound_manifest_ref",
      "bundle_instance_id",
      "submission_attempt_id",
      "selected_application",
      "selected_commit",
      "repository_identity_hash",
      "coverage_mode",
      "disclosure_policy_ref",
      "disclosure_policy_summary",
      "approved_artifact_count_summary",
      "received_artifact_count_summary",
      "approved_vs_received_comparison",
      "receipt_signature",
      "public_verification_metadata",
      "key_rotation_readiness"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "vendor_receipt_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "evidence_bundle_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "manifest_id": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "receipt_timestamp": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "receiving_environment": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "environment_profile",
          "evidence_boundary"
        ],
        "properties": {
          "environment_profile": {
            "type": "string",
            "enum": [
              "synthetic_demo",
              "partner_pilot_candidate",
              "partner_pilot_real_snippet_ready"
            ]
          },
          "evidence_boundary": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "verification_state": {
        "type": "string",
        "const": "received_with_receipt"
      },
      "canonicalization": {
        "type": "string",
        "const": "rfc8785"
      },
      "identity_hash_algorithm": {
        "type": "string",
        "const": "sha256"
      },
      "identity_input_excludes": {
        "type": "array",
        "minItems": 3,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "enum": [
            "vendor_receipt_id",
            "receipt_signature",
            "public_verification_metadata.signed_identity"
          ]
        }
      },
      "source_derived_class": {
        "type": "string",
        "const": "retained_review_artifact"
      },
      "approved_outbound_manifest_ref": {
        "type": "string",
        "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "bundle_instance_id": {
        "type": "string",
        "pattern": "^bundle_instance:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "submission_attempt_id": {
        "type": "string",
        "pattern": "^submission_attempt:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "selected_application": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "application_id",
          "display_name"
        ],
        "properties": {
          "application_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "display_name": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "selected_commit": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "commit_sha",
          "source_control_system"
        ],
        "properties": {
          "commit_sha": {
            "type": "string",
            "pattern": "^[a-f0-9]{40}$"
          },
          "source_control_system": {
            "type": "string",
            "enum": [
              "git"
            ]
          }
        }
      },
      "repository_identity_hash": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "coverage_mode": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/coverage_mode"
      },
      "disclosure_policy_ref": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "disclosure_policy_summary": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "disclosure_policy_ref",
          "coverage_mode",
          "redaction_profile",
          "redaction_configuration_version",
          "retention_period"
        ],
        "properties": {
          "disclosure_policy_ref": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
          },
          "coverage_mode": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/coverage_mode"
          },
          "redaction_profile": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "redaction_configuration_version": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "retention_period": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "approved_artifact_count_summary": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "count_domain",
          "total_count",
          "categories"
        ],
        "properties": {
          "count_domain": {
            "type": "string",
            "const": "evidence_category_counts"
          },
          "total_count": {
            "type": "integer",
            "minimum": 0
          },
          "categories": {
            "type": "array",
            "minItems": 1,
            "maxItems": 7,
            "uniqueItems": true,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "category",
                "count"
              ],
              "properties": {
                "category": {
                  "type": "string",
                  "enum": [
                    "metadata",
                    "dependencies",
                    "scanner_findings",
                    "raw_snippets",
                    "targeted_files",
                    "derived_artifacts",
                    "never_collected_items"
                  ]
                },
                "count": {
                  "type": "integer",
                  "minimum": 0
                }
              }
            }
          }
        }
      },
      "received_artifact_count_summary": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "count_domain",
          "total_count",
          "categories"
        ],
        "properties": {
          "count_domain": {
            "type": "string",
            "const": "evidence_category_counts"
          },
          "total_count": {
            "type": "integer",
            "minimum": 0
          },
          "categories": {
            "type": "array",
            "minItems": 1,
            "maxItems": 7,
            "uniqueItems": true,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "category",
                "count"
              ],
              "properties": {
                "category": {
                  "type": "string",
                  "enum": [
                    "metadata",
                    "dependencies",
                    "scanner_findings",
                    "raw_snippets",
                    "targeted_files",
                    "derived_artifacts",
                    "never_collected_items"
                  ]
                },
                "count": {
                  "type": "integer",
                  "minimum": 0
                }
              }
            }
          }
        }
      },
      "approved_vs_received_comparison": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "comparison_state",
          "rows"
        ],
        "properties": {
          "comparison_state": {
            "type": "string",
            "const": "matched"
          },
          "rows": {
            "type": "array",
            "minItems": 7,
            "maxItems": 7,
            "allOf": [
              {
                "contains": {
                  "properties": {
                    "field": {
                      "const": "manifest_id"
                    }
                  },
                  "required": [
                    "field"
                  ]
                },
                "minContains": 1,
                "maxContains": 1
              },
              {
                "contains": {
                  "properties": {
                    "field": {
                      "const": "evidence_bundle_id"
                    }
                  },
                  "required": [
                    "field"
                  ]
                },
                "minContains": 1,
                "maxContains": 1
              },
              {
                "contains": {
                  "properties": {
                    "field": {
                      "const": "selected_commit"
                    }
                  },
                  "required": [
                    "field"
                  ]
                },
                "minContains": 1,
                "maxContains": 1
              },
              {
                "contains": {
                  "properties": {
                    "field": {
                      "const": "repository_identity_hash"
                    }
                  },
                  "required": [
                    "field"
                  ]
                },
                "minContains": 1,
                "maxContains": 1
              },
              {
                "contains": {
                  "properties": {
                    "field": {
                      "const": "coverage_mode"
                    }
                  },
                  "required": [
                    "field"
                  ]
                },
                "minContains": 1,
                "maxContains": 1
              },
              {
                "contains": {
                  "properties": {
                    "field": {
                      "const": "artifact_count_summary"
                    }
                  },
                  "required": [
                    "field"
                  ]
                },
                "minContains": 1,
                "maxContains": 1
              },
              {
                "contains": {
                  "properties": {
                    "field": {
                      "const": "disclosure_policy_summary"
                    }
                  },
                  "required": [
                    "field"
                  ]
                },
                "minContains": 1,
                "maxContains": 1
              }
            ],
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "field",
                "approved_value",
                "received_value",
                "result"
              ],
              "properties": {
                "field": {
                  "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
                },
                "approved_value": {
                  "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
                },
                "received_value": {
                  "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
                },
                "result": {
                  "type": "string",
                  "const": "matched"
                }
              }
            }
          }
        }
      },
      "receipt_signature": {
        "$ref": "urn:codeattest:protocol:v0:signature-envelope"
      },
      "public_verification_metadata": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "protocol_version",
          "algorithm_profile",
          "canonicalization",
          "key_id",
          "key_version",
          "public_key_reference",
          "signing_time",
          "signed_identity_type",
          "signed_identity",
          "signing_mode",
          "signing_limitations"
        ],
        "properties": {
          "protocol_version": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
          },
          "algorithm_profile": {
            "type": "string",
            "const": "ml_dsa_65"
          },
          "canonicalization": {
            "type": "string",
            "const": "rfc8785"
          },
          "key_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "key_version": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "public_key_reference": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "signing_time": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
          },
          "signed_identity_type": {
            "type": "string",
            "const": "vendor_receipt"
          },
          "signed_identity": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
          },
          "signing_mode": {
            "type": "string",
            "enum": [
              "managed_key",
              "enrolled_runner_key"
            ]
          },
          "signing_limitations": {
            "type": "array",
            "maxItems": 100,
            "minItems": 1,
            "items": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
            }
          }
        }
      },
      "key_rotation_readiness": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "historical_key_id",
          "historical_key_version",
          "event_append_hint"
        ],
        "properties": {
          "historical_key_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "historical_key_version": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "event_append_hint": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      }
    }
  },
  "urn:codeattest:protocol:v0:verification-addendum": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:verification-addendum",
    "title": "Verification Addendum",
    "type": "object",
    "additionalProperties": false,
    "allOf": [
      {
        "if": {
          "properties": {
            "findings": {
              "contains": {
                "properties": {
                  "verification_status": {
                    "enum": [
                      "verification_pending",
                      "requires_customer_side_validation"
                    ]
                  }
                },
                "required": [
                  "verification_status"
                ]
              }
            }
          },
          "required": [
            "findings"
          ]
        },
        "then": {
          "required": [
            "next_step_summary"
          ],
          "properties": {
            "finalization_state": {
              "const": "not_finalized"
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "finalization_state": {
              "const": "not_finalized"
            }
          },
          "required": [
            "finalization_state"
          ]
        },
        "then": {
          "required": [
            "next_step_summary"
          ]
        }
      }
    ],
    "required": [
      "protocol_version",
      "verification_addendum_id",
      "review_id",
      "verification_pass_id",
      "review_scope_ref",
      "verification_pass_ref",
      "selected_commit",
      "repository_identity",
      "generated_at",
      "findings",
      "retained_evidence",
      "deleted_evidence",
      "history_refs",
      "limitations",
      "finalization_state",
      "visibility",
      "source_derived_class"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "verification_addendum_id": {
        "type": "string",
        "pattern": "^verification_addendum:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "verification_pass_id": {
        "type": "string",
        "pattern": "^verification_pass:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "review_scope_ref": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "verification_pass_ref": {
        "type": "string",
        "pattern": "^verification_pass:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "selected_commit": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "commit_sha",
          "source_control_system"
        ],
        "properties": {
          "commit_sha": {
            "type": "string",
            "pattern": "^[a-f0-9]{40}$"
          },
          "source_control_system": {
            "type": "string",
            "const": "git"
          }
        }
      },
      "repository_identity": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
      },
      "generated_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "findings": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "allOf": [
            {
              "if": {
                "properties": {
                  "verification_status": {
                    "const": "verification_complete"
                  }
                },
                "required": [
                  "verification_status"
                ]
              },
              "else": {
                "required": [
                  "next_step_summary"
                ]
              }
            }
          ],
          "required": [
            "review_finding_draft_ref",
            "classification_record_ref",
            "current_classification",
            "verification_status",
            "reviewer_actor_category",
            "verification_record_ref",
            "verification_evidence_record_refs",
            "timestamp",
            "summary",
            "remaining_limitations"
          ],
          "properties": {
            "review_finding_draft_ref": {
              "type": "string",
              "pattern": "^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "classification_record_ref": {
              "type": "string",
              "pattern": "^classification_record:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "current_classification": {
              "type": "string",
              "enum": [
                "likely",
                "confirmed",
                "inconclusive",
                "requires_customer_side_validation"
              ]
            },
            "verification_status": {
              "type": "string",
              "enum": [
                "verification_complete",
                "verification_pending",
                "not_verified",
                "requires_customer_side_validation"
              ]
            },
            "reviewer_actor_category": {
              "type": "string",
              "const": "reviewer"
            },
            "verification_record_ref": {
              "type": "string",
              "pattern": "^verification_record:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "verification_evidence_record_refs": {
              "type": "array",
              "maxItems": 10000,
              "minItems": 1,
              "uniqueItems": true,
              "items": {
                "type": "string",
                "pattern": "^verification_evidence:[a-z0-9][a-z0-9_-]{2,63}$"
              }
            },
            "remediation_guidance_ref": {
              "type": "string",
              "pattern": "^remediation_guidance:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "validation_path_ref": {
              "type": "string",
              "pattern": "^validation_path:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "accepted_risk_record_ref": {
              "type": "string",
              "pattern": "^accepted_risk:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "false_positive_record_ref": {
              "type": "string",
              "pattern": "^false_positive:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "timestamp": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
            },
            "summary": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "remaining_limitations": {
              "type": "array",
              "maxItems": 100,
              "minItems": 1,
              "items": {
                "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
              }
            },
            "next_step_summary": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            }
          }
        }
      },
      "retained_evidence": {
        "type": "array",
        "maxItems": 10000,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "artifact_ref",
            "source_derived_class",
            "recorded_at"
          ],
          "properties": {
            "artifact_ref": {
              "type": "string",
              "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "source_derived_class": {
              "type": "string",
              "enum": [
                "retained_review_artifact",
                "customer_opt_in_retained_source"
              ]
            },
            "recorded_at": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
            }
          }
        }
      },
      "deleted_evidence": {
        "type": "array",
        "maxItems": 10000,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "artifact_ref",
            "deletion_evidence_ref",
            "deletion_timestamp",
            "deletion_verification_status"
          ],
          "properties": {
            "artifact_ref": {
              "type": "string",
              "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "deletion_evidence_ref": {
              "type": "string",
              "pattern": "^deletion_evidence:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "deletion_timestamp": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
            },
            "deletion_verification_status": {
              "type": "string",
              "enum": [
                "verified",
                "pending",
                "unavailable"
              ]
            }
          }
        }
      },
      "history_refs": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "uniqueItems": true,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
        }
      },
      "limitations": {
        "type": "array",
        "maxItems": 100,
        "minItems": 1,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "next_step_summary": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "finalization_state": {
        "type": "string",
        "enum": [
          "finalized",
          "not_finalized"
        ]
      },
      "visibility": {
        "type": "string",
        "const": "customer_facing"
      },
      "source_derived_class": {
        "type": "string",
        "const": "retained_review_artifact"
      }
    }
  },
  "urn:codeattest:protocol:v0:verification-evidence-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:verification-evidence-record",
    "title": "Verification Evidence Record",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "review_id",
      "verification_evidence_record_id",
      "record_version",
      "verification_pass_id",
      "verification_pass_ref",
      "scope_version",
      "review_finding_draft_ref",
      "classification_record_ref",
      "requested_verification_type",
      "intake_state",
      "state_reason",
      "actor",
      "recorded_at",
      "access_scope",
      "environment_profile",
      "disclosure_state",
      "limitations",
      "source_derived_class",
      "visibility"
    ],
    "allOf": [
      {
        "if": {
          "properties": {
            "requested_verification_type": {
              "const": "follow_up_commit"
            }
          }
        },
        "then": {
          "required": [
            "follow_up_commit"
          ]
        }
      },
      {
        "if": {
          "properties": {
            "requested_verification_type": {
              "enum": [
                "customer_validation_evidence",
                "reviewer_authored_script_output",
                "manual_validation_record",
                "remote_dynamic_testing_evidence"
              ]
            }
          }
        },
        "then": {
          "required": [
            "validation_path_ref",
            "validation_artifacts"
          ]
        }
      },
      {
        "if": {
          "properties": {
            "requested_verification_type": {
              "const": "reviewer_authored_script_output"
            }
          }
        },
        "then": {
          "required": [
            "reviewer_validation_script_ref"
          ]
        }
      }
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "verification_evidence_record_id": {
        "type": "string",
        "pattern": "^verification_evidence:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "record_version": {
        "type": "integer",
        "minimum": 1
      },
      "verification_pass_id": {
        "type": "string",
        "pattern": "^verification_pass:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "verification_pass_ref": {
        "type": "string",
        "pattern": "^verification_pass:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "scope_version": {
        "type": "integer",
        "minimum": 1
      },
      "review_finding_draft_ref": {
        "type": "string",
        "pattern": "^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "classification_record_ref": {
        "type": "string",
        "pattern": "^classification_record:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "requested_verification_type": {
        "type": "string",
        "enum": [
          "follow_up_commit",
          "customer_validation_evidence",
          "reviewer_authored_script_output",
          "manual_validation_record",
          "remote_dynamic_testing_evidence"
        ]
      },
      "intake_state": {
        "type": "string",
        "enum": [
          "accepted_for_review",
          "verification_pending",
          "broader_context_required"
        ]
      },
      "state_reason": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "next_step_summary": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "actor": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "actor_type",
          "actor_id"
        ],
        "properties": {
          "actor_type": {
            "type": "string",
            "enum": [
              "customer_user",
              "vendor_service"
            ]
          },
          "actor_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "customer_actor_ref": {
        "type": "string",
        "pattern": "^customer:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "follow_up_commit": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "original_selected_commit",
          "follow_up_commit",
          "original_repository_identity",
          "follow_up_repository_identity",
          "relationship_to_selected_commit",
          "relationship_basis"
        ],
        "properties": {
          "original_selected_commit": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "commit_sha",
              "source_control_system"
            ],
            "properties": {
              "commit_sha": {
                "type": "string",
                "pattern": "^[a-f0-9]{40}$"
              },
              "source_control_system": {
                "type": "string",
                "const": "git"
              }
            }
          },
          "follow_up_commit": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "commit_sha",
              "source_control_system"
            ],
            "properties": {
              "commit_sha": {
                "type": "string",
                "pattern": "^[a-f0-9]{40}$"
              },
              "source_control_system": {
                "type": "string",
                "const": "git"
              }
            }
          },
          "original_repository_identity": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
          },
          "follow_up_repository_identity": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/algorithm_prefixed_sha256_id"
          },
          "relationship_to_selected_commit": {
            "type": "string",
            "enum": [
              "customer_declared_related",
              "customer_declared_descendant",
              "relationship_unverified",
              "same_commit_submitted",
              "repository_mismatch"
            ]
          },
          "relationship_basis": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "validation_path_ref": {
        "type": "string",
        "pattern": "^validation_path:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "reviewer_validation_script_ref": {
        "type": "string",
        "pattern": "^validation_script:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "validation_artifacts": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "uniqueItems": true,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "artifact_ref",
            "digest",
            "size_bytes",
            "media_type",
            "source_derived_class"
          ],
          "properties": {
            "artifact_ref": {
              "type": "string",
              "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "digest": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/artifact_digest"
            },
            "size_bytes": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "media_type": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "source_derived_class": {
              "$ref": "urn:codeattest:protocol:v0:retention-source-derived-class"
            },
            "retention_record_ref": {
              "type": "string",
              "pattern": "^retention_record:[a-z0-9][a-z0-9_-]{2,63}$"
            }
          }
        }
      },
      "recorded_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "access_scope": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "tenant_id",
          "review_scope"
        ],
        "properties": {
          "tenant_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "review_scope": {
            "type": "string",
            "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
          }
        }
      },
      "environment_profile": {
        "type": "string",
        "enum": [
          "synthetic_demo",
          "partner_pilot_candidate",
          "partner_pilot_real_snippet_ready"
        ]
      },
      "disclosure_state": {
        "type": "string",
        "const": "metadata_only"
      },
      "limitations": {
        "type": "array",
        "maxItems": 100,
        "minItems": 1,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "source_derived_class": {
        "type": "string",
        "const": "retained_review_artifact"
      },
      "visibility": {
        "type": "string",
        "enum": [
          "customer_facing",
          "internal_only"
        ]
      }
    }
  },
  "urn:codeattest:protocol:v0:verification-pass-scope": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:verification-pass-scope",
    "title": "Verification Pass Scope",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol_version",
      "review_id",
      "verification_pass_id",
      "scope_version",
      "included_pass_started_at",
      "scope_recorded_at",
      "pass_deadline",
      "actor",
      "selected_findings",
      "included_script_allocation",
      "limitations",
      "source_derived_class",
      "visibility"
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "verification_pass_id": {
        "type": "string",
        "pattern": "^verification_pass:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "scope_version": {
        "type": "integer",
        "minimum": 1
      },
      "included_pass_started_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "included_pass_start_basis": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "scope_recorded_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "pass_deadline": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "actor": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "actor_type",
          "actor_id"
        ],
        "properties": {
          "actor_type": {
            "type": "string",
            "enum": [
              "customer_user",
              "reviewer",
              "vendor_service"
            ]
          },
          "actor_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "customer_actor_ref": {
        "type": "string",
        "pattern": "^customer:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "customer_selection_evidence_ref": {
        "type": "string",
        "pattern": "^customer_selection:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "selected_findings": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "review_finding_draft_ref",
            "classification_record_ref",
            "current_classification",
            "requested_verification_type",
            "eligibility_state",
            "eligibility_reason",
            "limitations"
          ],
          "properties": {
            "review_finding_draft_ref": {
              "type": "string",
              "pattern": "^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "classification_record_ref": {
              "type": "string",
              "pattern": "^classification_record:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "current_classification": {
              "type": "string",
              "enum": [
                "likely",
                "confirmed",
                "inconclusive",
                "requires_customer_side_validation"
              ]
            },
            "remediation_guidance_ref": {
              "type": "string",
              "pattern": "^remediation_guidance:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "customer_status_record_ref": {
              "type": "string",
              "pattern": "^customer_status:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "current_customer_remediation_status": {
              "type": "string",
              "enum": [
                "not_started",
                "planned",
                "in_progress",
                "remediated_by_customer",
                "validation_pending",
                "deferred",
                "not_applicable"
              ]
            },
            "validation_path_ref": {
              "type": "string",
              "pattern": "^validation_path:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "reviewer_validation_script_refs": {
              "type": "array",
              "maxItems": 10000,
              "minItems": 1,
              "uniqueItems": true,
              "items": {
                "type": "string",
                "pattern": "^validation_script:[a-z0-9][a-z0-9_-]{2,63}$"
              }
            },
            "accepted_risk_record_ref": {
              "type": "string",
              "pattern": "^accepted_risk:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "false_positive_record_ref": {
              "type": "string",
              "pattern": "^false_positive:[a-z0-9][a-z0-9_-]{2,63}$"
            },
            "requested_verification_type": {
              "type": "string",
              "enum": [
                "follow_up_commit",
                "customer_validation_evidence",
                "reviewer_authored_script_output",
                "manual_validation_record",
                "remote_dynamic_testing_evidence"
              ]
            },
            "eligibility_state": {
              "type": "string",
              "enum": [
                "eligible",
                "out_of_scope",
                "requires_additional_agreement",
                "blocked_pending_validation_path"
              ]
            },
            "eligibility_reason": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
            },
            "limitations": {
              "type": "array",
              "maxItems": 100,
              "minItems": 1,
              "items": {
                "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
              }
            }
          }
        }
      },
      "included_script_allocation": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "included_slots",
          "additional_script_candidates"
        ],
        "properties": {
          "included_slots": {
            "type": "array",
            "maxItems": 3,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "slot",
                "validation_script_ref",
                "finding_ref"
              ],
              "properties": {
                "slot": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 3
                },
                "validation_script_ref": {
                  "type": "string",
                  "pattern": "^validation_script:[a-z0-9][a-z0-9_-]{2,63}$"
                },
                "finding_ref": {
                  "type": "string",
                  "pattern": "^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$"
                }
              }
            }
          },
          "additional_script_candidates": {
            "type": "array",
            "maxItems": 10000,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "validation_script_ref",
                "finding_ref",
                "pricing_posture",
                "reason"
              ],
              "properties": {
                "validation_script_ref": {
                  "type": "string",
                  "pattern": "^validation_script:[a-z0-9][a-z0-9_-]{2,63}$"
                },
                "finding_ref": {
                  "type": "string",
                  "pattern": "^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$"
                },
                "pricing_posture": {
                  "type": "string",
                  "const": "pricing_tbd"
                },
                "reason": {
                  "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
                }
              }
            }
          }
        }
      },
      "limitations": {
        "type": "array",
        "maxItems": 100,
        "minItems": 1,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "source_derived_class": {
        "type": "string",
        "const": "retained_review_artifact"
      },
      "visibility": {
        "type": "string",
        "enum": [
          "customer_facing",
          "internal_only"
        ]
      }
    }
  },
  "urn:codeattest:protocol:v0:verification-record": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:codeattest:protocol:v0:verification-record",
    "title": "Verification Record",
    "type": "object",
    "additionalProperties": false,
    "x-typescript-conditional-required": true,
    "required": [
      "protocol_version",
      "review_id",
      "verification_record_id",
      "record_version",
      "verification_pass_id",
      "verification_pass_ref",
      "review_finding_draft_ref",
      "classification_record_ref",
      "verification_evidence_record_refs",
      "verification_status",
      "recorded_at",
      "actor",
      "before_state",
      "after_state",
      "rationale",
      "remaining_limitations",
      "source_derived_class",
      "visibility"
    ],
    "allOf": [
      {
        "if": {
          "properties": {
            "verification_status": {
              "enum": [
                "verification_pending",
                "not_verified",
                "requires_customer_side_validation"
              ]
            }
          }
        },
        "then": {
          "required": [
            "next_step_summary"
          ]
        }
      },
      {
        "if": {
          "properties": {
            "verification_status": {
              "const": "verification_complete"
            }
          },
          "required": [
            "verification_status"
          ]
        },
        "then": {
          "properties": {
            "after_state": {
              "properties": {
                "criteria_results": {
                  "items": {
                    "properties": {
                      "result": {
                        "const": "satisfied"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "verification_status": {
              "const": "verification_pending"
            }
          },
          "required": [
            "verification_status"
          ]
        },
        "then": {
          "properties": {
            "after_state": {
              "properties": {
                "criteria_results": {
                  "contains": {
                    "properties": {
                      "result": {
                        "const": "not_evaluated"
                      }
                    },
                    "required": [
                      "result"
                    ]
                  },
                  "minContains": 1
                }
              }
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "verification_status": {
              "const": "not_verified"
            }
          },
          "required": [
            "verification_status"
          ]
        },
        "then": {
          "properties": {
            "after_state": {
              "properties": {
                "criteria_results": {
                  "contains": {
                    "properties": {
                      "result": {
                        "const": "not_satisfied"
                      }
                    },
                    "required": [
                      "result"
                    ]
                  },
                  "minContains": 1
                }
              }
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "verification_status": {
              "const": "requires_customer_side_validation"
            }
          },
          "required": [
            "verification_status"
          ]
        },
        "then": {
          "properties": {
            "after_state": {
              "properties": {
                "criteria_results": {
                  "contains": {
                    "properties": {
                      "result": {
                        "const": "customer_validation_required"
                      }
                    },
                    "required": [
                      "result"
                    ]
                  },
                  "minContains": 1
                }
              }
            }
          }
        }
      }
    ],
    "properties": {
      "protocol_version": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/protocol_version"
      },
      "review_id": {
        "type": "string",
        "pattern": "^review:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "verification_record_id": {
        "type": "string",
        "pattern": "^verification_record:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "record_version": {
        "type": "integer",
        "minimum": 1
      },
      "verification_pass_id": {
        "type": "string",
        "pattern": "^verification_pass:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "verification_pass_ref": {
        "type": "string",
        "pattern": "^verification_pass:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "review_finding_draft_ref": {
        "type": "string",
        "pattern": "^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "classification_record_ref": {
        "type": "string",
        "pattern": "^classification_record:[a-z0-9][a-z0-9_-]{2,63}$"
      },
      "verification_evidence_record_refs": {
        "type": "array",
        "maxItems": 10000,
        "minItems": 1,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "pattern": "^verification_evidence:[a-z0-9][a-z0-9_-]{2,63}$"
        }
      },
      "verification_status": {
        "type": "string",
        "enum": [
          "verification_complete",
          "verification_pending",
          "not_verified",
          "requires_customer_side_validation"
        ]
      },
      "recorded_at": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/utc_rfc3339_timestamp"
      },
      "actor": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "actor_type",
          "actor_id"
        ],
        "properties": {
          "actor_type": {
            "type": "string",
            "const": "reviewer"
          },
          "actor_id": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          }
        }
      },
      "before_state": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "classification",
          "review_finding_draft_evidence_refs",
          "evidence_basis",
          "source_reference_state",
          "confirmation_criteria"
        ],
        "properties": {
          "classification": {
            "type": "string",
            "enum": [
              "likely",
              "confirmed",
              "inconclusive",
              "requires_customer_side_validation"
            ]
          },
          "review_finding_draft_evidence_refs": {
            "type": "array",
            "maxItems": 10000,
            "minItems": 1,
            "items": {
              "type": "string",
              "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
            }
          },
          "evidence_basis": {
            "type": "array",
            "maxItems": 100,
            "minItems": 1,
            "items": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
            }
          },
          "source_reference_state": {
            "type": "string",
            "enum": [
              "retained_review_artifact",
              "deleted_under_policy",
              "never_collected",
              "not_submitted_by_policy",
              "unresolved_reference"
            ]
          },
          "confirmation_criteria": {
            "type": "array",
            "maxItems": 100,
            "minItems": 1,
            "items": {
              "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
            }
          }
        }
      },
      "after_state": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "summary",
          "criteria_results",
          "evidence_refs"
        ],
        "properties": {
          "summary": {
            "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
          },
          "criteria_results": {
            "type": "array",
            "maxItems": 10000,
            "minItems": 1,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "criterion",
                "result"
              ],
              "properties": {
                "criterion": {
                  "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
                },
                "result": {
                  "type": "string",
                  "enum": [
                    "satisfied",
                    "not_satisfied",
                    "not_evaluated",
                    "customer_validation_required"
                  ]
                }
              }
            }
          },
          "evidence_refs": {
            "type": "array",
            "maxItems": 10000,
            "minItems": 1,
            "items": {
              "type": "string",
              "pattern": "^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$"
            }
          }
        }
      },
      "rationale": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "remaining_limitations": {
        "type": "array",
        "maxItems": 100,
        "minItems": 1,
        "items": {
          "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/narrative_string"
        }
      },
      "next_step_summary": {
        "$ref": "urn:codeattest:protocol:v0:shared-definitions#/$defs/non_empty_string"
      },
      "source_derived_class": {
        "type": "string",
        "const": "retained_review_artifact"
      },
      "visibility": {
        "type": "string",
        "enum": [
          "customer_facing",
          "internal_only"
        ]
      }
    }
  },
} as const;

export type ProtocolV0SchemaId = keyof typeof protocolV0Schemas;
