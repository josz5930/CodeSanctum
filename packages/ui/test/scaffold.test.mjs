import { assertWorkspaceScaffold } from "../../../scripts/scaffold-test-helpers.mjs";

await assertWorkspaceScaffold(new URL("..", import.meta.url));
