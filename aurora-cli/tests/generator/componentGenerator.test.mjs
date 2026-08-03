import test from "node:test";
import assert from "node:assert/strict";

import {
  access,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";

import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  discoverTemplates,
  getTemplate,
} from "../../dist/templates/registry/templateRegistry.js";

import {
  getDefaultGeneratorTemplateRoot,
} from "../../dist/templates/templatePaths.js";

import {
  registerAllGenerators,
} from "../../dist/generator/registry/registerGenerators.js";

import {
  listGenerators,
} from "../../dist/generator/registry/generatorRegistry.js";

import {
  ComponentGenerator,
} from "../../dist/generator/componentGenerator.js";

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

test(
  "Generator templates are discovered independently of the working directory",
  async () => {
    const temporaryDirectory =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-generator-discovery-"
        )
      );

    const previousDirectory =
      process.cwd();

    try {
      process.chdir(
        temporaryDirectory
      );

      await discoverTemplates();

      const metadata =
        getTemplate("component");

      assert.equal(
        metadata.framework,
        "react"
      );

      assert.equal(
        metadata.output,
        "src/components"
      );

      registerAllGenerators();

      assert.deepEqual(
        listGenerators().map(
          (generator) =>
            generator.id
        ),
        [
          "component",
        ]
      );

      assert.equal(
        await exists(
          getDefaultGeneratorTemplateRoot()
        ),
        true
      );
    } finally {
      process.chdir(
        previousDirectory
      );

      await rm(
        temporaryDirectory,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "ComponentGenerator writes a component into an external project",
  async () => {
    const projectRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-component-project-"
        )
      );

    try {
      await discoverTemplates();

      const generator =
        new ComponentGenerator();

      await generator.generate(
        projectRoot,
        "Header"
      );

      const generatedFile =
        join(
          projectRoot,
          "src",
          "components",
          "Header.tsx"
        );

      assert.equal(
        await exists(generatedFile),
        true
      );

      const content =
        await readFile(
          generatedFile,
          "utf8"
        );

      assert.match(
        content,
        /function Header/
      );

      assert.equal(
        content.includes(
          "{{ComponentName}}"
        ),
        false
      );
    } finally {
      await rm(
        projectRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "ComponentGenerator rejects unsafe component names",
  async () => {
    const projectRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-unsafe-component-"
        )
      );

    try {
      await discoverTemplates();

      const generator =
        new ComponentGenerator();

      await assert.rejects(
        generator.generate(
          projectRoot,
          "../Escaped"
        ),
        /valid JavaScript identifier/
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            "Escaped.tsx"
          )
        ),
        false
      );
    } finally {
      await rm(
        projectRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);
