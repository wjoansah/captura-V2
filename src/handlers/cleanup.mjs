import {S3Client, DeleteObjectCommand} from '@aws-sdk/client-s3';

const s3 = new S3Client({});

export const handler = async (event, context) => {
    console.log('event', event);
    if (!event) {
        console.warn('event body is empty');
        return;
    }
    const bucket = event.bucket;
    const key = decodeURIComponent(event.key.replace(/\+/g, ' '));

    try {
        // Delete the original image from S3
        const deleteObjectParams = {Bucket: bucket, Key: key};
        await s3.send(new DeleteObjectCommand(deleteObjectParams));

        console.log(`Successfully deleted ${bucket}/${key}`);
    } catch (error) {
        console.error(`Error deleting ${bucket}/${key}:`, error);
    }
};
