import { Mina, PrivateKey, AccountUpdate } from 'o1js';
import fs from 'fs/promises';
import { Posts } from './Posts.js';
import { PostsContract } from './PostsContract.js';
import * as dotenv from 'dotenv';

export type Config = {
  deployAliases: Record<
    string,
    {
      url: string;
      keyPath: string;
      fee: string;
      feepayerKeyPath: string;
      feepayerAlias: string;
    }
  >;
};

dotenv.config();
const lightnet = process.env.LIGHTNET === 'true' || false;

const configJson: Config = JSON.parse(await fs.readFile('config.json', 'utf8'));
const postsConfig = configJson.deployAliases['posts'];

const feePayerKeysBase58: { privateKey: string; publicKey: string } =
  JSON.parse(await fs.readFile(postsConfig.feepayerKeyPath, 'utf8'));
const postsContractKeysBase58: { privateKey: string; publicKey: string } =
  JSON.parse(await fs.readFile(postsConfig.keyPath, 'utf8'));
const feePayerKey = PrivateKey.fromBase58(feePayerKeysBase58.privateKey);
const postsContractKey = PrivateKey.fromBase58(
  postsContractKeysBase58.privateKey
);

const Network = Mina.Network(postsConfig.url);
const fee = Number(postsConfig.fee) * 1e9; // in nanomina (1 billion = 1.0 mina)
Mina.setActiveInstance(Network);
const feePayerAddress = feePayerKey.toPublicKey();
const postsContractAddress = postsContractKey.toPublicKey();
const postsContract = new PostsContract(postsContractAddress);

if (lightnet) {
  Network.proofsEnabled = false;
} else {
    console.log('Compiling Posts zkProgram...');
    await Posts.compile();
    console.log('Compiling PostsContract...');
    await PostsContract.compile();
    console.log('Compiled');
}

let sentTx;
try {
  const txn = await Mina.transaction(
    { sender: feePayerAddress, fee: fee },
    async () => {
      AccountUpdate.fundNewAccount(feePayerAddress);
      postsContract.deploy();
    }
  );
  await txn.prove();
  sentTx = await txn.sign([feePayerKey, postsContractKey]).send();
} catch (err) {
  console.log(err);
}

if (sentTx !== undefined) {
  console.log(`
  Success! Deploy transaction sent.
  
  Your smart contract will be live as soon
  as the transaction is included in a block:
  https://minascan.io/devnet/tx/${sentTx.hash}
  `);
}
