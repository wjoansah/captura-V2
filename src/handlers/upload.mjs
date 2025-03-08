import {S3Client} from "@aws-sdk/client-s3";
import {PutObjectCommand} from '@aws-sdk/client-s3'
import {fileTypeFromBuffer} from 'file-type';

const STAGING_BUCKET_NAME = process.env.STAGING_BUCKET_NAME;

const s3 = new S3Client({});

export const handler = async (event) => {
    const email = event.requestContext.authorizer?.email;
    const username = event.requestContext.authorizer?.username;

    try {
        if (!event.body) {
            return {
                statusCode: 400,
                body: JSON.stringify({message: 'No file content provided'}),
            };
        }

        const fileContent = Buffer.from(event.body, 'base64');

        const fileType = await fileTypeFromBuffer(fileContent);
        if (!fileType || !fileType.mime.startsWith('image/')) {
            return {
                statusCode: 400,
                body: JSON.stringify({message: 'Uploaded file is not a valid image'}),
            };
        }

        const fileNamePrefix = slugify(email.split('@')[0]);
        const fileName = `${fileNamePrefix}-${Date.now()}.${fileType.ext}`;

        // Upload the image to the staging S3 bucket
        const putObjectParams = {
            Bucket: STAGING_BUCKET_NAME,
            Key: fileName,
            Body: fileContent,
            ContentType: fileType.mime,
            Metadata: {
                email,
                username,
            },
        };
        await s3.send(new PutObjectCommand(putObjectParams));

        return {
            statusCode: 200,
            body: JSON.stringify({message: 'Image uploaded successfully', fileName}),
        };
    } catch (error) {
        console.error('Error uploading image:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({message: 'Internal server error'}),
        };
    }
};

function slugify(text) {
    return text
        .toString() // Ensure the input is a string
        .normalize('NFD') // Decompose accented characters into base characters and diacritics
        .replace(/[\u0300-\u036f]/g, '') // Remove diacritical marks
        .toLowerCase() // Convert to lowercase
        .trim() // Remove leading and trailing whitespace
        .replace(/[^a-z0-9\s-]/g, '') // Remove invalid characters
        .replace(/[\s_-]+/g, '-') // Replace spaces, underscores, and consecutive hyphens with a single hyphen
        .replace(/^-+|-+$/g, ''); // Remove leading and trailing hyphens
}
