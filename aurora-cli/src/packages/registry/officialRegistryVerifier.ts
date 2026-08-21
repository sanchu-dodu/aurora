import {
  verify as verifySignature,
} from "node:crypto";

import {
  AURORA_OFFICIAL_PUBLISHER_ID,
  AURORA_OFFICIAL_TRUSTED_PUBLISHERS,
} from "../trust/officialPublisherTrust.js";

import {
  PackageTrustStore,
} from "../trust/packageTrustStore.js";

import {
  calculateOfficialRegistrySnapshotDigest,
  createOfficialRegistrySigningPayload,
} from "./officialRegistrySigningPayload.js";

import {
  parseOfficialRegistrySnapshot,
  type OfficialRegistryPackageEntry,
  type OfficialRegistrySnapshot,
} from "./officialRegistrySchema.js";

export interface VerifiedOfficialRegistrySnapshot {
  readonly snapshot:
    OfficialRegistrySnapshot;

  readonly digest:
    string;
}

export interface OfficialRegistryVerifierOptions {
  readonly trustStore?:
    PackageTrustStore;
}

function registryFailure(
  message: string
): Error {
  return new Error(
    `Official package registry verification failed: ${message}`
  );
}

function packageVersionKey(
  entry:
    Pick<
      OfficialRegistryPackageEntry,
      "packageId" |
      "version"
    >
): string {
  return `${entry.packageId}\0${entry.version}`;
}

function assertSameArchiveIdentity(
  previous:
    OfficialRegistryPackageEntry,
  current:
    OfficialRegistryPackageEntry
): void {
  if (
    current.manifestDigest !==
      previous.manifestDigest
  ) {
    throw registryFailure(
      `immutable manifest digest changed for '${previous.packageId}@${previous.version}'.`
    );
  }

  if (
    current.archive.algorithm !==
      previous.archive.algorithm ||
    current.archive.digest !==
      previous.archive.digest ||
    current.archive.size !==
      previous.archive.size ||
    current.archive.url !==
      previous.archive.url
  ) {
    throw registryFailure(
      `immutable archive identity changed for '${previous.packageId}@${previous.version}'.`
    );
  }

  if (
    current.provenance.type !==
      previous.provenance.type ||
    current.provenance.url !==
      previous.provenance.url ||
    current.provenance.reference !==
      previous.provenance.reference
  ) {
    throw registryFailure(
      `immutable provenance changed for '${previous.packageId}@${previous.version}'.`
    );
  }
}

function assertLifecycleTransition(
  previous:
    OfficialRegistryPackageEntry,
  current:
    OfficialRegistryPackageEntry
): void {
  if (
    previous.lifecycle.status ===
      "revoked"
  ) {
    if (
      current.lifecycle.status !==
        "revoked" ||
      current.lifecycle.reason !==
        previous.lifecycle.reason
    ) {
      throw registryFailure(
        `revoked package '${previous.packageId}@${previous.version}' cannot be reactivated or have its revocation rewritten.`
      );
    }

    return;
  }

  if (
    current.lifecycle.status ===
      "active"
  ) {
    return;
  }

  if (
    current.lifecycle.status ===
      "revoked" &&
    current.lifecycle.reason !==
      undefined
  ) {
    return;
  }

  throw registryFailure(
    `invalid lifecycle transition for '${previous.packageId}@${previous.version}'.`
  );
}

function assertAppendOnlySuccessor(
  previous:
    VerifiedOfficialRegistrySnapshot,
  current:
    OfficialRegistrySnapshot
): void {
  const previousSnapshot =
    previous.snapshot;

  if (
    previousSnapshot.publisherId !==
      AURORA_OFFICIAL_PUBLISHER_ID
  ) {
    throw registryFailure(
      "the supplied previous snapshot is not bound to the Aurora official publisher."
    );
  }

  if (
    current.sequence !==
      previousSnapshot.sequence + 1
  ) {
    throw registryFailure(
      `snapshot sequence must advance exactly from ${previousSnapshot.sequence} to ${previousSnapshot.sequence + 1}.`
    );
  }

  if (
    current.previousSnapshotDigest !==
      previous.digest
  ) {
    throw registryFailure(
      "previousSnapshotDigest does not match the verified predecessor snapshot."
    );
  }

  const previousTime =
    Date.parse(
      previousSnapshot.publishedAt
    );

  const currentTime =
    Date.parse(
      current.publishedAt
    );

  if (
    currentTime <
      previousTime
  ) {
    throw registryFailure(
      "snapshot publishedAt cannot move backwards."
    );
  }

  const currentEntries =
    new Map<
      string,
      OfficialRegistryPackageEntry
    >();

  for (
    const entry
    of current.packages
  ) {
    currentEntries.set(
      packageVersionKey(
        entry
      ),
      entry
    );
  }

  for (
    const previousEntry
    of previousSnapshot.packages
  ) {
    const key =
      packageVersionKey(
        previousEntry
      );

    const currentEntry =
      currentEntries.get(
        key
      );

    if (!currentEntry) {
      throw registryFailure(
        `existing package version '${previousEntry.packageId}@${previousEntry.version}' cannot disappear from an append-only registry snapshot.`
      );
    }

    assertSameArchiveIdentity(
      previousEntry,
      currentEntry
    );

    assertLifecycleTransition(
      previousEntry,
      currentEntry
    );
  }
}

const verifiedOfficialRegistryRecords =
  new WeakSet<object>();

function freezeOfficialRegistrySnapshot(
  snapshot:
    OfficialRegistrySnapshot
): OfficialRegistrySnapshot {
  for (
    const entry
    of snapshot.packages
  ) {
    Object.freeze(
      entry.archive
    );

    Object.freeze(
      entry.provenance
    );

    Object.freeze(
      entry.lifecycle
    );

    Object.freeze(
      entry
    );
  }

  Object.freeze(
    snapshot.packages
  );

  Object.freeze(
    snapshot.signature
  );

  return Object.freeze(
    snapshot
  );
}

function assertAuthenticVerifiedRecord(
  value:
    VerifiedOfficialRegistrySnapshot
): void {
  if (
    value === null ||
    typeof value !==
      "object" ||
    !verifiedOfficialRegistryRecords
      .has(
        value as object
      )
  ) {
    throw registryFailure(
      "the supplied predecessor was not produced by the official registry verifier."
    );
  }
}

export class OfficialRegistryVerifier {
  private readonly trustStore:
    PackageTrustStore;

  constructor(
    options:
      OfficialRegistryVerifierOptions = {}
  ) {
    this.trustStore =
      options.trustStore ??
      new PackageTrustStore(
        AURORA_OFFICIAL_TRUSTED_PUBLISHERS
      );
  }

  private verifySnapshot(
    value: unknown
  ): VerifiedOfficialRegistrySnapshot {
    /*
     * Parse before consuming any registry metadata.
     *
     * Zod returns a fresh object graph, so the verified state
     * below does not retain mutable caller-owned containers.
     */
    const snapshot =
      parseOfficialRegistrySnapshot(
        value
      );

    if (
      snapshot.publisherId !==
        AURORA_OFFICIAL_PUBLISHER_ID
    ) {
      throw registryFailure(
        `publisher '${snapshot.publisherId}' is not the Aurora official registry publisher.`
      );
    }

    const publicKey =
      this.trustStore
        .resolveTrustedKey(
          snapshot.publisherId,
          snapshot.signature.keyId
        );

    const payload =
      createOfficialRegistrySigningPayload(
        snapshot
      );

    const signatureBytes =
      Buffer.from(
        snapshot.signature.value,
        "base64url"
      );

    let valid = false;

    try {
      valid =
        verifySignature(
          null,
          payload,
          publicKey,
          signatureBytes
        );
    }
    catch {
      throw registryFailure(
        "registry Ed25519 signature verification failed."
      );
    }

    if (!valid) {
      throw registryFailure(
        "registry Ed25519 signature verification failed."
      );
    }

    const digest =
      calculateOfficialRegistrySnapshotDigest(
        snapshot
      );

    const frozenSnapshot =
      freezeOfficialRegistrySnapshot(
        snapshot
      );

    const verified =
      Object.freeze({
        snapshot:
          frozenSnapshot,

        digest,
      });

    /*
     * Runtime authenticity boundary:
     * TypeScript structural typing is not accepted as proof
     * that a predecessor passed registry verification.
     */
    verifiedOfficialRegistryRecords.add(
      verified
    );

    return verified;
  }

  verify(
    value: unknown,
    previous?:
      VerifiedOfficialRegistrySnapshot
  ): VerifiedOfficialRegistrySnapshot {
    let trustedPrevious:
      VerifiedOfficialRegistrySnapshot |
      undefined;

    if (
      previous !== undefined
    ) {
      /*
       * A predecessor must be an actual prior verifier result,
       * not merely an object shaped like the public interface.
       */
      assertAuthenticVerifiedRecord(
        previous
      );

      /*
       * Re-authenticate it against the active trust policy and
       * independently recalculate its complete snapshot digest.
       * The original verified result is deeply frozen, so its
       * nested registry state cannot have changed after return.
       */
      const reverifiedPrevious =
        this.verifySnapshot(
          previous.snapshot
        );

      if (
        reverifiedPrevious.digest !==
          previous.digest
      ) {
        throw registryFailure(
          "the supplied predecessor digest does not match its authenticated registry snapshot."
        );
      }

      trustedPrevious =
        reverifiedPrevious;
    }

    const verifiedCurrent =
      this.verifySnapshot(
        value
      );

    const snapshot =
      verifiedCurrent.snapshot;

    if (
      trustedPrevious ===
        undefined
    ) {
      if (
        snapshot.sequence !== 1
      ) {
        throw registryFailure(
          "a non-genesis registry snapshot requires a previously verified snapshot."
        );
      }

      return verifiedCurrent;
    }

    if (
      snapshot.sequence === 1
    ) {
      throw registryFailure(
        "a genesis registry snapshot cannot name a predecessor."
      );
    }

    assertAppendOnlySuccessor(
      trustedPrevious,
      snapshot
    );

    return verifiedCurrent;
  }
}