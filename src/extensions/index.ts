import { registerExtension } from "../core/registry";
import { diffsExtension } from "./diffs";
import { lineHashesExtension } from "./line-hashes";
import { messagesExtension } from "./messages";

export function registerBuiltinExtensions(): void {
  registerExtension(diffsExtension);
  registerExtension(messagesExtension);
  registerExtension(lineHashesExtension);
}
