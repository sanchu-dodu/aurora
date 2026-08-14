import {
  createHash,
  createPublicKey,
  type KeyObject,
} from "node:crypto";

const BASE64URL_PATTERN =
  /^[A-Za-z0-9_-]+$/;

function assertEd25519PublicKey(
  publicKey: KeyObject
): void {
  if (
    publicKey.type !== "public"
  ) {
    throw new TypeError(
      "Expected an Ed25519 public key. Private and secret keys are not accepted."
    );
  }

  if (
    publicKey.asymmetricKeyType !==
    "ed25519"
  ) {
    throw new TypeError(
      "Expected an Ed25519 public key."
    );
  }
}

export function exportEd25519PublicKeySpki(
  publicKey: KeyObject
): Buffer {
  assertEd25519PublicKey(
    publicKey
  );

  const exported =
    publicKey.export({
      format: "der",
      type: "spki",
    });

  return Buffer.from(
    exported
  );
}

export function encodeEd25519PublicKeySpki(
  publicKey: KeyObject
): string {
  return exportEd25519PublicKeySpki(
    publicKey
  ).toString(
    "base64url"
  );
}

export function importEd25519PublicKeySpki(
  encoded: string
): KeyObject {
  if (
    encoded.length === 0 ||
    !BASE64URL_PATTERN.test(
      encoded
    ) ||
    encoded.includes("=")
  ) {
    throw new TypeError(
      "Expected an unpadded canonical base64url Ed25519 SPKI public key."
    );
  }

  const der =
    Buffer.from(
      encoded,
      "base64url"
    );

  if (
    der.length === 0 ||
    der.toString(
      "base64url"
    ) !== encoded
  ) {
    throw new TypeError(
      "Expected a canonical base64url Ed25519 SPKI public key."
    );
  }

  let publicKey: KeyObject;

  try {
    publicKey =
      createPublicKey({
        key: der,
        format: "der",
        type: "spki",
      });
  }
  catch {
    throw new TypeError(
      "Encoded package public key is not valid SPKI DER."
    );
  }

  assertEd25519PublicKey(
    publicKey
  );

  const canonical =
    encodeEd25519PublicKeySpki(
      publicKey
    );

  if (canonical !== encoded) {
    throw new TypeError(
      "Encoded package public key is not canonical Ed25519 SPKI DER."
    );
  }

  return publicKey;
}

export function fingerprintEd25519PublicKey(
  publicKey: KeyObject
): string {
  return createHash(
    "sha256"
  )
    .update(
      exportEd25519PublicKeySpki(
        publicKey
      )
    )
    .digest(
      "hex"
    );
}

export function fingerprintEncodedEd25519PublicKey(
  encoded: string
): string {
  return fingerprintEd25519PublicKey(
    importEd25519PublicKeySpki(
      encoded
    )
  );
}