/**
 * expo-image wrapper that talks to the Nook server: injects the bearer token as a
 * request header (thumbs/originals are owner-only) and requests a size-bucketed
 * thumbnail so the grid only ever fetches the pixels it shows.
 */
import { Image, type ImageProps, type ImageContentFit } from 'expo-image';
import { PixelRatio } from 'react-native';
import { useNookClient, thumbBucket } from '@nook/core';

const BLURHASH_PLACEHOLDER = { blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' };

export function RemoteThumb({
  photoId,
  /** Rendered cell size in dp; converted to device px + snapped to a bucket. */
  displaySize,
  contentFit = 'cover',
  style,
  ...rest
}: Omit<ImageProps, 'source'> & {
  photoId: string;
  displaySize: number;
  contentFit?: ImageContentFit;
}) {
  const client = useNookClient();
  const px = thumbBucket(Math.ceil(displaySize * PixelRatio.get()));
  return (
    <Image
      {...rest}
      style={style}
      source={{ uri: client.thumbUrl(photoId, px), headers: client.authHeaders() }}
      placeholder={BLURHASH_PLACEHOLDER}
      placeholderContentFit="cover"
      contentFit={contentFit}
      transition={150}
      recyclingKey={`${photoId}:${px}`}
      cachePolicy="memory-disk"
    />
  );
}

export function RemoteOriginal({
  photoId,
  contentFit = 'contain',
  style,
  ...rest
}: Omit<ImageProps, 'source'> & { photoId: string; contentFit?: ImageContentFit }) {
  const client = useNookClient();
  return (
    <Image
      {...rest}
      style={style}
      source={{ uri: client.originalUrl(photoId), headers: client.authHeaders() }}
      contentFit={contentFit}
      transition={120}
      cachePolicy="memory-disk"
    />
  );
}
