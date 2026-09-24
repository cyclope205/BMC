# Buy Me a Coffee + PayPal — Centralized Donation Service

Centralized donation service for the GitHub projects of **cyclope205**.

## Supported providers

- **Buy Me a Coffee**: `POST /api/webhook`
- **PayPal**: `POST /api/paypal-webhook`

Both providers can update the README of the repository from which the donation was initiated.

## Buy Me a Coffee

The BMC endpoint verifies the `x-signature-sha256` HMAC-SHA256 signature against the raw request body before processing `donation.created`.

Repository attribution uses the repository-specific `/api/donate?repo=...` entry point and the BMC supporter attribution returned by the BMC API. If BMC does not provide a reliable repository attribution, the donation is ignored rather than assigned to the wrong repository.

## PayPal

Each repository can use:

~~~text
https://<your-vercel-domain>/api/paypal?repo=<repository>&amount=5
~~~

The endpoint creates a PayPal Orders API checkout with a repository-specific `custom_id`. PayPal then returns the payer to the central service, which captures the order.

The PayPal webhook listens for `PAYMENT.CAPTURE.COMPLETED`, verifies the webhook signature, reads the order's repository `custom_id`, and updates only the matching README. PayPal documents `custom_id` on purchase units and includes it in completed-capture data. citeturn3search4

The PayPal webhook must be configured on the PayPal Developer Dashboard to:

~~~text
https://<your-vercel-domain>/api/paypal-webhook
~~~

PayPal requires webhook signature verification; this implementation uses PayPal's `verify-webhook-signature` endpoint. citeturn2search1turn2search4

## Environment variables

Configure these in Vercel:

~~~text
BMC_APP_URL=https://bmc-eight-red.vercel.app
BMC_WEBHOOK_SECRET=
BMC_API_TOKEN=
GITHUB_TOKEN=

PAYPAL_ENV=live
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=
PAYPAL_CURRENCY=EUR
~~~

For PayPal sandbox testing, set `PAYPAL_ENV=sandbox` and use sandbox credentials and a sandbox webhook.

## README thank-you blocks

The service keeps provider-specific markers so BMC and PayPal donations can coexist without overwriting each other:

~~~text
<!--START_SECTION:buy-me-a-coffee-->
- ☕ **Donor A***** ** — 5 USD (2026-09-24)
<!--END_SECTION:buy-me-a-coffee-->

<!--START_SECTION:paypal-->
- 💙 **Donor B***** ** — 10 EUR (2026-09-24)
<!--END_SECTION:paypal-->
~~~

Duplicate webhook deliveries are ignored by event ID inside the corresponding provider block.

## Security

- POST-only webhook endpoints
- Raw-body signature verification
- No secrets committed to Git
- Repository allowlist limited to the four supported projects
- Unknown repository attribution is rejected
- PayPal webhook signatures are verified before processing
- GitHub updates use the configured `GITHUB_TOKEN`

## Deployment

This project is designed for Vercel Serverless Functions and requires no framework or dependency installation.

PayPal's official documentation supports sandbox webhook simulation, so the listener can be tested without making a live donation. Mock events cannot be verified through PayPal's postback verification endpoint, so live/sandbox signed events must be used for end-to-end signature verification. citeturn2search5turn2search1