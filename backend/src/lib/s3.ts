// backend/src/lib/s3.ts
import dotenv from 'dotenv';
dotenv.config(); // <-- EZ KELL AZ ELEJÉRE!
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, type ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let _s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!_s3Client) {
    const accessKey = process.env.S3_ACCESS_KEY;
    const secretKey = process.env.S3_SECRET_KEY;

    if (!accessKey || !secretKey) {
      throw new Error('❌ KRITIKUS HIBA: S3_ACCESS_KEY és/vagy S3_SECRET_KEY környezeti változó nincs beállítva!');
    }

    _s3Client = new S3Client({
      endpoint: process.env.S3_ENDPOINT || 'http://minio:9000',
      region: process.env.S3_REGION || 'us-east-1',
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: true, // MinIO használata esetén kötelező
    });
  }
  return _s3Client;
}

const BUCKET = process.env.S3_BUCKET_NAME || 'invoices';

export async function uploadInvoiceBuffer(
  buffer: Buffer,
  mimeType: string,
  userId?: string
): Promise<string> {
  let ext = 'jpg';
  if (mimeType === 'application/pdf') ext = 'pdf';
  else if (mimeType.includes('png')) ext = 'png';
  else if (mimeType.includes('webp')) ext = 'webp';
  else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';
  else ext = mimeType.split('/')[1]?.split('+')[0] || 'jpg';

  const prefix = userId ? `users/${userId}` : 'anonymous';
  const s3Key = `${prefix}/${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      Body: buffer,
      ContentType: mimeType,
    })
  );

  return s3Key;
}

/**
 * Ha az S3 / MinIO belső konténer-hálózaton fut (pl. http://minio:9000), a presigned URL-ben
 * lévő hosztot lecseréli a böngészőből is elérhető S3_PUBLIC_URL címre.
 */
export function rewriteS3PublicUrl(signedUrl: string, publicUrl?: string, internalEndpoint?: string): string {
  const pubUrl = publicUrl !== undefined ? publicUrl : process.env.S3_PUBLIC_URL;
  if (!pubUrl) return signedUrl;

  const endpoint = internalEndpoint || process.env.S3_ENDPOINT || 'http://minio:9000';
  try {
    const parsedInternal = new URL(endpoint);
    const parsedPublic = new URL(pubUrl);
    const parsedSigned = new URL(signedUrl);

    if (parsedSigned.host === parsedInternal.host) {
      parsedSigned.protocol = parsedPublic.protocol;
      parsedSigned.host = parsedPublic.host;
      parsedSigned.port = parsedPublic.port;
      return parsedSigned.toString();
    }
  } catch (err: any) {
    console.warn('⚠️ S3 public URL átírási hiba:', err.message);
  }
  return signedUrl;
}

let _presignS3Client: S3Client | null = null;

function getPresignS3Client(): S3Client {
  if (!_presignS3Client) {
    const accessKey = process.env.S3_ACCESS_KEY;
    const secretKey = process.env.S3_SECRET_KEY;
    if (!accessKey || !secretKey) {
      return getS3Client();
    }
    const publicUrl = process.env.S3_PUBLIC_URL || process.env.S3_ENDPOINT || 'http://minio:9000';

    _presignS3Client = new S3Client({
      endpoint: publicUrl,
      region: process.env.S3_REGION || 'us-east-1',
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: true,
    });
  }
  return _presignS3Client;
}

export async function getInvoiceImageUrl(s3Key: string, expiresInSeconds = 3600): Promise<string> {
  if (s3Key.startsWith('http://') || s3Key.startsWith('https://')) {
    return s3Key;
  }

  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
  });

  // A presigned URL-t közvetlenül a publikus végponttal írjuk alá az AWS SigV4 Host egyezéshez
  const client = process.env.S3_PUBLIC_URL ? getPresignS3Client() : getS3Client();
  const signedUrl = await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  return rewriteS3PublicUrl(signedUrl);
}

/**
 * Törli egy felhasználó összes feltöltött fájlját az S3 / MinIO tárolóból (GDPR fióktörlés).
 * Visszatérési értéke a törölt objektumok száma.
 */
export async function deleteUserS3Folder(userId: string): Promise<number> {
  if (!userId) return 0;
  try {
    const client = getS3Client();
    const prefix = `users/${userId}/`;
    let totalDeleted = 0;
    let continuationToken: string | undefined = undefined;
    let isTruncated = true;

    while (isTruncated) {
      const listRes: ListObjectsV2CommandOutput = await client.send(
        new ListObjectsV2Command({
          Bucket: BUCKET,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );

      if (listRes.Contents && listRes.Contents.length > 0) {
        const objectsToDelete = listRes.Contents
          .filter((obj) => Boolean(obj.Key))
          .map((obj) => ({ Key: obj.Key! }));

        if (objectsToDelete.length > 0) {
          await client.send(
            new DeleteObjectsCommand({
              Bucket: BUCKET,
              Delete: {
                Objects: objectsToDelete,
                Quiet: true,
              },
            })
          );
          totalDeleted += objectsToDelete.length;
        }
      }

      isTruncated = Boolean(listRes.IsTruncated);
      continuationToken = listRes.NextContinuationToken;
    }

    return totalDeleted;
  } catch (err: any) {
    console.warn(`⚠️ Figyelmeztetés: S3 fájlok törlése meghiúsult a(z) ${userId} felhasználónál:`, err.message);
    return 0;
  }
}