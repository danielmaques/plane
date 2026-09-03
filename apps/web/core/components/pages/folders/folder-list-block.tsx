/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef, useState } from "react";
import { observer } from "mobx-react";
import { Folder, LockKeyhole, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { CustomMenu } from "@plane/ui";
import { ListItem } from "@/components/core/list";
import { usePlatformOS } from "@/hooks/use-platform-os";
import { EPageStoreType, usePageStore } from "@/plane-web/hooks/store";
import { DeleteFolderModal } from "./delete-folder-modal";
import { FolderFormModal } from "./folder-form-modal";

type TFolderListBlockProps = {
  folderId: string;
  pageType: "public" | "private" | "archived";
  projectId: string;
  workspaceSlug: string;
};

export const FolderListBlock = observer(function FolderListBlock(props: TFolderListBlockProps) {
  const { folderId, pageType, projectId, workspaceSlug } = props;
  const parentRef = useRef<HTMLDivElement>(null);
  const { isMobile } = usePlatformOS();
  const { t } = useTranslation();
  const { canCurrentUserManageFolder, getPageFolderById } = usePageStore(EPageStoreType.PROJECT);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const folder = getPageFolderById(folderId);

  if (!folder) return null;
  const canManage = canCurrentUserManageFolder(folderId);

  return (
    <>
      <FolderFormModal folder={folder} isOpen={isRenameOpen} onClose={() => setIsRenameOpen(false)} />
      <DeleteFolderModal folder={folder} isOpen={isDeleteOpen} onClose={() => setIsDeleteOpen(false)} />
      <ListItem
        title={folder.name}
        itemLink={`/${workspaceSlug}/projects/${projectId}/pages?type=${pageType}&folder=${folder.id}`}
        prependTitleElement={
          <span className="relative">
            <Folder className="h-4 w-4 text-tertiary" />
            {folder.access === 1 && <LockKeyhole className="absolute -right-1.5 -bottom-1 h-2.5 w-2.5 text-tertiary" />}
          </span>
        }
        actionableItems={
          canManage ? (
            <CustomMenu placement="bottom-end" ellipsis closeOnSelect>
              <CustomMenu.MenuItem onClick={() => setIsRenameOpen(true)} className="flex items-center gap-2">
                <Pencil className="size-3" />
                {t("page_folders.rename_folder")}
              </CustomMenu.MenuItem>
              <CustomMenu.MenuItem onClick={() => setIsDeleteOpen(true)} className="flex items-center gap-2">
                <Trash2 className="size-3" />
                {t("page_folders.delete_folder")}
              </CustomMenu.MenuItem>
            </CustomMenu>
          ) : undefined
        }
        isMobile={isMobile}
        parentRef={parentRef}
      />
    </>
  );
});
