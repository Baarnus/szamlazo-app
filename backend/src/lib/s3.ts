// backend/src/lib/s3.ts
import dotenv from 'dotenv';
dotenv.config(); // <-- EZ KELL AZ ELEJÉRE!
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT || 'http://minio:9000',
  region: process.env.S3_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY || '5:?EgI9HX291Ie,5TbH',
  },
  forcePathStyle: true, // MinIO használata esetén kötelező
});

const BUCKET = process.env.S3_BUCKET_NAME || 'invoices';

export async function uploadInvoiceBuffer(
  buffer: Buffer,
  mimeType: string,
  userId?: string
): Promise<string> {
  const ext = mimeType.split('/')[1] || 'jpg';
  const prefix = userId ? `users/${userId}` : 'anonymous';
  const s3Key = `${prefix}/${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      Body: buffer,
      ContentType: mimeType,
    })
  );

  return s3Key;
}

export async function getInvoiceImageUrl(s3Key: string, expiresInSeconds = 3600): Promise<string> {
  if (s3Key.startsWith('http://') || s3Key.startsWith('https://')) {
    return s3Key;
  }

  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
  });

  return await getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}