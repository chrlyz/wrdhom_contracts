import chalk from 'chalk';
import findPrefix from 'find-npm-prefix';
import fs from 'fs-extra';
import { PrivateKey, Mina, AccountUpdate } from 'o1js';
import { Posts } from './Posts.js';
import { PostsContract } from './PostsContract.js';
import util from 'util';

export {};

const log = console.log;
const DEFAULT_GRAPHQL = 'https://proxy.berkeley.minaexplorer.com/graphql'; // The endpoint used to interact with the network

const { data: nodeStatus } = await sendGraphQL(
  DEFAULT_GRAPHQL,
  `query {
      syncStatus
    }`
);

if (nodeStatus.syncStatus == 'SYNCED') {
  log(chalk.green(`Transaction relayer is in a synced state`));
} else if (nodeStatus.syncStatus !== 'SYNCED') {
  log(
    chalk.red(
      `Transaction relayer node is not in a synced state. Its status is "${nodeStatus.syncStatus}".\n`
    )
  );
  process.exit(1);
} else if (!nodeStatus || nodeStatus.syncStatus === 'OFFLINE') {
  log(chalk.red(`Transaction relayer node is offline`));
  process.exit(1);
}

const DIR = await findPrefix(process.cwd());

let config;
try {
  config = fs.readJsonSync(`${DIR}/config.json`);
} catch (err) {
  let str;
  if (err.code === 'ENOENT') {
    str = `config.json not found. Make sure you're in a zkApp project directory.`;
  } else {
    str = 'Unable to read config.json.';
    console.error(err);
  }
  log(chalk.red(str));
  process.exit(1);
}

let feepayerPrivateKeyBase58;
let zkAppPrivateKeyBase58;

const { feepayerKeyPath } = config.deployAliases['berkeley'];
try {
  feepayerPrivateKeyBase58 = fs.readJsonSync(feepayerKeyPath).privateKey;
} catch (error) {
  log(
    chalk.red(
      `  Failed to find the feepayer private key.\n  Please make sure your config.json has the correct 'feepayerKeyPath' property.`
    )
  );

  process.exit(1);
}

try {
  zkAppPrivateKeyBase58 = fs.readJsonSync(
    `${DIR}/${config.deployAliases['berkeley'].keyPath}`
  ).privateKey;
} catch (_) {
  log(
    chalk.red(
      `  Failed to find the zkApp private key.\n  Please make sure your config.json has the correct 'keyPath' property.`
    )
  );

  process.exit(1);
}

const zkAppPrivateKey = PrivateKey.fromBase58(zkAppPrivateKeyBase58); //  The private key of the zkApp
const zkAppAddress = zkAppPrivateKey.toPublicKey(); //  The public key of the zkApp
const feepayerPrivateKey = PrivateKey.fromBase58(feepayerPrivateKeyBase58); //  The private key of the feepayer
const feepayerAddress = feepayerPrivateKey.toPublicKey(); //  The public key of the feepayer

const feepayerAddressBase58 = feepayerAddress.toBase58();
const accountQuery = getAccountQuery(feepayerAddressBase58);
const accountResponse = await sendGraphQL(DEFAULT_GRAPHQL, accountQuery);

if (!accountResponse?.data?.account) {
  // No account is found, show an error message and return early
  log(
    chalk.red(
      `  Failed to find the fee payer's account on chain.\n  Please make sure the account "${feepayerAddressBase58}" has previously been funded.`
    )
  );

  process.exit(1);
}

const Network = Mina.Network(DEFAULT_GRAPHQL);
Mina.setActiveInstance(Network);

await Posts.compile();
await PostsContract.compile();
const zkApp = new PostsContract(zkAppAddress);
const fee = Number(0.1) * 1e9;

const txn = await Mina.transaction(
  { sender: feepayerAddress, fee: fee },
  () => {
    AccountUpdate.fundNewAccount(feepayerAddress);
    zkApp.deploy();
  }
);
txn.prove();
txn.sign([zkAppPrivateKey, feepayerPrivateKey]);

const zkAppMutation = sendZkAppQuery(txn.toJSON());
try {
  const result = await sendGraphQL(DEFAULT_GRAPHQL, zkAppMutation);
  const str =
    `\nSuccess! Deploy transaction sent.` +
    `\n` +
    `\nNext step:` +
    `\n  Your smart contract will be live (or updated)` +
    `\n  as soon as the transaction is included in a block:` +
    `\n  https://berkeley.minaexplorer.com/transaction/${result.data.sendZkapp.zkapp.hash}`;
  log(chalk.green(str));
} catch (error) {
  log(chalk.red(getErrorMessage(error)));
  process.exit(1);
}

async function sendGraphQL(graphQLUrl, query) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 20000); // Default to use 20s as a timeout
  let response;
  try {
    let body = JSON.stringify({ operationName: null, query, variables: {} });
    response = await fetch(graphQLUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
    const responseJson = await response.json();
    if (!response.ok || responseJson?.errors) {
      return {
        kind: 'error',
        statusCode: response.status,
        statusText: response.statusText,
        message: responseJson.errors,
      };
    }
    return responseJson;
  } catch (error) {
    clearTimeout(timer);
    return {
      kind: 'error',
      message: error,
    };
  }
}

function getAccountQuery(publicKey) {
  return `
    query {
      account(publicKey: "${publicKey}") {
        nonce
      }
    }`;
}

function sendZkAppQuery(accountUpdatesJson) {
  return `
    mutation {
      sendZkapp(input: {
        zkappCommand: ${removeJsonQuotes(accountUpdatesJson)}
      }) { zkapp
        {
          id
          hash
          failureReason {
            index
            failures
          }
        }
      }
    }`;
}

function getErrorMessage(error) {
  let errors = error?.message;
  if (!Array.isArray(errors)) {
    return `Failed to send transaction. Unknown error: ${util.format(error)}`;
  }
  let errorMessage =
    '  Failed to send transaction to relayer. Errors: ' +
    errors.map((e) => e.message);
  for (const error of errors) {
    if (error.message.includes('Invalid_nonce')) {
      errorMessage = `  Failed to send transaction to the relayer. An invalid account nonce was specified. Please try again.`;
      break;
    }
  }
  return errorMessage;
}

function removeJsonQuotes(json) {
  // source: https://stackoverflow.com/a/65443215
  let cleaned = JSON.stringify(JSON.parse(json), null, 2);
  return cleaned.replace(/^[\t ]*"[^:\n\r]+(?<!\\)":/gm, (match) =>
    match.replace(/"/g, '')
  );
}
