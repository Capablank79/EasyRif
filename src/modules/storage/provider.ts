import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** Contrato de almacenamiento. Las claves son uuid opacos generados por el servidor. */
export interface StorageProvider {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ data: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

export const STORAGE_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const newStorageKey = () => randomUUID();

/**
 * Adaptador de disco local SOLO para desarrollo: escribe en `.storage/` (fuera de `public`).
 * No es apto para hosting serverless (sistema de archivos efimero): en produccion se debe
 * implementar `StorageProvider` sobre un almacenamiento de objetos.
 */
export class LocalDiskStorage implements StorageProvider {
  constructor(private root: string = path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.STORAGE_LOCAL_DIR ?? ".storage")) {}

  private file(key: string) {
    if (!STORAGE_KEY_RE.test(key)) throw new Error("Clave de almacenamiento invalida");
    return path.join(this.root, key);
  }

  async put(key: string, data: Buffer, contentType: string) {
    const f = this.file(key);
    await mkdir(this.root, { recursive: true });
    await writeFile(f, data);
    await writeFile(`${f}.type`, contentType);
  }

  async get(key: string) {
    if (!STORAGE_KEY_RE.test(key)) return null;
    const f = this.file(key);
    try {
      const [data, type] = await Promise.all([readFile(f), readFile(`${f}.type`, "utf8")]);
      return { data, contentType: type };
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    const f = this.file(key);
    await rm(f, { force: true });
    await rm(`${f}.type`, { force: true });
  }
}

let provider: StorageProvider | undefined;
export function getStorage(): StorageProvider {
  return (provider ??= new LocalDiskStorage());
}
export function setStorageForTests(p: StorageProvider | undefined) {
  provider = p;
}
