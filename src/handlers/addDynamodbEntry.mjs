import {v7 as uuidv7} from 'uuid';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient, PutCommand} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);

const tableName = process.env.UPLOAD_METADATA_TABLE_NAME;

export const handler = async (event) => {
    const {key, metaData} = event;
    const id = uuidv7().toString();

    const queryParams = {
        TableName: tableName,
        Item: {id, objectKey: key, date: Date.now(), username: metaData?.username},
    };

    try {
        const data = await ddbDocClient.send(new PutCommand(queryParams));
        console.log('Success - new image metadata added ', data);
        return event;
    } catch (err) {
        console.error('Error', err);
        throw err;
    }
};
