import env from "@api/env";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

const s3Client = new S3Client({
  region: "garage",
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.S3_KEY_ID,
    secretAccessKey: env.S3_SECRET_KEY
  }
});

export async function existsInS3(key: string): Promise<boolean> {
  try {
    const command = new HeadObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: key
    });
    await s3Client.send(command);
    return true;
    // oxlint-disable-next-line no-unused-vars
  } catch (_error) {
    return false;
  }
}

export async function getFromS3(key: string): Promise<Buffer | null> {
  try {
    const command = new GetObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: key
    });
    const response = await s3Client.send(command);
    if (!response.Body) return null;
    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
    // oxlint-disable-next-line no-unused-vars
  } catch (_error) {
    return null;
  }
}

export async function uploadToS3(
  key: string,
  body: Buffer | ArrayBuffer,
  contentType: string
): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET_NAME,
    Key: key,
    Body: body instanceof Buffer ? body : new Uint8Array(body),
    ContentType: contentType
  });
  await s3Client.send(command);
}

export default s3Client;
