import type {
  ExtensionContext,
} from "../runtime/extensions/extensionWorkerProtocol.js";

export async function activate(
  context: ExtensionContext
): Promise<void> {
  await context.output.write(
    "✔ Hello extension activated in its worker."
  );
}

export async function deactivate(
  context: ExtensionContext
): Promise<void> {
  await context.output.write(
    "Hello extension worker stopped."
  );
}
