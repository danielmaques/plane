/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { getAttributes } from "@tiptap/core";
import type { MarkType } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
// constants
import { PDF_ATTACHMENT_CLASS, PDF_ATTACHMENT_PREVIEW_EVENT } from "@/constants/config";
// plane editor types
import type { TPdfAttachmentPreviewEventDetail } from "@/plane-editor/types";

type ClickHandlerOptions = {
  type: MarkType;
};

export function clickHandler(options: ClickHandlerOptions): Plugin {
  return new Plugin({
    key: new PluginKey("handleClickLink"),
    props: {
      handleClick: (view, pos, event) => {
        if (event.button !== 0) {
          return false;
        }

        let a = event.target as HTMLElement;
        const els: HTMLElement[] = [];

        while (a?.nodeName !== "DIV") {
          els.push(a);
          a = a?.parentNode as HTMLElement;
        }

        if (!els.find((value) => value.nodeName === "A")) {
          return false;
        }

        const attrs = getAttributes(view.state, options.type.name);
        const link = (event.target as HTMLElement).closest("a") as HTMLAnchorElement | null;

        const href = link?.href ?? attrs.href;
        const target = link?.target ?? attrs.target;

        if (link?.classList.contains(PDF_ATTACHMENT_CLASS)) {
          event.preventDefault();
          const rawHref = link.getAttribute("href") ?? "";
          const uploadId = rawHref.match(/^#plane-pdf-upload-([\w-]+)$/)?.[1];
          const assetId = rawHref.match(/\/download\/([0-9a-f-]+)\/?(?:#.*)?$/i)?.[1];
          const metadata = rawHref.match(/#plane-pdf=([^&]*)&size=(\d+)$/);
          const status = link.classList.contains(`${PDF_ATTACHMENT_CLASS}--error`)
            ? "error"
            : link.classList.contains(`${PDF_ATTACHMENT_CLASS}--pending`)
              ? "pending"
              : "ready";
          const detail: TPdfAttachmentPreviewEventDetail = {
            assetId,
            href: rawHref,
            name: metadata?.[1]
              ? decodeURIComponent(metadata[1])
              : (link.textContent?.split(" · ")[0] ?? "document.pdf"),
            size: metadata?.[2] ? Number(metadata[2]) : 0,
            status,
            uploadId,
          };
          window.dispatchEvent(new CustomEvent(PDF_ATTACHMENT_PREVIEW_EVENT, { detail }));
          return true;
        }

        if (link && href) {
          window.open(href, target);

          return true;
        }

        return false;
      },
    },
  });
}
