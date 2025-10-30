import express from "express";
import { cfg } from "../config.js";
import { getTokenForRegion } from "./tokens.js";
import { log, err } from "../logger.js";

export function startTokenServer() {
  const app = express();
  app.use(express.json());

  app.get("/token", async (req, res) => {
    const { region, secret } = req.query;
    if (secret !== cfg.tokenServerSecret) return res.status(403).json({ error: "Forbidden" });

    try {
      const raw = await getTokenForRegion(region);
      const idToken = String(raw).replace(/^Bearer\s+/i, "");
      // Expiry unknown for file-based tokens; return null for compatibility
      res.json({ id_token: idToken, expires_at: null });
    } catch (e) {
      err("Token fetch failed", e);
      res.status(500).json({ error: e.message });
    }
  });

  const port = process.env.PORT ? Number(process.env.PORT) : cfg.tokenServerPort;
  app.listen(port, () => log(`🔑 Token microservice running on port ${port}`));
}


