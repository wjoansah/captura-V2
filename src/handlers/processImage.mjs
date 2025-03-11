import {
    S3Client,
    GetObjectCommand,
    PutObjectCommand,
} from '@aws-sdk/client-s3';
import {BlendMode, Jimp, JimpMime, loadFont, measureText, measureTextHeight} from 'jimp';
import {Readable} from 'node:stream';

const s3 = new S3Client({});
const PRIMARY_BUCKET_NAME = process.env.PRIMARY_BUCKET_NAME;

export const handler = async (event, context) => {
    const bucket = event.detail.bucket.name;
    const key = decodeURIComponent(event.detail.object.key.replace(/\+/g, ' '));

    try {
        const getObjectParams = {Bucket: bucket, Key: key};
        const {Body, ContentType, Metadata} = await s3.send(new GetObjectCommand(getObjectParams));

        if (!Body || !(Body instanceof Readable)) {
            console.error(`No content found at ${bucket}/${key}`);
            throw new Error(`No object found in ${bucket}/${key}`);
        }

        const chunks = [];
        for await (const chunk of Body) {
            chunks.push(chunk);
        }
        const imageBuffer = Buffer.concat(chunks);

        const image = await Jimp.read(imageBuffer);

        const watermarkText = Metadata?.username ?? 'captura-watermark';

        const fontPath = 'node_modules/@jimp/plugin-print/fonts/open-sans/open-sans-32-white/open-sans-32-white.fnt'
        const font = await loadFont(fontPath);

        const textWidth = measureText(font, watermarkText);
        const textHeight = measureTextHeight(font, watermarkText, textWidth);

        // Create a new image for the watermark
        const watermark = new Jimp({height: textHeight, width: textWidth});
        // watermark.print(font, 0, 0, watermarkText);
        watermark.print({font, x: 0, y: 0, text: watermarkText});

        // Position the watermark at the bottom-right corner
        const x = image.bitmap.width - watermark.bitmap.width - 10;
        const y = image.bitmap.height - watermark.bitmap.height - 10;

        // Composite the watermark onto the original image
        image.composite(watermark, x, y, {
            mode: BlendMode.SRC_OVER,
            opacitySource: 0.5,
        });

        // Get the buffer of the modified image
        if (!ContentType) {
            console.error('image has no content type');
            throw new Error('Object has no content type');
        }
        const mime = getMimeType(ContentType);

        if (!mime) {
            console.error('unsupported mime type');
            throw new Error('Unsupported mime type');
        }
        const modifiedImageBuffer = await image.getBuffer(mime);

        // Upload the modified image back to S3
        const putObjectParams = {
            Bucket: PRIMARY_BUCKET_NAME,
            Key: key,
            Body: modifiedImageBuffer,
            ContentType,
        };
        await s3.send(new PutObjectCommand(putObjectParams));
        console.log(`Successfully processed and uploaded ${key}`);

        return {
            bucket,
            key,
            metaData: Metadata,
        };
    } catch (error) {
        console.error(`Error processing ${bucket}/${key}:`, error);
        throw error;
    }
};

const getMimeType = (contentType) => {
    switch (contentType) {
        case 'image/png':
            return JimpMime.png;
        case 'image/jpg':
        case 'image/jpeg':
            return JimpMime.jpeg;
        case 'image/gif':
            return JimpMime.gif;
        case 'image/tiff':
            return JimpMime.tiff;
        case 'image/bmp':
            return JimpMime.bmp;
        default:
            return null;
    }
};
