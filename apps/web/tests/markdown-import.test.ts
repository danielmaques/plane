/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import {
  buildMarkdownImportManifest,
  convertJSONDocumentToAllFormats,
  replaceMarkdownLocalImages,
} from "@plane/editor";

type TJSONContent = {
  attrs?: Record<string, unknown>;
  content?: TJSONContent[];
  text?: string;
  type?: string;
};

const createFile = (path: string, content: BlobPart, type: string): File => {
  const file = new File([content], path.split("/").at(-1) ?? path, { type });
  Object.defineProperty(file, "webkitRelativePath", { configurable: true, value: path });
  return file;
};

const collectNodeTypes = (node: TJSONContent): string[] => [
  node.type ?? "",
  ...(node.content?.flatMap(collectNodeTypes) ?? []),
];

describe("Markdown folder import", () => {
  it("creates multiple documents, uses the first H1, and supports rich Markdown structures", async () => {
    const markdown = createFile(
      "knowledge/docs/guia.md",
      `# Guia técnico 😀

- [x] Tarefa pronta

| Coluna | Valor |
| --- | --- |
| A | 1 |

\`\`\`ts
const value = 1;
\`\`\`

![Local](assets/diagrama.png)
![Mesmo arquivo](./assets/../assets/diagrama.png)
![Externa](https://example.com/image.png)

<script>alert("disabled")</script>`,
      "text/markdown"
    );
    const fallback = createFile("knowledge/Notas Unicode.md", "Sem título principal", "text/markdown");
    const image = createFile("knowledge/docs/assets/diagrama.png", "png", "image/png");

    const manifest = await buildMarkdownImportManifest([markdown, fallback, image], {
      imageSizeLimit: 5 * 1024 * 1024,
      markdownSizeLimit: 5 * 1024 * 1024,
    });

    expect(manifest.errors).toEqual([]);
    expect(manifest.documents).toHaveLength(2);
    expect(manifest.documents[0].title).toBe("Guia técnico 😀");
    expect(manifest.documents[1].title).toBe("Notas Unicode");
    expect(
      manifest.documents[0].content.content?.some((node) => node.type === "heading" && node.attrs?.level === 1)
    ).toBe(false);
    expect(collectNodeTypes(manifest.documents[0].content)).toEqual(
      expect.arrayContaining(["taskList", "table", "codeBlock", "image"])
    );
    expect(manifest.documents[0].images).toHaveLength(1);
    expect(manifest.documents[0].images[0].references).toHaveLength(2);

    const references = Object.fromEntries(
      manifest.documents[0].images[0].references.map((reference) => [reference, "asset-id"])
    );
    const replaced = replaceMarkdownLocalImages(manifest.documents[0].content, references);
    const payload = convertJSONDocumentToAllFormats({ document_json: replaced, variant: "document" });
    expect(payload.description_html).toContain('<image-component src="asset-id"');
    expect(payload.description_html).toContain("https://example.com/image.png");
    expect(payload.description_html).not.toContain("<script>");
  });

  it("allows parent paths inside the selected folder", async () => {
    const markdown = createFile("root/docs/page.md", "# Page\n\n![Logo](../images/logo.webp)", "text/markdown");
    const image = createFile("root/images/logo.webp", "webp", "image/webp");
    const manifest = await buildMarkdownImportManifest([markdown, image], {
      imageSizeLimit: 1024,
      markdownSizeLimit: 1024,
    });
    expect(manifest.errors).toEqual([]);
    expect(manifest.documents[0].images[0].resolvedPath).toBe("root/images/logo.webp");
  });

  it("infers a safe MIME type when a browser omits it", async () => {
    const markdown = createFile("root/page.md", "![Logo](logo.png)", "text/markdown");
    const image = createFile("root/logo.png", "png", "");
    const manifest = await buildMarkdownImportManifest([markdown, image], {
      imageSizeLimit: 1024,
      markdownSizeLimit: 1024,
    });

    expect(manifest.errors).toEqual([]);
    expect(manifest.documents[0].images[0].file.type).toBe("image/png");
  });

  it("rejects escaping, unsafe, and missing local image paths without blocking other files", async () => {
    const escaping = createFile("root/docs/escape.md", "![Escape](../../../outside.png)", "text/markdown");
    const unsafe = createFile("root/docs/unsafe.md", "![Unsafe](data:image/png;base64,AAAA)", "text/markdown");
    const missing = createFile("root/docs/missing.md", "![Missing](missing.png)", "text/markdown");
    const valid = createFile("root/valid.md", "# Valid", "text/markdown");

    const manifest = await buildMarkdownImportManifest([escaping, unsafe, missing, valid], {
      imageSizeLimit: 1024,
      markdownSizeLimit: 1024,
    });

    expect(manifest.documents.map((document) => document.title)).toEqual(["Valid"]);
    expect(manifest.errors).toHaveLength(3);
    expect(manifest.errors.map((error) => error.message).join(" ")).toMatch(/escapes|Blocked|not found/);
  });

  it("reports invalid UTF-8 and folders without Markdown files", async () => {
    const invalidUtf8 = createFile("root/invalid.md", new Uint8Array([0xc3, 0x28]), "text/markdown");
    const image = createFile("root/image.png", "png", "image/png");
    const invalidManifest = await buildMarkdownImportManifest([invalidUtf8], {
      imageSizeLimit: 1024,
      markdownSizeLimit: 1024,
    });
    expect(invalidManifest.errors).toHaveLength(1);

    const emptyManifest = await buildMarkdownImportManifest([image], {
      imageSizeLimit: 1024,
      markdownSizeLimit: 1024,
    });
    expect(emptyManifest.documents).toEqual([]);
    expect(emptyManifest.errors[0].message).toMatch(/No Markdown/);
  });
});
