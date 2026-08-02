import { SearchService } from "./searchService.js";

export async function searchPackages(
  query: string
): Promise<void> {

  const service =
    new SearchService();

  const results =
    await service.search(query);

  if (results.length === 0) {

    console.log("No packages found.");

    return;

  }

  console.log("");

  console.log("Packages");

  console.log("--------------------------");

  for (const pkg of results) {

    console.log(
      `${pkg.name} (${pkg.version})`
    );

    console.log(pkg.description);

    console.log("");

  }

}