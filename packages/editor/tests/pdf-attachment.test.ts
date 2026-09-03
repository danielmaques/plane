/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 * @vitest-environment jsdom
 */

import { Editor, Mark, mergeAttributes } from "@tiptap/core";
import StarterKitExtension from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PDF_ATTACHMENT_CLASS, PDF_ATTACHMENT_PREVIEW_EVENT, PdfAttachmentExtension } from "@plane/editor";
import type { TFileHandler } from "@plane/editor";

const TestLink = Mark.create({
  name: "link",
  addAttributes() {
    return {
      class: { default: null },
      href: { default: null },
      rel: { default: null },
      target: { default: null },
    };
  },
  parseHTML: () => [{ tag: "a[href]" }],
  renderHTML: ({ HTMLAttributes }) => ["a", mergeAttributes(HTMLAttributes), 0],
});

const createHandler = (upload: TFileHandler["upload"]): TFileHandler => ({
  assetsUploadStatus: {},
  cancel: vi.fn(),
  checkIfAssetExists: vi.fn().mockResolvedValue(true),
  delete: vi.fn().mockResolvedValue(undefined),
  duplicate: vi.fn().mockResolvedValue("duplicate-id"),
  getAssetDownloadSrc: vi.fn(async (id) => `/api/assets/download/${id}/`),
  getAssetSrc: vi.fn(async (id) => `/api/assets/${id}/`),
  restore: vi.fn().mockResolvedValue(undefined),
  upload,
  validation: {
    maxFileSize: 5 * 1024 * 1024,
    maxPdfFileSize: 50 * 1024 * 1024,
  },
});

const createEditor = (handler: TFileHandler) =>
  new Editor({
    content: "<p></p>",
    extensions: [StarterKitExtension.configure({ history: true }), TestLink, PdfAttachmentExtension(handler)],
  });

afterEach(() => vi.restoreAllMocks());

describe("PDF attachment editor extension", () => {
  it("uploads a PDF and stores it as a rollback-safe standard link", async () => {
    const handler = createHandler(vi.fn().mockResolvedValue("11111111-1111-1111-1111-111111111111"));
    const editor = createEditor(handler);
    const file = new File(["pdf"], "manual.pdf", { type: "application/pdf" });

    expect(editor.commands.insertPdfAttachment({ event: "insert", file })).toBe(true);
    await vi.waitFor(() => expect(handler.upload).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(editor.getHTML()).toContain("/download/11111111-1111-1111-1111-111111111111/"));

    const html = editor.getHTML();
    expect(html).toContain(`class="${PDF_ATTACHMENT_CLASS}"`);
    expect(html).toContain("manual.pdf · 3 B");
    expect(html).not.toContain("pdf-attachment-component");
    editor.destroy();
  });

  it("keeps a failed upload retryable", async () => {
    const upload = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce("22222222-2222-2222-2222-222222222222");
    const handler = createHandler(upload);
    const editor = createEditor(handler);
    const file = new File(["pdf"], "retry.pdf", { type: "application/pdf" });

    editor.commands.insertPdfAttachment({ event: "drop", file });
    await vi.waitFor(() => expect(editor.getHTML()).toContain("plane-pdf-attachment--error"));
    const uploadId = editor.getHTML().match(/#plane-pdf-upload-([\w-]+)/)?.[1];
    expect(uploadId).toBeTruthy();
    window.dispatchEvent(
      new CustomEvent(PDF_ATTACHMENT_PREVIEW_EVENT, {
        detail: { href: "", name: file.name, size: file.size, status: "error", uploadId },
      })
    );
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(editor.getHTML()).toContain("22222222-2222-2222-2222-222222222222"));
    editor.destroy();
  });

  it("deletes and restores the asset when the link is removed and undone", async () => {
    const handler = createHandler(vi.fn().mockResolvedValue("33333333-3333-3333-3333-333333333333"));
    const editor = createEditor(handler);
    editor.commands.insertPdfAttachment({
      event: "insert",
      file: new File(["pdf"], "history.pdf", { type: "application/pdf" }),
    });
    await vi.waitFor(() => expect(editor.getHTML()).toContain("33333333-3333-3333-3333-333333333333"));
    const uploadedHtml = editor.getHTML();

    editor.commands.clearContent();
    await vi.waitFor(() => expect(handler.delete).toHaveBeenCalledWith("33333333-3333-3333-3333-333333333333"));
    editor.commands.setContent(uploadedHtml);
    await vi.waitFor(() => expect(handler.restore).toHaveBeenCalledWith("33333333-3333-3333-3333-333333333333"));
    editor.destroy();
  });

  it("rejects invalid MIME, extension, and size before upload", () => {
    vi.spyOn(window, "alert").mockImplementation(() => undefined);
    const handler = createHandler(vi.fn().mockResolvedValue("unused"));
    const editor = createEditor(handler);
    expect(
      editor.commands.insertPdfAttachment({
        event: "insert",
        file: new File(["not-pdf"], "manual.pdf", { type: "text/plain" }),
      })
    ).toBe(false);
    const oversized = new File(["x"], "large.pdf", { type: "application/pdf" });
    Object.defineProperty(oversized, "size", { value: 50 * 1024 * 1024 + 1 });
    expect(editor.commands.insertPdfAttachment({ event: "insert", file: oversized })).toBe(false);
    expect(handler.upload).not.toHaveBeenCalled();
    editor.destroy();
  });
});
