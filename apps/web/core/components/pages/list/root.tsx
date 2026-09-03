/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams, useSearchParams } from "next/navigation";
import { EPageAccess } from "@plane/constants";
// types
import type { TPageNavigationTabs } from "@plane/types";
// components
import { ListLayout } from "@/components/core/list";
// plane web hooks
import type { EPageStoreType } from "@/plane-web/hooks/store";
import { usePageStore } from "@/plane-web/hooks/store";
// local imports
import { PageListBlock } from "./block";
import { FolderListBlock } from "../folders";

type TPagesListRoot = {
  pageType: TPageNavigationTabs;
  storeType: EPageStoreType;
};

export const PagesListRoot = observer(function PagesListRoot(props: TPagesListRoot) {
  const { pageType, storeType } = props;
  const { workspaceSlug, projectId } = useParams();
  const searchParams = useSearchParams();
  const folderId = searchParams.get("folder");
  // store hooks
  const { getCurrentProjectPageListState, getPageFolderById } = usePageStore(storeType);
  // derived values
  const selectedFolder = folderId ? getPageFolderById(folderId) : undefined;
  const activeFolderId =
    selectedFolder &&
    (pageType === "archived" ||
      selectedFolder.access === (pageType === "private" ? EPageAccess.PRIVATE : EPageAccess.PUBLIC))
      ? selectedFolder.id
      : null;
  const { folderIds, pageIds } = getCurrentProjectPageListState(pageType, activeFolderId);

  return (
    <ListLayout>
      {folderIds.map((currentFolderId) => (
        <FolderListBlock
          key={currentFolderId}
          folderId={currentFolderId}
          pageType={pageType}
          projectId={projectId?.toString() ?? ""}
          workspaceSlug={workspaceSlug?.toString() ?? ""}
        />
      ))}
      {pageIds.map((pageId) => (
        <PageListBlock key={pageId} pageId={pageId} storeType={storeType} />
      ))}
    </ListLayout>
  );
});
