import { registerExtension } from "../core/registry";
import { diffsExtension } from "./diffs";
import { lineHashesExtension } from "./line-hashes";
import { messagesExtension } from "./messages";
import { rawEventsExtension } from "./raw-events";

export function registerBuiltinExtensions(): void {
  registerExtension(rawEventsExtension);
  registerExtension(diffsExtension);
  registerExtension(messagesExtension);
  registerExtension(lineHashesExtension);
}
