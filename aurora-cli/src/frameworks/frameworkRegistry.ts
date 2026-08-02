import { FrameworkAdapter } from "./frameworkAdapter.js";
import { NextJsAdapter } from "./nextjsAdapter.js";

const adapters =
  new Map<
    string,
    FrameworkAdapter
  >();

adapters.set(
  "nextjs",
  new NextJsAdapter()
);

export function getFrameworkAdapter(
  framework: string
): FrameworkAdapter {

  const adapter =
    adapters.get(framework);

  if (!adapter) {

    throw new Error(
      `Unsupported framework: ${framework}`
    );

  }

  return adapter;

}