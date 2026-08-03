import test from "node:test";
import assert from "node:assert/strict";

import { DependencyGraph } from "../../dist/packages/graph/dependencyGraph.js";
import { DependencyAnalyzer } from "../../dist/packages/graph/dependencyAnalyzer.js";
import { InstallationScheduler } from "../../dist/packages/installation/installationScheduler.js";

test(
  "InstallationScheduler returns no batches for an empty graph",
  () => {
    const graph = new DependencyGraph();
    const scheduler = new InstallationScheduler(graph);

    assert.deepEqual(
      scheduler.createBatches(),
      []
    );
  }
);

test(
  "InstallationScheduler groups independent packages together",
  () => {
    const graph = new DependencyGraph();

    graph.addPackage("database", []);
    graph.addPackage("logging", []);

    const scheduler = new InstallationScheduler(graph);

    assert.deepEqual(
      scheduler.createBatches(),
      [
        [
          "database",
          "logging",
        ],
      ]
    );
  }
);

test(
  "InstallationScheduler respects dependency ordering",
  () => {
    const graph = new DependencyGraph();

    graph.addPackage("database", []);
    graph.addPackage("logging", []);
    graph.addPackage("auth", ["database"]);
    graph.addPackage(
      "dashboard",
      [
        "auth",
        "logging",
      ]
    );

    const scheduler = new InstallationScheduler(graph);

    assert.deepEqual(
      scheduler.createBatches(),
      [
        [
          "database",
          "logging",
        ],
        [
          "auth",
        ],
        [
          "dashboard",
        ],
      ]
    );
  }
);

test(
  "DependencyAnalyzer rejects circular dependency graphs",
  () => {
    const graph = new DependencyGraph();

    graph.addPackage(
      "auth",
      ["database"]
    );

    graph.addPackage(
      "database",
      ["auth"]
    );

    const analyzer =
      new DependencyAnalyzer(graph);

    assert.throws(
      () => {
        analyzer.checkCircularDependencies();
      },
      /Circular dependency detected/
    );
  }
);
