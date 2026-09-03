/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TPage, TPageFolder, TPageNavigationTabs } from "@plane/types";

type TPageFolderListState = {
  folderIds: string[];
  pageIds: string[];
};

type TBuildPageFolderListState = {
  activeFolderId: string | null;
  filteredPageIds: string[];
  folders: TPageFolder[];
  pages: TPage[];
  pageType: TPageNavigationTabs;
  searchQuery: string;
};

export const buildPageFolderListState = (params: TBuildPageFolderListState): TPageFolderListState => {
  const { activeFolderId, filteredPageIds, folders, pages, pageType, searchQuery } = params;
  const filteredPageIdSet = new Set(filteredPageIds);
  const filteredPages = pages.filter((page) => page.id && filteredPageIdSet.has(page.id));

  if (activeFolderId) {
    return {
      folderIds: [],
      pageIds: filteredPages.filter((page) => page.folder_id === activeFolderId).map((page) => page.id as string),
    };
  }

  if (searchQuery.trim()) {
    return { folderIds: [], pageIds: filteredPageIds };
  }

  const folderIdsWithPages = new Set(filteredPages.map((page) => page.folder_id).filter(Boolean));
  const folderIds = folders
    .filter((folder) => {
      if (pageType === "archived") return folderIdsWithPages.has(folder.id);
      if (pageType === "private") return folder.access === 1;
      return folder.access === 0;
    })
    .toSorted((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .map((folder) => folder.id);

  return {
    folderIds,
    pageIds: filteredPages.filter((page) => !page.folder_id).map((page) => page.id as string),
  };
};

type TRunOptimisticFolderMove = {
  apply: (folderId: string | null | undefined) => void;
  nextFolderId: string | null;
  previousFolderId: string | null | undefined;
  request: () => Promise<unknown>;
};

export const runOptimisticFolderMove = async (params: TRunOptimisticFolderMove) => {
  const { apply, nextFolderId, previousFolderId, request } = params;
  apply(nextFolderId);
  try {
    await request();
  } catch (error) {
    apply(previousFolderId);
    throw error;
  }
};
