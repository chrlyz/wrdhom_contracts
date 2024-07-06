import { Mina, PrivateKey, AccountUpdate } from 'o1js';
import fs from 'fs/promises';
import { Reposts } from './Reposts.js';
import { RepostsContract } from './RepostsContract.js';
import { Config } from '../posts/PostsDeploy.js';

const configJson: Config = JSON.parse(await fs.readFile('config.json', 'utf8'));
const repostsConfig = configJson.deployAliases['reposts'];

const feePayerKeysBase58: { privateKey: string; publicKey: string } =
  JSON.parse(await fs.readFile(repostsConfig.feepayerKeyPath, 'utf8'));
const repostsContractKeysBase58: { privateKey: string; publicKey: string } =
  JSON.parse(await fs.readFile(repostsConfig.keyPath, 'utf8'));
const feePayerKey = PrivateKey.fromBase58(feePayerKeysBase58.privateKey);
const repostsContractKey = PrivateKey.fromBase58(
  repostsContractKeysBase58.privateKey
);

const Network = Mina.Network(repostsConfig.url);
const fee = Number(repostsConfig.fee) * 1e9; // in nanomina (1 billion = 1.0 mina)
Mina.setActiveInstance(Network);
const feePayerAddress = feePayerKey.toPublicKey();
const repostsContractAddress = repostsContractKey.toPublicKey();
const repostsContract = new RepostsContract(repostsContractAddress);

console.log('Compiling Reposts zkProgram...');
await Reposts.compile();
console.log('Compiling RepostsContract...');
await RepostsContract.compile();
console.log('Compiled');

let sentTx;
try {
  const txn = await Mina.transaction(
    { sender: feePayerAddress, fee: fee },
    async () => {
      AccountUpdate.fundNewAccount(feePayerAddress);
      repostsContract.deploy();
    }
  );
  await txn.prove();
  sentTx = await txn.sign([feePayerKey, repostsContractKey]).send();
} catch (err) {
  console.log(err);
}

if (sentTx !== undefined) {
  console.log(`
  Success! Reposts deploy transaction sent.
  
  Your smart contract will be live as soon
  as the transaction is included in a block:
  https://minascan.io/devnet/tx/${sentTx.hash}
  `);
}
