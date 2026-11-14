import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Stockage des fichiers (médias reçus, logos, documents). Neon Object Storage (S3) en
// staging/production ; disque local en développement et en test (constitution IV).

export interface ObjectStore {
  readonly kind: "s3" | "disk";
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const SAFE_KEY = /^[a-z0-9][a-z0-9/_\-.]*$/i;

function assertKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error(`clé de stockage invalide : ${key}`);
}

export function diskStore(root: string): ObjectStore {
  const file = (key: string) => {
    assertKey(key);
    return path.join(root, key);
  };
  return {
    kind: "disk",
    async put(key, body) {
      const target = file(key);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, body);
    },
    get: (key) => readFile(file(key)),
    async delete(key) {
      await rm(file(key), { force: true });
    },
  };
}

export function s3Store(options: {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}): ObjectStore {
  const client = new S3Client({
    endpoint: options.endpoint,
    region: options.region,
    forcePathStyle: true,
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
  });
  return {
    kind: "s3",
    async put(key, body, contentType) {
      assertKey(key);
      await client.send(new PutObjectCommand({ Bucket: options.bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async get(key) {
      assertKey(key);
      const res = await client.send(new GetObjectCommand({ Bucket: options.bucket, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      if (!bytes) throw new Error(`fichier vide : ${key}`);
      return Buffer.from(bytes);
    },
    async delete(key) {
      assertKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: key }));
    },
  };
}

/** Mémoire (tests). */
export function memoryStore(): ObjectStore & { files: Map<string, { body: Buffer; type: string }> } {
  const files = new Map<string, { body: Buffer; type: string }>();
  return {
    kind: "disk",
    files,
    async put(key, body, type) {
      assertKey(key);
      files.set(key, { body, type });
    },
    async get(key) {
      const f = files.get(key);
      if (!f) throw new Error(`introuvable : ${key}`);
      return f.body;
    },
    async delete(key) {
      files.delete(key);
    },
  };
}
