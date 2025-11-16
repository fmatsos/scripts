#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const JSZip = require("jszip");

// Ask something on stdin
function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

// Simple glob-like matcher: supports "*" wildcard
function matchPattern(filename, patterns) {
  return patterns.some((pattern) => {
    const regex = new RegExp(
      "^" +
        pattern
          .replace(/[.+?^${}()|[\]\\]/g, "\\$&") // escape regex chars
          .replace(/\*/g, ".*") +               // convert * → .*
        "$",
      "i"
    );
    return regex.test(filename);
  });
}

function safeFilename(name) {
  name = name.split("?")[0].split("#")[0];
  name = name.split("/").filter(Boolean).pop() || "image";
  return name.replace(/[^a-zA-Z0-9._-]/g, "_") || "image";
}

function extensionFromMime(mime) {
  if (!mime) return "";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/gif") return ".gif";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/svg+xml") return ".svg";
  if (mime.startsWith("image/")) return "." + mime.split("/")[1];
  return "";
}

function updateProgress(current, total) {
  const width = 30;
  const percent = total ? Math.floor((current / total) * 100) : 0;
  const filled = Math.round((percent / 100) * width);
  const bar = "█".repeat(filled) + "-".repeat(width - filled);
  process.stdout.write(`\r[${bar}] ${current}/${total} (${percent}%)`);
  if (current === total) {
    process.stdout.write("\n");
  }
}

async function main() {
  try {
    const harPathInput = await ask("Path to HAR file: ");
    const harPath = path.resolve(harPathInput || "");
    if (!harPath || !fs.existsSync(harPath)) {
      console.error("❌ HAR file does not exist:", harPath);
      process.exit(1);
    }

    const outDirInput = await ask("Output directory [images]: ");
    const outDir = path.resolve(outDirInput || "images");
    fs.mkdirSync(outDir, { recursive: true });

    const patternInput = await ask("Filename pattern(s) [*-web.jpg]: ");
    const patterns = (patternInput || "*-web.jpg")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    const pbInput = await ask("Show progress bar? [Y/n]: ");
    const showProgress = !/^n(o)?$/i.test(pbInput);

    const zipInput = await ask("Create ZIP archive? [y/N]: ");
    const createZip = /^y(es)?$/i.test(zipInput);

    let zipFileName = "images.zip";
    if (createZip) {
      const zName = await ask("ZIP filename [images.zip]: ");
      if (zName) {
        zipFileName = zName.toLowerCase().endsWith(".zip")
          ? zName
          : `${zName}.zip`;
      }
    }

    console.log("\n📄 Reading HAR:", harPath);
    const raw = fs.readFileSync(harPath, "utf8");
    const har = JSON.parse(raw);

    const entries = (har && har.log && har.log.entries) || [];
    console.log(`🔍 Found ${entries.length} network entries in HAR.`);

    // First pass: build candidate list
    const candidates = [];
    for (const entry of entries) {
      const reqUrl = entry && entry.request && entry.request.url;
      const content = entry && entry.response && entry.response.content;
      const mime = (content && content.mimeType) || "";

      if (!reqUrl || !mime.startsWith("image/")) continue;
      if (!content || !content.text) continue;

      const cleanUrl = reqUrl.split("?")[0];
      const baseName = safeFilename(cleanUrl);

      if (!matchPattern(baseName, patterns)) continue;

      candidates.push({ reqUrl, content, mime, baseName });
    }

    const total = candidates.length;
    if (!total) {
      console.log("ℹ️ No images matched the given pattern(s).");
      process.exit(0);
    }

    console.log(`\n📦 Will extract ${total} image(s) matching: ${patterns.join(", ")}`);

    let zip = null;
    if (createZip) {
      zip = new JSZip();
    }

    let count = 0;
    if (showProgress) {
      updateProgress(0, total);
    }

    for (const item of candidates) {
      const { reqUrl, content, mime, baseName } = item;
      const encoding = content.encoding || "";
      let buffer;

      if (encoding === "base64") {
        buffer = Buffer.from(content.text, "base64");
      } else {
        buffer = Buffer.from(content.text, "utf8");
      }

      let finalName = baseName;
      const ext = extensionFromMime(mime);
      if (!finalName.toLowerCase().endsWith(ext.toLowerCase()) && ext) {
        finalName += ext;
      }

      const index = String(count).padStart(3, "0");
      const outFile = `${index}-${finalName}`;
      const outPath = path.join(outDir, outFile);

      fs.writeFileSync(outPath, buffer);
      if (zip) {
        zip.file(outFile, buffer);
      }

      count++;
      if (showProgress) {
        updateProgress(count, total);
      } else {
        console.log(`✔ [${count}/${total}] Saved ${outPath}`);
      }
    }

    console.log(`\n✅ Extracted ${count} file(s) to ${outDir}`);

    if (zip && count > 0) {
      console.log("🧵 Creating ZIP archive...");
      const zipBuffer = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 9 },
      });

      const zipPath = path.resolve(zipFileName);
      fs.writeFileSync(zipPath, zipBuffer);
      console.log(`📚 ZIP written to: ${zipPath}`);
    }

    console.log("🎉 Done.");
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
}

main();
