/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import { buildPdfPageDocument, buildPdfPageImportManifest, convertJSONDocumentToAllFormats } from "@plane/editor";

const createFile = (name: string, content: BlobPart, type: string): File => new File([content], name, { type });

describe("PDF Page import", () => {
  it("validates PDFs, derives titles, and normalizes a missing MIME type", () => {
    const unicode = createFile("Guia técnico 😀.pdf", "pdf", "application/pdf");
    const generic = createFile("Manual.pdf", "pdf", "application/octet-stream");
    const longName = `${"a".repeat(300)}.pdf`;
    const manifest = buildPdfPageImportManifest(
      [unicode, generic, createFile(longName, "pdf", "application/pdf")],
      1024
    );

    expect(manifest.errors).toEqual([]);
    expect(manifest.documents.map((document) => document.title)).toEqual([
      "Guia técnico 😀",
      "Manual",
      "a".repeat(255),
    ]);
    expect(manifest.documents[1].file.type).toBe("application/pdf");
  });

  it("rejects invalid extensions, MIME types, empty files, and oversized PDFs independently", () => {
    const manifest = buildPdfPageImportManifest(
      [
        createFile("notes.txt", "text", "text/plain"),
        createFile("fake.pdf", "text", "text/plain"),
        createFile("empty.pdf", "", "application/pdf"),
        createFile("large.pdf", "large", "application/pdf"),
        createFile("valid.pdf", "ok", "application/pdf"),
      ],
      3
    );

    expect(manifest.documents.map((document) => document.title)).toEqual(["valid"]);
    expect(manifest.errors).toHaveLength(4);
    expect(manifest.errors.map((error) => error.message).join(" ")).toMatch(/Only PDF|size limit/);
  });

  it("creates a rollback-safe PDF link document for the Page description", () => {
    const file = createFile("Product Brief.pdf", "pdf-content", "application/pdf");
    const document = buildPdfPageDocument({
      assetDownloadUrl:
        "https://plane.example.com/api/assets/v2/workspaces/acme/projects/project/download/4d9f536d-3c41-46a0-a090-dfb9f17ea5db/",
      file,
    });
    const payload = convertJSONDocumentToAllFormats({ document_json: document, variant: "document" });

    expect(payload.description_html).toMatch(/class="[^"]*plane-pdf-attachment[^"]*"/);
    expect(payload.description_html).toContain("Product Brief.pdf · 11 B");
    expect(payload.description_html).toContain("#plane-pdf=Product%20Brief.pdf&amp;size=11");
    expect(payload.description_json).toMatchObject({
      content: [
        {
          content: [
            {
              marks: [
                {
                  attrs: {
                    href: expect.stringContaining("#plane-pdf=Product%20Brief.pdf&size=11"),
                  },
                  type: "link",
                },
              ],
              text: "Product Brief.pdf · 11 B",
              type: "text",
            },
          ],
          type: "paragraph",
        },
      ],
      type: "doc",
    });
    expect(payload.description_binary).toBeTruthy();
  });
});
