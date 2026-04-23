import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import { Client } from "ssh2";
import Database from "better-sqlite3";

// Initialize Database
const db = new Database("database.sqlite");
db.exec(`
  CREATE TABLE IF NOT EXISTS machines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER DEFAULT 22,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    configPath TEXT,
    restartCommand TEXT,
    tags TEXT
  )
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cors());

  // API Routes
  
  // Machines CRUD
  app.get("/api/machines", (req, res) => {
    try {
      const rows = db.prepare("SELECT * FROM machines").all();
      // Parse tags from stringified JSON
      const machines = rows.map((row: any) => ({
        ...row,
        tags: JSON.parse(row.tags || "[]")
      }));
      res.json(machines);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/machines", (req, res) => {
    const { id, name, host, port, username, password, configPath, restartCommand, tags } = req.body;
    try {
      db.prepare(`
        INSERT INTO machines (id, name, host, port, username, password, configPath, restartCommand, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, name, host, port, username, password, configPath, restartCommand, JSON.stringify(tags || []));
      res.status(201).json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/machines/:id", (req, res) => {
    const { id } = req.params;
    const { name, host, port, username, password, configPath, restartCommand, tags } = req.body;
    try {
      db.prepare(`
        UPDATE machines 
        SET name = ?, host = ?, port = ?, username = ?, password = ?, configPath = ?, restartCommand = ?, tags = ?
        WHERE id = ?
      `).run(name, host, port, username, password, configPath, restartCommand, JSON.stringify(tags || []), id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/machines/:id", (req, res) => {
    const { id } = req.params;
    try {
      db.prepare("DELETE FROM machines WHERE id = ?").run(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

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
