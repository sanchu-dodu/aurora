export async function loadModules(
  modules: string[]
): Promise<void> {

  for (const modulePath of modules) {

    await import(modulePath);

  }

}