export const ErrorCodes = {
  TEMPLATE_NOT_FOUND:
    "TEMPLATE_NOT_FOUND",

  UNKNOWN_PLUGIN_ACTION:
    "UNKNOWN_PLUGIN_ACTION",

  UNKNOWN_CONFIGURATION_KEY:
    "UNKNOWN_CONFIGURATION_KEY",

  DOCTOR_CHECK_FAILED:
    "DOCTOR_CHECK_FAILED",

  UNSAFE_PROJECT_PATH:
    "UNSAFE_PROJECT_PATH",
} as const;

export type AuroraErrorCode =
  typeof ErrorCodes[
    keyof typeof ErrorCodes
  ];
