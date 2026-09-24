const crypto = require("crypto");

const REPOSITORIES = new Set([
  "changelog-traduction",
  "suivi-stock-pellet",
  "programme-tnt-fr",
  "recettes-express",
]);

function getBaseUrl() {
  return process.env.PAYPAL_ENV === "sandbox"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";
}

async function getAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("PayPal credentials are not configured");

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(`${getBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) throw new Error(`PayPal OAuth returned HTTP ${response.status}`);
  return (await response.json()).access_token;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method not allowed");
  }

  const repo = String(req.query?.repo || "");
  if (!REPOSITORIES.has(repo)) return res.status(400).send("Invalid repository");

  const rawAmount = String(req.query?.amount || "5").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(rawAmount)) return res.status(400).send("Invalid amount");

  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount < 1 || amount > 1000) {
    return res.status(400).send("Amount must be between 1 and 1000");
  }

  const origin = process.env.BMC_APP_URL;
  if (!origin) return res.status(500).send("BMC_APP_URL is not configured");
  const token = await getAccessToken();
  const currency = process.env.PAYPAL_CURRENCY || "EUR";

  const response = await fetch(`${getBaseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "PayPal-Request-Id": `cyclope205-${repo}-${crypto.randomUUID()}`,
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        description: `Donation for cyclope205/${repo}`,
        custom_id: `repo:${repo}`,
        amount: { currency_code: currency, value: amount.toFixed(2) },
      }],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "cyclope205",
            locale: "fr-FR",
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            return_url: `${origin}/api/paypal-return`,
            cancel_url: `${origin}/api/paypal-cancel?repo=${encodeURIComponent(repo)}`,
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error("PayPal order creation failed", body.slice(0, 500));
    return res.status(502).send("PayPal order creation failed");
  }

  const order = await response.json();
  const approval = order.links?.find((link) => link.rel === "payer-action" || link.rel === "approve")?.href;
  if (!approval) return res.status(502).send("PayPal approval URL unavailable");

  return res.redirect(302, approval);
};
