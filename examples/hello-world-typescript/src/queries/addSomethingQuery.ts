import DynamoDB from "aws-sdk/clients/dynamodb";

export class AddSomethingQuery {
  constructor(private readonly dynamoDbClient: DynamoDB.DocumentClient) { }

  public async execute(id: string, payload: string): Promise<void> {
    const params = {
      Item: {
        "id": id,
        "payload": payload,
      },
      TableName: "myTb",
    };

    await this.dynamoDbClient.put(params).promise();
  }
}