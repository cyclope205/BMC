const crypto = require("crypto");

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function safeEqualHex(a, b) {
  if (!a || !b) return false;
  const left = Buffer.from(String(a), "hex");
  const right = Buffer.from(String(b), "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function anonymizeName(name) {
  if (!name || typeof name !== "string") return "Anonymous";
  const clean = name.trim();
  if (!clean) return "Anonymous";
  if (clean.length <= 2) return clean[0] + "*****";
  return clean[0] + "*****" + clean[clean.length - 1];
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.BMC_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({ error: "BMC_WEBHOOK_SECRET is not configured" });
  }

  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers["x-signature-sha256"];

    const expected = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

    if (!safeEqualHex(signature, expected)) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const event = JSON.parse(rawBody.toString("utf8"));

    if (!event || !event.type) {
      return res.status(400).json({ error: "Invalid webhook event" });
    }

    const response = {
      ok: true,
      event_id: event.event_id ?? null,
      type: event.type,
      live_mode: event.live_mode ?? null,
    };

    if (event.type === "donation.created") {
      const donation = event.data || {};
      const supporter =
        donation.supporter ||
        donation.user ||
        donation.buyer ||
        {};

      response.donation = {
        id: donation.id ?? null,
        amount: donation.amount ?? null,
        currency: donation.currency ?? null,
        message: donation.message ?? null,
        donor: anonymizeName(
          supporter.name ||
          donation.supporter_name ||
          donation.name
        ),
      };
    }

    console.log("BMC webhook received", response);
    return res.status(200).json(response);
  } catch (error) {
    console.error("BMC webhook error", error);
    return res.status(400).json({ error: "Invalid webhook payload" });
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
