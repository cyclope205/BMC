# Buy Me a Coffee — Centralized Donation Service

Centralized webhook endpoint for Buy Me a Coffee donations supporting the GitHub projects of **cyclope205**.

## Purpose

This repository centralizes:

- Buy Me a Coffee webhook reception
- HMAC-SHA256 signature verification
- Donation event normalization
- Donor-name anonymization
- Future synchronization with the supported GitHub repositories

## Webhook endpoint

After deployment on Vercel:

```
POST https://<your-vercel-domain>/api/webhook
```

Configure this URL in **Buy Me a Coffee → Creator Dashboard → Integrations → Webhooks**.

Supported event:

- `donation.created`

The endpoint verifies the `x-signature-sha256` header against the raw request body before processing the event.

## Environment variable

Configure this secret in Vercel:

```
BMC_WEBHOOK_SECRET=<your-buy-me-a-coffee-webhook-secret>\nBMC_API_TOKEN=<your-buy-me-a-coffee-developer-api-token>\nGITHUB_TOKEN=<fine-grained-github-token-with-contents-write>
```

Never commit the secret to GitHub.

## Security

The webhook:

1. accepts POST requests only;
2. reads the raw request body;
3. calculates HMAC-SHA256 with `BMC_WEBHOOK_SECRET`;
4. compares the received signature using a timing-safe comparison;
5. rejects invalid signatures with HTTP 401;
6. does not expose the webhook secret in logs or responses.

## Repository attribution

The Buy Me a Coffee webhook is account-level. The service therefore does **not** assume that a donation belongs to a particular GitHub repository unless reliable attribution is available.

The four supported projects are attributed automatically: the README donation link goes through the Vercel `/api/donate?repo=...` redirect, which preserves the repository in the referrer. The webhook then reads the supporter through the Buy Me a Coffee API, extracts `referer`, validates it against the four allowed repositories, and updates only that repository.

## Local configuration

Copy:

```
.env.example
```

to your local environment and provide the webhook secret.

## Deployment

This project is designed for Vercel Serverless Functions. No framework or dependency installation is required.


## Attribution flow

1. Each repository uses a unique link such as `/api/donate?repo=programme-tnt-fr`.
2. The redirect sets `Referrer-Policy: unsafe-url` and sends the visitor to the common Buy Me a Coffee page.
3. On `donation.created`, the webhook verifies the HMAC signature.
4. It queries `/api/v1/supporters/{supporter_id}` and reads the returned `referer`.
5. Only a referer matching one of the four exact `cyclope205` repositories is accepted.
6. The matching README is updated; an unknown attribution is ignored rather than guessing.

The Buy Me a Coffee webhook schema itself does not contain the repository source, so the supporter API's `referer` field is used as the attribution bridge. The supporter API documents `referer` as a supporter field.