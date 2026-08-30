# Generated Protocol Bindings

This directory contains schema-derived TypeScript output generated from `protocol/schemas/`.

Regenerate with:

```sh
npm run generate --workspace @onevps/protocol-ts
```

Do not hand-author protocol semantics here. `protocol/` remains the product-truth center, and `npm run bindings:check` fails when generated output or source schema hashes drift.
