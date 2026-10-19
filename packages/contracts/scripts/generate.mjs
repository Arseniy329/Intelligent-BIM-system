import { compile } from "json-schema-to-typescript";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const directory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(directory, "..");
const schemaPath = path.join(packageRoot, "schemas", "contracts.schema.json");
const outputPath = path.join(packageRoot, "src", "generated.ts");

const schema = JSON.parse(await readFile(schemaPath, "utf8"));
const generated = await compile(schema, schema.title, {
  bannerComment: "/* Generated from schemas/contracts.schema.json. Do not edit manually. */",
  style: { singleQuote: false },
});

await writeFile(outputPath, generated, "utf8");
