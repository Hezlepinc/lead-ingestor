import express from "express";
import { cfg } from "../config.js";
import { getRegionToken } from "./tokenProvider.js";
import { log, err } from "../logger.js";

export function startTokenServer() {
  const app = express();
  app.use(express.json());

  app.get("/token", async (req, res) => {
    const { region, secret } = req.query;
    if (secret !== cfg.tokenServerSecret) return res.status(403).json({ error: "Forbidden" });

    try {
      const { token, exp } = await getRegionToken(region);
      res.json({ id_token: token, expires_at: exp });
    } catch (e) {
      err("Token fetch failed", e);
      res.status(500).json({ error: e.message });
    }
  });

  const port = process.env.PORT ? Number(process.env.PORT) : cfg.tokenServerPort;
  app.listen(port, () => log(`🔑 Token microservice running on port ${port}`));
}


