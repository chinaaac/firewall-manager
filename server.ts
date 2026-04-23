import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import { Client } from "ssh2";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cors());

  // API Routes
  
  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Execute command on remote server via SSH
  app.post("/api/ssh/exec", (req, res) => {
    const { host, port, username, password, command } = req.body;

    if (!host || !username || !password || !command) {
      return res.status(400).json({ error: "Missing SSH credentials or command" });
    }

    const conn = new Client();
    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end();
          return res.status(500).json({ error: err.message });
        }
        let stdout = "";
        let stderr = "";
        stream.on("data", (data: any) => {
          stdout += data.toString();
        });
        stream.stderr.on("data", (data: any) => {
          stderr += data.toString();
        });
        stream.on("close", (code: number) => {
          conn.end();
          res.json({ code, stdout, stderr });
        });
      });
    }).on("error", (err) => {
      res.status(500).json({ error: `SSH Connection Error: ${err.message}` });
    }).connect({
      host,
      port: port || 22,
      username,
      password,
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
