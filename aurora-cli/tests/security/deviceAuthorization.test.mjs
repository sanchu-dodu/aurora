import test from "node:test";
import assert from "node:assert/strict";

import {
  CloudIdentityService,
} from "../../dist/security/identity/cloudIdentityService.js";

import {
  DeviceAuthorizationClient,
} from "../../dist/security/identity/deviceAuthorizationClient.js";

import {
  ErrorCodes,
} from "../../dist/errors/errorCodes.js";

function jsonResponse(
  body,
  status = 200
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        "Content-Type":
          "application/json",
      },
    }
  );
}

test(
  "device authorization uses a public client and accepts only short-lived Bearer tokens",
  async () => {
    const requests = [];
    const sleeps = [];
    const responses = [
      jsonResponse({
        device_code:
          "private-device-code",
        user_code: "ABCD-EFGH",
        verification_uri:
          "https://cloud.aurora.example/device",
        expires_in: 600,
        interval: 5,
      }),
      jsonResponse(
        {
          error:
            "authorization_pending",
        },
        400
      ),
      jsonResponse(
        {
          error: "slow_down",
        },
        400
      ),
      jsonResponse({
        access_token:
          "short-lived-access-token",
        token_type: "Bearer",
        expires_in: 900,
        scope: "project.read",
      }),
    ];

    const client =
      new DeviceAuthorizationClient({
        deviceAuthorizationEndpoint:
          "https://cloud.aurora.example/oauth/device",
        tokenEndpoint:
          "https://cloud.aurora.example/oauth/token",
        clientId: "aurora-cli",
        scope: [
          "project.read",
        ],
        now: () => 0,
        sleep: async milliseconds => {
          sleeps.push(milliseconds);
        },
        fetchImplementation:
          async (url, options) => {
            requests.push({
              url,
              options,
            });
            return responses.shift();
          },
      });

    const authorization =
      await client
        .requestDeviceAuthorization();
    const token =
      await client.pollForAccessToken(
        authorization
      );

    assert.equal(
      token.accessToken,
      "short-lived-access-token"
    );
    assert.equal(
      token.tokenType,
      "Bearer"
    );
    assert.deepEqual(
      sleeps,
      [
        5_000,
        10_000,
      ]
    );

    for (const request of requests) {
      const body =
        String(request.options.body);

      assert.equal(
        body.includes(
          "client_secret"
        ),
        false
      );
      assert.equal(
        request.options.redirect,
        "error"
      );
    }

    assert.match(
      String(
        requests[0].options.body
      ),
      /client_id=aurora-cli/u
    );
    assert.match(
      String(
        requests[1].options.body
      ),
      /device_code=private-device-code/u
    );
  }
);

test(
  "identity endpoints, refresh tokens, and long-lived access tokens are rejected",
  async () => {
    assert.throws(
      () =>
        new DeviceAuthorizationClient({
          deviceAuthorizationEndpoint:
            "http://cloud.aurora.example/device",
          tokenEndpoint:
            "https://cloud.aurora.example/token",
          clientId: "aurora-cli",
        }),
      error => {
        assert.equal(
          error.code,
          ErrorCodes
            .DEVICE_AUTHORIZATION_FAILED
        );
        return true;
      }
    );

    for (
      const payload of [
        {
          access_token: "access",
          token_type: "Bearer",
          expires_in: 300,
          refresh_token:
            "long-lived-refresh",
        },
        {
          access_token: "access",
          token_type: "Bearer",
          expires_in: 7_200,
        },
      ]
    ) {
      const client =
        new DeviceAuthorizationClient({
          deviceAuthorizationEndpoint:
            "https://cloud.aurora.example/device",
          tokenEndpoint:
            "https://cloud.aurora.example/token",
          clientId: "aurora-cli",
          now: () => 0,
          fetchImplementation:
            async () =>
              jsonResponse(payload),
        });

      await assert.rejects(
        client.pollForAccessToken({
          deviceCode: "device",
          userCode: "code",
          verificationUri:
            "https://cloud.aurora.example/device",
          expiresAt:
            new Date(600_000)
              .toISOString(),
          intervalSeconds: 5,
        }),
        error => {
          assert.equal(
            error.code,
            ErrorCodes
              .DEVICE_AUTHORIZATION_FAILED
          );
          return true;
        }
      );
    }
  }
);

test(
  "cloud identity never exposes device codes and stores tokens only in the credential store",
  async () => {
    const calls = [];
    const credentials = new Map();
    const authorization = {
      deviceCode:
        "private-device-code",
      userCode: "ABCD-EFGH",
      verificationUri:
        "https://cloud.aurora.example/device",
      expiresAt:
        new Date(600_000)
          .toISOString(),
      intervalSeconds: 5,
    };
    const token = {
      accessToken:
        "credential-store-only",
      tokenType: "Bearer",
      expiresAt:
        new Date(900_000)
          .toISOString(),
    };

    const service =
      new CloudIdentityService(
        {
          async requestDeviceAuthorization() {
            return authorization;
          },
          async pollForAccessToken(
            received
          ) {
            assert.equal(
              received,
              authorization
            );
            return token;
          },
        },
        {
          async set(id, value, context) {
            calls.push({
              action: "set",
              id,
              context,
            });
            credentials.set(id, value);
          },
          async get(id, context) {
            calls.push({
              action: "get",
              id,
              context,
            });
            return credentials.get(id) ??
              null;
          },
          async delete(id, context) {
            calls.push({
              action: "delete",
              id,
              context,
            });
            return credentials.delete(id);
          },
        },
        () => 0
      );

    let verification;

    await service.login({
      onVerification(value) {
        verification = value;
      },
    });

    assert.equal(
      "deviceCode" in verification,
      false
    );
    assert.equal(
      await service.getAccessToken(),
      "credential-store-only"
    );
    assert.equal(
      calls[0].id,
      "aurora-cloud"
    );
    assert.equal(
      JSON.stringify(calls)
        .includes(
          "credential-store-only"
        ),
      false
    );

    assert.equal(
      await service.logout(),
      true
    );
  }
);
