import test from "node:test";
import assert from "node:assert/strict";

import {
  assertPublicPackageNetworkResolution,
  isPublicPackageNetworkAddress,
} from "../../dist/packages/execution/packageNetworkAddressPolicy.js";

test(
  "ordinary public IPv4 and IPv6 addresses are accepted",
  () => {
    for (const address of [
      "8.8.8.8",
      "93.184.216.34",
      "1.1.1.1",
      "2001:4860:4860::8888",
      "2606:4700:4700::1111",
    ]) {
      assert.equal(
        isPublicPackageNetworkAddress(
          address
        ),
        true,
        address
      );
    }
  }
);

test(
  "IPv4 private loopback link-local CGNAT and unspecified space is denied",
  () => {
    for (const address of [
      "0.0.0.0",
      "10.1.2.3",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
    ]) {
      assert.equal(
        isPublicPackageNetworkAddress(
          address
        ),
        false,
        address
      );
    }
  }
);

test(
  "IPv4 documentation benchmark multicast reserved and special-purpose space is denied",
  () => {
    for (const address of [
      "192.0.0.9",
      "192.0.2.1",
      "192.31.196.1",
      "192.52.193.1",
      "192.88.99.2",
      "192.175.48.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "239.255.255.250",
      "240.0.0.1",
      "255.255.255.255",
    ]) {
      assert.equal(
        isPublicPackageNetworkAddress(
          address
        ),
        false,
        address
      );
    }
  }
);

test(
  "IPv6 local translation mapped documentation and special-purpose space is denied",
  () => {
    for (const address of [
      "::",
      "::1",
      "::ffff:127.0.0.1",
      "::ffff:8.8.8.8",
      "64:ff9b::808:808",
      "64:ff9b:1::1",
      "100::1",
      "100:0:0:1::1",
      "2001::1",
      "2001:db8::1",
      "2002::1",
      "2620:4f:8000::1",
      "3fff::1",
      "5f00::1",
      "fc00::1",
      "fd00::1",
      "fe80::1",
      "fec0::1",
      "ff02::1",
    ]) {
      assert.equal(
        isPublicPackageNetworkAddress(
          address
        ),
        false,
        address
      );
    }
  }
);

test(
  "non-IP and scoped address spellings are denied",
  () => {
    for (const address of [
      "",
      "example.com",
      " 8.8.8.8",
      "8.8.8.8 ",
      "fe80::1%eth0",
    ]) {
      assert.equal(
        isPublicPackageNetworkAddress(
          address
        ),
        false,
        address
      );
    }
  }
);

test(
  "a resolution containing only public addresses is accepted and copied",
  () => {
    const source = [
      {
        address: "8.8.8.8",
        family: 4,
      },
      {
        address:
          "2606:4700:4700::1111",
        family: 6,
      },
    ];

    const result =
      assertPublicPackageNetworkResolution(
        "test-package",
        "api.example.com",
        source
      );

    assert.deepEqual(
      result,
      source
    );

    assert.notEqual(
      result,
      source
    );

    assert.notEqual(
      result[0],
      source[0]
    );
  }
);

test(
  "one unsafe DNS answer poisons the entire resolution",
  () => {
    assert.throws(
      () =>
        assertPublicPackageNetworkResolution(
          "test-package",
          "api.example.com",
          [
            {
              address: "8.8.8.8",
              family: 4,
            },
            {
              address: "127.0.0.1",
              family: 4,
            },
          ]
        ),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_PERMISSION_DENIED"
        );

        assert.match(
          error.message,
          /unsafe or invalid address/
        );

        return true;
      }
    );
  }
);

test(
  "address family mismatch fails closed",
  () => {
    assert.throws(
      () =>
        assertPublicPackageNetworkResolution(
          "test-package",
          "api.example.com",
          [
            {
              address: "8.8.8.8",
              family: 6,
            },
          ]
        ),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_PERMISSION_DENIED"
        );

        return true;
      }
    );
  }
);

test(
  "invalid resolver family values fail closed",
  () => {
    assert.throws(
      () =>
        assertPublicPackageNetworkResolution(
          "test-package",
          "api.example.com",
          [
            {
              address: "8.8.8.8",
              family: 0,
            },
          ]
        ),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_PERMISSION_DENIED"
        );

        return true;
      }
    );
  }
);

test(
  "empty DNS resolution has a distinct network failure",
  () => {
    assert.throws(
      () =>
        assertPublicPackageNetworkResolution(
          "test-package",
          "api.example.com",
          []
        ),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_NETWORK_FAILED"
        );

        return true;
      }
    );
  }
);
