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

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function anonymizeName(name) {
  const clean = typeof name === "string" ? name.trim() : "";
  if (!clean) return "Anonymous";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]} ${parts[1][0]}*****`;
  return clean[0] + "*****";
}

function repoFromCustomId(customId) {
  const match = typeof customId === "string" ? customId.match(/^repo:(.+)$/) : null;
  return match && REPOSITORIES.has(match[1]) ? match[1] : null;
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

async function verifyWebhook(rawBody, headers) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("PAYPAL_WEBHOOK_ID is not configured");

  const token = await getAccessToken();
  const response = await fetch(`${getBaseUrl()}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      auth_algo: headers["paypal-auth-algo"],
      cert_url: headers["paypal-cert-url"],
      transmission_id: headers["paypal-transmission-id"],
      transmission_sig: headers["paypal-transmission-sig"],
      transmission_time: headers["paypal-transmission-time"],
      webhook_id: webhookId,
      webhook_event: JSON.parse(rawBody.toString("utf8")),
    }),
  });

  if (!response.ok) return false;
  return (await response.json()).verification_status === "SUCCESS";
}

async function getOrder(orderId, token) {
  if (!orderId) return null;
  const response = await fetch(`${getBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) return null;
  return response.json();
}

async function updateReadme(repo, event, githubToken) {
  const apiUrl = `https://api.github.com/repos/cyclope205/${repo}/contents/README.md`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${githubToken}`,
    "X-GitHub-Api-Version": "2026-03-10",
  };

  const readmeResponse = await fetch(apiUrl, { headers });
  if (!readmeResponse.ok) throw new Error(`GitHub README GET returned HTTP ${readmeResponse.status}`);

  const file = await readmeResponse.json();
  const current = Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf8");
  const startMarker = "<!--START_SECTION:paypal-->";
  const endMarker = "<!--END_SECTION:paypal-->";
  const eventId = event.id;
  const existingStart = current.indexOf(startMarker);
  const existingEnd = current.indexOf(endMarker);

  if (eventId && existingStart >= 0 && existingEnd > existingStart &&
      current.slice(existingStart, existingEnd).includes(`#${eventId}`)) {
    return { updated: false };
  }

  const amount = event.resource?.amount?.value ?? "?";
  const currency = event.resource?.amount?.currency_code ?? "";
  const payer = event.resource?.payer?.name;
  const donorName = payer ? [payer.given_name, payer.surname].filter(Boolean).join(" ") : "PayPal donor";
  const name = anonymizeName(donorName);
  const entry = `- 💙 **${name}** — ${amount} ${currency} (${new Date(event.create_time || Date.now()).toISOString().slice(0, 10)})${eventId ? ` — #${eventId}` : ""}`;
  const block = `${startMarker}\n${entry}\n${endMarker}`;

  let updated;
  if (existingStart >= 0 && existingEnd > existingStart) {
    updated = current.slice(0, existingEnd) + "\n" + entry + current.slice(existingEnd);
  } else {
    const heading = "### ☕ Merci aux donateurs";
    const headingIndex = current.indexOf(heading);
    if (headingIndex >= 0) {
      const insertAt = current.indexOf("\n", headingIndex) + 1;
      updated = current.slice(0, insertAt) + "\n" + block + "\n" + current.slice(insertAt);
    } else {
      updated = current.trimEnd() + `\n\n${heading}\n\n${block}\n`;
    }
  }

  const putResponse = await fetch(apiUrl, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "chore: add PayPal supporter",
      content: Buffer.from(updated, "utf8").toString("base64"),
      sha: file.sha,
      branch: "main",
    }),
  });

  if (!putResponse.ok) {
    const body = await putResponse.text();
    throw new Error(`GitHub README PUT returned HTTP ${putResponse.status}: ${body.slice(0, 300)}`);
  }

  return { updated: true };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const rawBody = await readRawBody(req);
    if (!(await verifyWebhook(rawBody, req.headers))) {
      return res.status(401).json({ error: "Invalid PayPal signature" });
    }

    const event = JSON.parse(rawBody.toString("utf8"));
    if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
      return res.status(200).json({ ok: true, ignored: true, event_id: event.id ?? null });
    }

    const repo = repoFromCustomId(event.resource?.custom_id);
    if (!repo) {
      return res.status(200).json({ ok: true, attributed: false, event_id: event.id ?? null });
    }

    const token = await getAccessToken();
    const orderId = event.resource?.supplementary_data?.related_ids?.order_id;
    const order = await getOrder(orderId, token);
    if (order?.status !== "COMPLETED") {
      return res.status(200).json({ ok: true, attributed: false, event_id: event.id ?? null });
    }

    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) throw new Error("GITHUB_TOKEN is not configured");

    const enrichedEvent = {
      ...event,
      resource: { ...event.resource, payer: order.payer },
    };

    const result = await updateReadme(repo, enrichedEvent, githubToken);
    return res.status(200).json({
      ok: true,
      attributed: true,
      repository: repo,
      updated: result.updated,
      event_id: event.id ?? null,
    });
  } catch (error) {
    console.error("PayPal webhook error", error);
    return res.status(500).json({ error: "PayPal webhook processing failed" });
  }
};

module.exports.config = {
  api: { bodyParser: false },
};
