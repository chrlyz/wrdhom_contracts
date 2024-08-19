import { Mina, PrivateKey, AccountUpdate } from 'o1js';
import fs from 'fs/promises';
import { Reactions } from './Reactions.js';
import { ReactionsContract } from './ReactionsContract.js';
import { Config } from '../posts/PostsDeploy.js';
import * as dotenv from 'dotenv';

dotenv.config();
const lightnet = process.env.LIGHTNET === 'true' || false;

const configJson: Config = JSON.parse(await fs.readFile('config.json', 'utf8'));
const reactionsConfig = configJson.deployAliases['reactions'];

const feePayerKeysBase58: { privateKey: string; publicKey: string } =
  JSON.parse(await fs.readFile(reactionsConfig.feepayerKeyPath, 'utf8'));
const reactionsContractKeysBase58: { privateKey: string; publicKey: string } =
  JSON.parse(await fs.readFile(reactionsConfig.keyPath, 'utf8'));
const feePayerKey = PrivateKey.fromBase58(feePayerKeysBase58.privateKey);
const reactionsContractKey = PrivateKey.fromBase58(
  reactionsContractKeysBase58.privateKey
);

const Network = Mina.Network(reactionsConfig.url);
const fee = Number(reactionsConfig.fee) * 1e9; // in nanomina (1 billion = 1.0 mina)
Mina.setActiveInstance(Network);
const feePayerAddress = feePayerKey.toPublicKey();
const reactionsContractAddress = reactionsContractKey.toPublicKey();
const reactionsContract = new ReactionsContract(reactionsContractAddress);

if (lightnet) {
  Network.proofsEnabled = false;
} else {
    console.log('Compiling Reactions zkProgram...');
    await Reactions.compile();
    console.log('Compiling ReactionsContract...');
    await ReactionsContract.compile();
    console.log('Compiled');
}

let sentTx;
try {
  const txn = await Mina.transaction(
    { sender: feePayerAddress, fee: fee },
    async () => {
      AccountUpdate.fundNewAccount(feePayerAddress);
      reactionsContract.deploy();
    }
  );
  await txn.prove();
  sentTx = await txn.sign([feePayerKey, reactionsContractKey]).send();
} catch (err) {
  console.log(err);
}

if (sentTx !== undefined) {
  console.log(`
  Success! Reactions deploy transaction sent.
  
  Your smart contract will be live as soon
  as the transaction is included in a block:
  https://minascan.io/devnet/tx/${sentTx.hash}
  `);
}
