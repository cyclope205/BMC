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

  const orderId = String(req.query?.token || "");
  if (!orderId || !/^[A-Z0-9-]+$/i.test(orderId)) return res.status(400).send("Invalid PayPal order");

  try {
    const token = await getAccessToken();
    const response = await fetch(`${getBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: "{}",
    });

    if (!response.ok && response.status !== 422) {
      const body = await response.text();
      console.error("PayPal capture failed", body.slice(0, 500));
      return res.status(502).send("PayPal capture failed");
    }

    const result = await response.json();
    if (result.status !== "COMPLETED") return res.status(409).send("PayPal payment was not completed");

    const repo = result.purchase_units?.[0]?.custom_id?.replace(/^repo:/, "");
    if (!/^(changelog-traduction|suivi-stock-pellet|programme-tnt-fr|recettes-express)$/.test(repo || "")) {
      return res.status(500).send("Invalid repository attribution");
    }

    return res.redirect(302, `https://github.com/cyclope205/${repo}`);
  } catch (error) {
    console.error("PayPal return error", error);
    return res.status(500).send("PayPal payment processing failed");
  }
};
