import epsagon from "epsagon";
import DynamoDB from "aws-sdk/clients/dynamodb";
import { AddSomethingQuery } from "./queries/addSomethingQuery";

epsagon.init({
  token: "token",
  appName: "myApp"
});

const dynamoDbClient = new DynamoDB.DocumentClient();
const addSomethingQuery = new AddSomethingQuery(dynamoDbClient);

export const handler = epsagon.lambdaWrapper(async (event: any): Promise<string> => {

  await addSomethingQuery.execute("id", "something");
  return "OK";
});