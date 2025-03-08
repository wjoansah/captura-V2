import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const PRIMARY_BUCKET_NAME = process.env.PRIMARY_BUCKET_NAME;
const s3 = new S3Client({});

export const handler = async (event, context) => {
    const LINK_EXPIRES_AFTER = 10_800; // 3 hours in seconds

    const { objectKey } = JSON.parse(event.body);
    // todo: add check

    const command = new GetObjectCommand({ Bucket: PRIMARY_BUCKET_NAME, Key: objectKey });

    try {
        const signedUrl = await getSignedUrl(s3, command, { expiresIn: LINK_EXPIRES_AFTER });

        return {
            statusCode: 200,
            body: JSON.stringify({
                body: {
                    shareLink: signedUrl,
                },
            }),
        };
    } catch (error) {
        console.error('Error generating pre-signed URL:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'unable to share image' }),
        };
    }
};
