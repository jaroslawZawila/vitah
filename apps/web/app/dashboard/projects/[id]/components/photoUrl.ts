import { photoSizeQuery, type PhotoSize } from "@repo/core/contract";

/** A project photo (or its thumbnail), served by /api/v1 with the session. */
export const projectPhotoUrl = (projectId: string, photoId: string, size: PhotoSize = "full") =>
  `/api/v1/projects/${projectId}/photos/${photoId}${photoSizeQuery(size)}`;
