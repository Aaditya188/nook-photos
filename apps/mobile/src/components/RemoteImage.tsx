/**
 * expo-image wrapper that talks to the Nook server: injects the bearer token as a
 * request header (thumbs/originals are owner-only) and requests a size-bucketed
 * thumbnail so the grid only ever fetches the pixels it shows.
 */
import { useState } from 'react';
import { Image, type ImageProps, type ImageContentFit } from 'expo-image';
import { PixelRatio, View, type ViewStyle } from 'react-native';
import { useNookClient, thumbBucket, faceCrop } from '@nook/core';

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

/**
 * A person tile cropped to the cover photo's face box (falls back to a normal
 * cover-fit thumbnail when there's no box). Requests a larger source so the
 * often-small face stays sharp after the zoom.
 */
export function FaceThumb({
  photoId,
  face,
  size,
  rounded = true,
  bg,
}: {
  photoId: string;
  face: [number, number, number, number] | null | undefined;
  size: number;
  rounded?: boolean;
  bg?: string;
}) {
  const client = useNookClient();
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const px = thumbBucket(Math.ceil(size * PixelRatio.get()) * 3);
  const crop = face && dims ? faceCrop(face, dims.w, dims.h) : null;
  const container: ViewStyle = {
    width: size,
    height: size,
    borderRadius: rounded ? size / 2 : 8,
    overflow: 'hidden',
    backgroundColor: bg ?? 'rgba(255,255,255,0.06)',
  };
  return (
    <View style={container}>
      <Image
        source={{ uri: client.thumbUrl(photoId, px), headers: client.authHeaders() }}
        style={
          crop
            ? { position: 'absolute', width: `${crop.widthPct}%`, height: `${crop.heightPct}%`, left: `${crop.leftPct}%`, top: `${crop.topPct}%` }
            : { width: '100%', height: '100%' }
        }
        contentFit={crop ? 'fill' : 'cover'}
        onLoad={(e) => {
          const s = e.source;
          if (s?.width && s?.height) setDims({ w: s.width, h: s.height });
        }}
        cachePolicy="memory-disk"
        transition={120}
      />
    </View>
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
