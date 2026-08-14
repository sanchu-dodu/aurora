import type {
  KeyObject,
} from "node:crypto";

import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import {
  isCanonicalPackageIdentifier,
} from "../manifestSchema.js";

import {
  fingerprintEncodedEd25519PublicKey,
  importEd25519PublicKeySpki,
} from "./packageSigningKey.js";

import {
  PACKAGE_SIGNING_ALGORITHM,
  type TrustedPublisher,
} from "./packageTrustTypes.js";

interface StoredSigningKey {
  readonly keyId: string;

  readonly publicKey:
    KeyObject;

  readonly status:
    "trusted" |
    "revoked";

  readonly reason?:
    string;
}

interface StoredPublisher {
  readonly id: string;

  readonly status:
    "trusted" |
    "revoked";

  readonly reason?:
    string;

  readonly keys:
    ReadonlyMap<
      string,
      StoredSigningKey
    >;
}

export class PackageTrustStore {
  private readonly publishers =
    new Map<
      string,
      StoredPublisher
    >();

  constructor(
    publishers:
      readonly TrustedPublisher[] = []
  ) {
    const keyOwners =
      new Map<
        string,
        string
      >();

    for (
      const publisher
      of publishers
    ) {
      if (
        !isCanonicalPackageIdentifier(
          publisher.id
        )
      ) {
        throw new TypeError(
          `Invalid trusted publisher id '${publisher.id}'.`
        );
      }

      if (
        this.publishers.has(
          publisher.id
        )
      ) {
        throw new TypeError(
          `Duplicate trusted publisher '${publisher.id}'.`
        );
      }

      assertTrustStatus(
        publisher.status,
        `publisher '${publisher.id}'`
      );

      assertRevocationReason(
        publisher.status,
        publisher.reason,
        `publisher '${publisher.id}'`
      );

      if (
        !Array.isArray(
          publisher.keys
        ) ||
        publisher.keys.length ===
          0
      ) {
        throw new TypeError(
          `Trusted publisher '${publisher.id}' must declare at least one Ed25519 public key.`
        );
      }

      const keys =
        new Map<
          string,
          StoredSigningKey
        >();

      for (
        const key
        of publisher.keys
      ) {
        if (
          key.algorithm !==
          PACKAGE_SIGNING_ALGORITHM
        ) {
          throw new TypeError(
            `Trusted publisher '${publisher.id}' uses unsupported signing algorithm '${String(
              key.algorithm
            )}'.`
          );
        }

        assertTrustStatus(
          key.status,
          `signing key for publisher '${publisher.id}'`
        );

        assertRevocationReason(
          key.status,
          key.reason,
          `signing key for publisher '${publisher.id}'`
        );

        const publicKey =
          importEd25519PublicKeySpki(
            key.publicKey
          );

        const keyId =
          fingerprintEncodedEd25519PublicKey(
            key.publicKey
          );

        if (
          keys.has(
            keyId
          )
        ) {
          throw new TypeError(
            `Trusted publisher '${publisher.id}' declares duplicate signing key '${keyId}'.`
          );
        }

        const existingOwner =
          keyOwners.get(
            keyId
          );

        if (
          existingOwner &&
          existingOwner !==
            publisher.id
        ) {
          throw new TypeError(
            `Signing key '${keyId}' cannot be trusted for multiple publishers.`
          );
        }

        keyOwners.set(
          keyId,
          publisher.id
        );

        keys.set(
          keyId,
          {
            keyId,
            publicKey,
            status:
              key.status,
            reason:
              key.reason,
          }
        );
      }

      this.publishers.set(
        publisher.id,
        {
          id:
            publisher.id,
          status:
            publisher.status,
          reason:
            publisher.reason,
          keys,
        }
      );
    }
  }

  resolveTrustedKey(
    publisherId: string,
    keyId: string
  ): KeyObject {
    const publisher =
      this.publishers.get(
        publisherId
      );

    if (
      !publisher ||
      publisher.status !==
        "trusted"
    ) {
      throw new AuroraError(
        `Package publisher '${publisherId}' is not trusted by Aurora.`,
        {
          code:
            ErrorCodes
              .PACKAGE_PUBLISHER_UNTRUSTED,
          suggestion:
            "Use a package signed by a publisher explicitly trusted by the active Aurora trust policy.",
        }
      );
    }

    const key =
      publisher.keys.get(
        keyId
      );

    if (!key) {
      throw new AuroraError(
        `Signing key '${keyId}' is not trusted for package publisher '${publisherId}'.`,
        {
          code:
            ErrorCodes
              .PACKAGE_PUBLISHER_UNTRUSTED,
          suggestion:
            "Use a package signature whose key is bound to the declared publisher.",
        }
      );
    }

    if (
      key.status ===
      "revoked"
    ) {
      throw new AuroraError(
        `Signing key '${keyId}' for package publisher '${publisherId}' has been revoked.`,
        {
          code:
            ErrorCodes
              .PACKAGE_SIGNING_KEY_REVOKED,
          suggestion:
            "Obtain a package signed by a currently trusted publisher key.",
        }
      );
    }

    return key.publicKey;
  }
}

function assertTrustStatus(
  status: unknown,
  subject: string
): asserts status is
  "trusted" |
  "revoked" {
  if (
    status !== "trusted" &&
    status !== "revoked"
  ) {
    throw new TypeError(
      `Invalid trust status for ${subject}.`
    );
  }
}

function assertRevocationReason(
  status:
    "trusted" |
    "revoked",
  reason: string |
    undefined,
  subject: string
): void {
  if (
    status === "revoked" &&
    (
      typeof reason !==
        "string" ||
      reason.trim().length ===
        0
    )
  ) {
    throw new TypeError(
      `Revoked ${subject} requires a reason.`
    );
  }

  if (
    reason !== undefined &&
    (
      typeof reason !==
        "string" ||
      reason.trim().length >
        500
    )
  ) {
    throw new TypeError(
      `Trust reason for ${subject} must be 500 characters or fewer.`
    );
  }
}