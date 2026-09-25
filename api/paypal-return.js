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

    let repoSource = result;
    if (!result.purchase_units?.[0]?.custom_id) {
      const orderResponse = await fetch(`${getBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (!orderResponse.ok) {
        const body = await orderResponse.text();
        console.error("PayPal order lookup failed", body.slice(0, 500));
        return res.status(502).send("PayPal order lookup failed");
      }
      repoSource = await orderResponse.json();
    }

    const repo = repoSource.purchase_units?.[0]?.custom_id?.replace(/^repo:/, "");
    if (!/^(changelog-traduction|suivi-stock-pellet|programme-tnt-fr|recettes-express)$/.test(repo || "")) {
      return res.status(500).send("Invalid repository attribution");
    }

    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) throw new Error("GITHUB_TOKEN is not configured");

    const apiUrl = `https://api.github.com/repos/cyclope205/${repo}/contents/README.md`;
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2026-03-10",
    };
    const readmeResponse = await fetch(apiUrl, { headers });
    if (!readmeResponse.ok) throw new Error(`GitHub README GET returned HTTP ${readmeResponse.status}`);

    const file = await readmeResponse.json();
    const current = Buffer.from(file.content.replace(/\\s/g, ""), "base64").toString("utf8");
    const startMarker = "<!--START_SECTION:paypal-->";
    const endMarker = "<!--END_SECTION:paypal-->";
    const orderMarker = `order:${orderId}`;

    if (!current.includes(orderMarker)) {
      const payer = result.payer?.name;
      const donorName = payer
        ? [payer.given_name, payer.surname].filter(Boolean).join(" ")
        : "PayPal donor";
      const clean = donorName.trim();
      const parts = clean.split(/\\s+/).filter(Boolean);
      const name = parts.length >= 2
        ? `${parts[0]} ${parts[1][0]}*****`
        : (clean ? clean[0] + "*****" : "Anonymous");

      const amount = result.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value
        ?? result.purchase_units?.[0]?.amount?.value
        ?? "?";
      const currency = result.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.currency_code
        ?? result.purchase_units?.[0]?.amount?.currency_code
        ?? "";
      const amountNumber = Number(amount);
      const formattedAmount = Number.isFinite(amountNumber)
        ? amountNumber.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : amount;
      const displayCurrency = currency === "EUR" ? "€" : currency;
      const date = new Date().toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "Europe/Paris",
      });

      // Keep the order ID only as an invisible HTML marker for duplicate protection.
      const rawDescription = String(
        result.purchase_units?.[0]?.description
        ?? repoSource.purchase_units?.[0]?.description
        ?? ""
      );
      const commentMatch = rawDescription.match(/(?:^|\\s)— Message:\\s*(.+)$/);
      const comment = commentMatch
        ? commentMatch[1].replace(/\\s+/g, " ").trim().slice(0, 180)
        : "";
      const safeComment = comment
        .replace(/[<>]/g, "")
        .replace(/[`*_]/g, "")
        .replace(/\\|/g, "¦")
        .trim();
      const entry = safeComment
        ? `- 💙 ${name} · ${formattedAmount} ${displayCurrency} · ${date} — « ${safeComment} » <!-- ${orderMarker} -->`
        : `- 💙 ${name} · ${formattedAmount} ${displayCurrency} · ${date} <!-- ${orderMarker} -->`;

      const existingStart = current.indexOf(startMarker);
      const existingEnd = current.indexOf(endMarker);
      let updated;

      if (existingStart >= 0 && existingEnd > existingStart) {
        updated = current.slice(0, existingEnd) + "\n" + entry + current.slice(existingEnd);
      } else {
        const heading = "### ☕ Merci aux donateurs";
        const headingIndex = current.indexOf(heading);
        if (headingIndex >= 0) {
          const insertAt = current.indexOf("\n", headingIndex) + 1;
          const block = `${startMarker}\n${entry}\n${endMarker}`;
          updated = current.slice(0, insertAt) + "\n" + block + "\n" + current.slice(insertAt);
        } else {
          const block = `${startMarker}\n${entry}\n${endMarker}`;
          updated = current.trimEnd() + `\\n\\n${heading}\\n\\n${block}\\n`;
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
    }

    return res.redirect(302, `https://github.com/cyclope205/${repo}`);
  } catch (error) {
    console.error("PayPal return error", error);
    return res.status(500).send("PayPal payment processing failed");
  }
};
