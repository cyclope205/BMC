const REPOSITORIES = new Set([
  "changelog-traduction",
  "suivi-stock-pellet",
  "programme-tnt-fr",
  "recettes-express",
]);

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method not allowed");
  }

  const repo = String(req.query?.repo || "");
  if (!REPOSITORIES.has(repo)) return res.status(404).send("Invalid repository");

  const origin = process.env.BMC_APP_URL;
  if (!origin) return res.status(500).send("BMC_APP_URL is not configured");

  return res.redirect(302, `/api/paypal?repo=${encodeURIComponent(repo)}&amount=5`);
};
