/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// extensions
import type { TSlashCommandAdditionalOption } from "@/extensions";
import { FileText } from "lucide-react";
// types
import type { IEditorProps } from "@/types";

type Props = Pick<IEditorProps, "disabledExtensions" | "flaggedExtensions">;

export const coreEditorAdditionalSlashCommandOptions = (props: Props): TSlashCommandAdditionalOption[] => {
  void props;
  const options: TSlashCommandAdditionalOption[] = [
    {
      commandKey: "attachment",
      key: "pdf-attachment",
      title: "PDF",
      description: "Attach a PDF",
      searchTerms: ["pdf", "attachment", "document", "upload"],
      icon: <FileText className="size-3.5" />,
      command: ({ editor, range }) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".pdf,application/pdf";
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          if (!file) return;
          editor.chain().deleteRange(range).run();
          editor.commands.insertPdfAttachment?.({
            event: "insert",
            file,
            pos: range.from,
          });
        });
        input.click();
      },
      section: "general",
      pushAfter: "image",
    },
  ];
  return options;
};
