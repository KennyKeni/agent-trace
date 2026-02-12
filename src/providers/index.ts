import { registerProvider } from "../core/trace-hook";
import * as claude from "./claude";
import * as cursor from "./cursor";
import * as opencode from "./opencode";

registerProvider("claude", {
  ...claude,
  toolInfo: () => ({ name: "claude-code" }),
});

registerProvider("cursor", {
  ...cursor,
  toolInfo: () => ({ name: "cursor", version: process.env.CURSOR_VERSION }),
});

registerProvider("opencode", {
  ...opencode,
  toolInfo: () => ({ name: "opencode" }),
});
