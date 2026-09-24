const REPOSITORIES = new Set([
  "changelog-traduction",
  "suivi-stock-pellet",
  "programme-tnt-fr",
  "recettes-express",
]);

module.exports = function handler(req, res) {
  const repo = String(req.query?.repo || "");
  if (!REPOSITORIES.has(repo)) return res.status(400).send("Invalid repository");
  return res.redirect(302, `https://github.com/cyclope205/${repo}`);
};
