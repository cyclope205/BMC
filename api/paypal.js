const crypto = require("crypto");

const REPOSITORIES = new Set([
  "changelog-traduction",
  "suivi-stock-pellet",
  "programme-tnt-fr",
  "recettes-express",
]);

const SHORT_CODES = {
  ct: "changelog-traduction",
  sp: "suivi-stock-pellet",
  tnt: "programme-tnt-fr",
  rec: "recettes-express",
};

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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderPage(res, repo, amount) {
  const safeRepo = escapeHtml(repo);
  const action = `/api/paypal?repo=${encodeURIComponent(repo)}&amount=${encodeURIComponent(amount)}&pay=1`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Soutenir ${safeRepo} — PayPal</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:linear-gradient(145deg,#eef3f7,#dce5ec);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17212b}
.card{width:min(440px,100%);padding:34px 28px;border:1px solid rgba(255,255,255,.7);border-radius:28px;background:rgba(255,255,255,.58);backdrop-filter:blur(24px);box-shadow:0 20px 60px rgba(20,40,60,.15);text-align:center}
.logo{font-weight:800;font-size:22px;margin-bottom:18px}.heart{font-size:34px;margin-bottom:8px}.repo{font-size:18px;font-weight:650;margin:8px 0 26px}
.paypal{display:block;width:100%;padding:15px 20px;border:0;border-radius:12px;background:#0070ba;color:#fff;font-size:17px;font-weight:700;text-decoration:none;cursor:pointer;box-shadow:0 6px 18px rgba(0,112,186,.25)}
.paypal:hover{background:#005ea6}
label{display:block;text-align:left;margin:0 0 7px;font-size:14px;font-weight:650;color:#4d5964}
textarea{width:100%;resize:vertical;min-height:78px;margin:0 0 14px;padding:12px 13px;border:1px solid rgba(23,33,43,.12);border-radius:12px;background:rgba(255,255,255,.55);font:inherit;color:#17212b;outline:none}
textarea:focus{border-color:rgba(0,112,186,.45);box-shadow:0 0 0 3px rgba(0,112,186,.08)}
.amount{margin-top:14px;color:#5c6873;font-size:14px}
</style>
</head>
<body>
<main class="card">
<div class="heart">💙</div>
<div class="logo">Soutenir le projet</div>
<div class="repo">cyclope205/${safeRepo}</div>
<form action="${action}" method="GET">
<input type="hidden" name="repo" value="${safeRepo}">
<input type="hidden" name="amount" value="${escapeHtml(amount)}">
<input type="hidden" name="pay" value="1">
<label for="comment">Message (facultatif)</label>
<textarea id="comment" name="comment" maxlength="180" placeholder="Votre message..." rows="3"></textarea>
<button class="paypal" type="submit">Payer avec PayPal</button>
</form>
<div class="amount">Montant : ${escapeHtml(amount)} €</div>
</main>
</body>
</html>`);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method not allowed");
  }

  let repo = String(req.query?.repo || "");
  if (SHORT_CODES[repo]) repo = SHORT_CODES[repo];
  if (!REPOSITORIES.has(repo)) return res.status(400).send("Invalid repository");

  const rawAmount = String(req.query?.amount || "5").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(rawAmount)) return res.status(400).send("Invalid amount");

  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount < 1 || amount > 1000) {
    return res.status(400).send("Amount must be between 1 and 1000");
  }

  if (String(req.query?.pay || "") !== "1") {
    return renderPage(res, repo, amount.toFixed(2));
  }

  const origin = process.env.BMC_APP_URL;
  if (!origin) return res.status(500).send("BMC_APP_URL is not configured");

  try {
    const token = await getAccessToken();
    const currency = process.env.PAYPAL_CURRENCY || "EUR";
    const comment = String(req.query?.comment || "")
      .replace(/[\\r\\n]+/g, " ")
      .replace(/\\s+/g, " ")
      .trim()
      .slice(0, 180);
    const description = comment
      ? `Donation for cyclope205/${repo} — Message: ${comment}`
      : `Donation for cyclope205/${repo}`;

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
          description,
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
  } catch (error) {
    console.error("PayPal checkout error", error);
    return res.status(500).send("PayPal checkout failed");
  }
};
