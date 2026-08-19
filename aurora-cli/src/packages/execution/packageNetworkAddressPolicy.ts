import {
  BlockList,
  isIP,
} from "node:net";

import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

export type PackageNetworkAddressFamily =
  4 | 6;

export interface PackageNetworkResolvedAddress {
  readonly address: string;
  readonly family:
    PackageNetworkAddressFamily;
}

/*
 * Aurora treats special-purpose address space as
 * ineligible for package-originated egress even
 * when a registry entry is technically globally
 * reachable. Package networking targets ordinary
 * public service addresses only.
 *
 * Keep this list synchronized with the IANA IPv4
 * and IPv6 Special-Purpose Address Registries.
 */
const IPV4_SPECIAL_PURPOSE_SUBNETS:
  readonly (
    readonly [string, number]
  )[] = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.31.196.0", 24],
    ["192.52.193.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["192.175.48.0", 24],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];

const IPV6_SPECIAL_PURPOSE_SUBNETS:
  readonly (
    readonly [string, number]
  )[] = [
    ["::", 128],
    ["::1", 128],
    ["::ffff:0:0", 96],
    ["64:ff9b::", 96],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["100:0:0:1::", 64],
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["2620:4f:8000::", 48],
    ["3fff::", 20],
    ["5f00::", 16],
    ["fc00::", 7],
    ["fe80::", 10],
    ["fec0::", 10],
    ["ff00::", 8],
  ];

const ipv4SpecialPurpose =
  new BlockList();

const ipv6SpecialPurpose =
  new BlockList();

const ipv6GlobalUnicast =
  new BlockList();

for (
  const [network, prefix]
  of IPV4_SPECIAL_PURPOSE_SUBNETS
) {
  ipv4SpecialPurpose.addSubnet(
    network,
    prefix,
    "ipv4"
  );
}

for (
  const [network, prefix]
  of IPV6_SPECIAL_PURPOSE_SUBNETS
) {
  ipv6SpecialPurpose.addSubnet(
    network,
    prefix,
    "ipv6"
  );
}

/*
 * Current globally allocated IPv6 unicast lives
 * in 2000::/3. Treat addresses outside that block
 * as non-public for Package Network Broker v1.
 */
ipv6GlobalUnicast.addSubnet(
  "2000::",
  3,
  "ipv6"
);

export function isPublicPackageNetworkAddress(
  address: string
): boolean {
  if (
    address.length === 0 ||
    address !== address.trim() ||
    address.includes("%")
  ) {
    return false;
  }

  const family =
    isIP(address);

  if (family === 4) {
    return !ipv4SpecialPurpose.check(
      address,
      "ipv4"
    );
  }

  if (family === 6) {
    return (
      ipv6GlobalUnicast.check(
        address,
        "ipv6"
      ) &&
      !ipv6SpecialPurpose.check(
        address,
        "ipv6"
      )
    );
  }

  return false;
}

export function assertPublicPackageNetworkResolution(
  packageId: string,
  hostname: string,
  addresses:
    readonly PackageNetworkResolvedAddress[]
): readonly PackageNetworkResolvedAddress[] {
  if (addresses.length === 0) {
    throw new AuroraError(
      `Package ${packageId} network host ${hostname} resolved to no addresses.`,
      {
        code:
          ErrorCodes
            .PACKAGE_NETWORK_FAILED,
        suggestion:
          "Verify DNS resolution for the explicitly granted package network origin.",
      }
    );
  }

  const validated:
    PackageNetworkResolvedAddress[] = [];

  for (const candidate of addresses) {
    const actualFamily =
      isIP(candidate.address);

    if (
      (
        candidate.family !== 4 &&
        candidate.family !== 6
      ) ||
      actualFamily !== candidate.family ||
      !isPublicPackageNetworkAddress(
        candidate.address
      )
    ) {
      throw unsafeResolutionError(
        packageId,
        hostname
      );
    }

    validated.push({
      address:
        candidate.address,
      family:
        candidate.family,
    });
  }

  return validated;
}

function unsafeResolutionError(
  packageId: string,
  hostname: string
): AuroraError {
  return new AuroraError(
    `Package ${packageId} network host ${hostname} resolved to an unsafe or invalid address.`,
    {
      code:
        ErrorCodes
          .PACKAGE_PERMISSION_DENIED,
      suggestion:
        "Package network origins must resolve exclusively to ordinary public IP addresses.",
    }
  );
}
