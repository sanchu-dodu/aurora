import {
  redactSensitiveValue,
  redactText,
} from "../security/secretRedactor.js";

import type {
  OperationPlan,
} from "./operationPlan.js";

import type {
  OperationReport,
} from "./operationReport.js";

export function printOperationPlan(
  plan: OperationPlan,
  json = false
): void {
  if (json) {
    console.log(
      JSON.stringify(
        redactSensitiveValue(
          plan
        ),
        null,
        2
      )
    );
    return;
  }

  console.log("");
  console.log("Aurora Operation Plan");
  console.log("=====================");
  console.log(
    `Plan: ${plan.id}`
  );
  console.log(
    `Summary: ${redactText(plan.summary)}`
  );
  console.log(
    `Expires: ${plan.expiresAt}`
  );
  console.log("");

  for (
    const operation
    of plan.operations
  ) {
    const target =
      "path" in operation
        ? ` (${operation.path})`
        : "";

    console.log(
      `${operation.id}: ${operation.kind}${target} [${operation.risk}]`
    );
    console.log(
      `  ${redactText(operation.description)}`
    );
  }
}

export function printApplyResult(
  result: OperationReport,
  json = false
): void {
  if (json) {
    console.log(
      JSON.stringify(
        result,
        null,
        2
      )
    );
    return;
  }

  if (
    result.status === "dry-run"
  ) {
    console.log(
      `Dry run validated ${result.totals.validated} operation(s); no changes were made.`
    );
    console.log(
      `Report: ${result.reportId}`
    );
    return;
  }

  console.log(
    `Applied ${result.totals.applied} operation(s) from ${result.planId}.`
  );
  console.log(
    `Report: ${result.reportId}`
  );
}
